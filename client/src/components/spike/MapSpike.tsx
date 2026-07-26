'use client'

/**
 * T0 risk spike — throwaway. Delete once CHECKPOINT 0 passes.
 *
 * Findings so far, all recorded in reports/t0_spike.md:
 *  1. deck.gl 9.3 renders under Next 15 / React 19 / StrictMode / output:'export'.
 *  2. `<Map>` from react-map-gl@8 nested inside `<DeckGL>` throws — deck clones
 *     children and injects props v8's Map does not accept.
 *  3. react-map-gl@8 requires maplibre-gl@6 (it imports maplibre-gl.mjs, which
 *     maplibre-gl@5 does not ship), and against v6 the wrapper ignores the
 *     mapStyle prop at construction and never runs the initial resize.
 *
 * So this drops the React wrapper and drives maplibre-gl directly, with deck.gl
 * attached as a MapboxOverlay. Both mandated libraries (§3.1) are retained;
 * react-map-gl was only ever a convenience wrapper in the §3.1 install list.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { H3HexagonLayer } from '@deck.gl/geo-layers'
import { Map as MapLibreMap } from 'maplibre-gl'
import { latLngToCell } from 'h3-js'
import { buildBasemapStyle, registerPmtilesProtocol } from '@/lib/map/basemap'
import 'maplibre-gl/dist/maplibre-gl.css'

const INITIAL_VIEW = { longitude: 77.6, latitude: 12.95, zoom: 12 }

function spikeCells(): { h3: string; value: number }[] {
  const out: { h3: string; value: number }[] = []
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 24; j++) {
      const lat = 12.92 + i * 0.004
      const lon = 77.56 + j * 0.004
      out.push({ h3: latLngToCell(lat, lon, 9), value: (i * 24 + j) / 576 })
    }
  }
  return out
}

export function MapSpike() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState('mounting')
  const data = useMemo(spikeCells, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    registerPmtilesProtocol()

    const map = new MapLibreMap({
      container,
      style: buildBasemapStyle(),
      center: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude],
      zoom: INITIAL_VIEW.zoom,
      attributionControl: { compact: true },
    })
    ;(window as unknown as { __map: MapLibreMap }).__map = map

    map.on('error', (event) => {
      const message = event.error?.message ?? 'unknown'
      setStatus(`ERROR ${message}`)
    })
    // `load` is unreliable here, so attach the overlay immediately —
    // MapboxOverlay handles style readiness itself.
    {
      const overlay = new MapboxOverlay({
        interleaved: true,
        layers: [
          new H3HexagonLayer<{ h3: string; value: number }>({
            id: 'spike-hexes',
            data,
            extruded: false,
            filled: true,
            stroked: false,
            coverage: 0.92,
            opacity: 0.72,
            getHexagon: (d) => d.h3,
            getFillColor: (d) => [
              40 + 215 * d.value,
              20 + 160 * d.value,
              120 - 60 * d.value,
              210,
            ],
            pickable: true,
          }),
        ],
      })
      map.addControl(overlay)
      setStatus('map + deck attached')
    }
    map.on('idle', () => setStatus('map + deck idle'))

    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container)

    return () => {
      observer.disconnect()
      map.remove()
    }
  }, [data])

  return (
    <div className="relative h-screen w-full bg-[--ink-900]">
      {/* maplibre-gl.css forces `position: relative` on its container, which
          overrides `absolute inset-0` and collapses the height to 0. Size it
          from the parent instead. */}
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-4 top-4 rounded-md border border-[--ink-600] bg-[--ink-800] px-3 py-2 font-mono text-[12px] text-[--txt]">
        T0 spike · {data.length} r9 cells · {status}
      </div>
    </div>
  )
}
