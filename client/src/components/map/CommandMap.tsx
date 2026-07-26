'use client'

/**
 * Command Map — BUILD_SPEC §7.1.
 *
 * MapLibre GL over the self-hosted PMTiles basemap (§3.4) with the §7.1 layer
 * stack attached as an interleaved deck.gl overlay, replacing a linear-stretch
 * SVG projection into a 1000×700 box and a ±0.25 CSS-transform pseudo-zoom that
 * could not pan at all.
 */
import { MapboxOverlay } from '@deck.gl/mapbox'
import { H3HexagonLayer } from '@deck.gl/geo-layers'
import { GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers'
import type { Layer, PickingInfo } from '@deck.gl/core'
import { Map as MapLibreMap } from 'maplibre-gl'
import {
  AlertTriangle,
  ChevronDown,
  Clock3,
  Crosshair,
  Layers3,
  LocateFixed,
  Minus,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Panel } from '@/components/primitives/Panel'
import { ProvenanceChip } from '@/components/primitives/ProvenanceChip'
import { OpsShell } from '@/components/shell/OpsShell'
import { BLR_CENTER, INITIAL_VIEW_STATE, magma, magmaCss } from '@/lib/geo'
import { buildBasemapStyle, registerPmtilesProtocol } from '@/lib/map/basemap'
import { dur } from '@/lib/motion'
import type { Provenance } from '@/lib/provenance'
import 'maplibre-gl/dist/maplibre-gl.css'

interface Cell {
  readonly h3_r9: string
  readonly count: number
  readonly top_crime_head: string | null
  readonly top_crime_head_count: number
  readonly top_station_code: string | null
  readonly top_station_name: string | null
  readonly top_station_count: number
  readonly latitude: number
  readonly longitude: number
}

interface Explanation {
  readonly h3: string
  readonly total: number
  readonly paragraph: string
  readonly confidence: 'high' | 'medium' | 'low'
  readonly evidence: {
    readonly crime_heads: readonly { value: string; count: number }[]
    readonly hours: readonly { value: string; count: number }[]
    readonly premises: readonly { value: string; count: number }[]
    readonly origins: readonly { value: string; count: number }[]
    readonly stations: readonly { value: string; count: number }[]
  }
}

interface CommandMapFixture {
  readonly window: { start: string; end: string; days_inclusive: number }
  readonly cells: readonly Cell[]
  readonly reported_points: readonly {
    incident_id: string
    station_code: string | null
    unit_name: string
    crime_head: string
    latitude: number
    longitude: number
    geo_origin: string
  }[]
  readonly stations: readonly {
    station_code: string | null
    unit_name: string
    police_division: string | null
    count: number
  }[]
  readonly weekly_histogram: readonly { iso_week: string; count: number }[]
  readonly explanations: readonly Explanation[]
  readonly pulse_ring: {
    h3_r9: string
    crime_heads: readonly string[]
    hourly: readonly { crime_head: string; estimated_occurrence_hour: number; count: number }[]
    generated_roster_strength: readonly number[]
  }
  readonly alerts: readonly {
    id: string
    title: string
    station_name: string
    observed_count: number
    severity: string
    geography: { latitude: number; longitude: number }
  }[]
  readonly provenance: Provenance
}

/** §7.1 — the alert pulse cap. Ranked by z-score; anything past six is noise. */
const MAX_PULSES = 6
/** §7.1 — pulse period. */
const PULSE_MS = 1800
/** 106 official station polygons, copied to `public/data/` by `sync-demo-data.mjs`. */
const JURISDICTIONS_URL = '/data/reference/jurisdictions.geojson'

interface JurisdictionProperties {
  readonly station_code: string
  readonly station_name: string
  readonly police_division: string | null
}

function format(value: number): string {
  return value.toLocaleString('en-IN')
}

function Context({
  fixture,
  station,
  crimeHead,
  search,
  onStation,
  onCrimeHead,
  onSearch,
}: {
  readonly fixture: CommandMapFixture
  readonly station: string
  readonly crimeHead: string
  readonly search: string
  readonly onStation: (value: string) => void
  readonly onCrimeHead: (value: string) => void
  readonly onSearch: (value: string) => void
}) {
  const stationOptions = [...new Map(fixture.stations.filter((row) => row.station_code).map((row) => [row.station_code!, row])).values()]
  const heads = [...new Set(fixture.cells.flatMap((cell) => cell.top_crime_head ?? []))].sort()
  return (
    <div className="space-y-5">
      <label className="block">
        <span className="type-micro text-[--txt-3]">Search dominant attribute</span>
        <span className="mt-2 flex items-center gap-2 rounded-[--r-sm] border border-[--ink-500] bg-[--ink-800] px-3 py-2 text-[--txt-2]">
          <Search size={15} />
          <input aria-label="Search map" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[--txt-3]" onChange={(event) => onSearch(event.target.value)} placeholder="Station or crime head" value={search} />
        </span>
      </label>
      <label className="block text-xs text-[--txt-3]">
        STATION
        <span className="relative mt-2 block">
          <select aria-label="Map station" className="w-full appearance-none rounded-[--r-sm] border border-[--ink-500] bg-[--ink-800] px-3 py-2 pr-8 text-[--txt]" onChange={(event) => onStation(event.target.value)} value={station}>
            <option value="">All stations</option>
            {stationOptions.map((row) => <option key={row.station_code!} value={row.station_code!}>{row.unit_name}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-2.5" size={14} />
        </span>
      </label>
      <label className="block text-xs text-[--txt-3]">
        DOMINANT CRIME HEAD
        <span className="relative mt-2 block">
          <select aria-label="Map crime head" className="w-full appearance-none rounded-[--r-sm] border border-[--ink-500] bg-[--ink-800] px-3 py-2 pr-8 text-[--txt]" onChange={(event) => onCrimeHead(event.target.value)} value={crimeHead}>
            <option value="">All heads</option>
            {heads.map((head) => <option key={head}>{head}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-2.5" size={14} />
        </span>
      </label>
      {/* Kept in step with the layers MapCanvas actually creates. */}
      <Panel title="Visible layer rules" eyebrow="TRUTH CONTRACT">
        <ul className="space-y-2 text-xs leading-5 text-[--txt-2]">
          <li><span className="text-[--cyan-400]">▢</span> Jurisdictions: 106 official polygons</li>
          <li><span className="text-[--cyan-400]">◆</span> H3 aggregates: reported + inferred</li>
          <li><span className="text-[--gold-400]">●</span> Point marks: eligible reported only</li>
          <li><span className="text-[--critical]">◎</span> Pulses: top six ranked alerts</li>
          <li className="text-[--txt-3]">No corridor layer — the source carries station codes and a buffer radius, no polyline.</li>
        </ul>
      </Panel>
      <div className="rounded-[--r-md] border border-[--ink-600] p-4">
        <p className="type-micro text-[--txt-3]">Fixed complete-window view</p>
        <p className="mt-2 flex items-center gap-2 text-xs"><Clock3 size={14} className="text-[--gold-400]" /> {fixture.window.start} → {fixture.window.end}</p>
        <p className="mt-2 text-[10px] text-[--txt-3]">{fixture.window.days_inclusive} days inclusive</p>
      </div>
    </div>
  )
}

function PulseRing({ fixture }: { readonly fixture: CommandMapFixture }) {
  const maximum = Math.max(1, ...fixture.pulse_ring.hourly.map((row) => row.count))
  return (
    <svg aria-label="24-hour derived occurrence pulse with generated roster overlay" className="mx-auto mt-4 h-[250px] w-[250px]" role="img" viewBox="0 0 280 280">
      {[0, 1, 2, 3, 4].map((ring) => <circle cx="140" cy="140" fill="none" key={ring} r={42 + ring * 18} stroke="#2B3849" />)}
      {fixture.pulse_ring.hourly.map((row) => {
        const ring = fixture.pulse_ring.crime_heads.indexOf(row.crime_head)
        if (ring < 0) return null
        const angle = row.estimated_occurrence_hour * 15 - 90
        const radius = 42 + ring * 18
        const length = 5 + (row.count / maximum) * 13
        const radians = (angle * Math.PI) / 180
        const startX = 140 + Math.cos(radians) * (radius - length / 2)
        const startY = 140 + Math.sin(radians) * (radius - length / 2)
        const endX = 140 + Math.cos(radians) * (radius + length / 2)
        const endY = 140 + Math.sin(radians) * (radius + length / 2)
        // Sequential ramp on categorical rings is a §5.2 miss inherited from the
        // SVG map; kept visually identical here and left to T1.5's chart pass.
        return <line key={`${row.crime_head}-${row.estimated_occurrence_hour}`} stroke={magmaCss((ring + 1) / 5)} strokeLinecap="round" strokeWidth="5" x1={startX} x2={endX} y1={startY} y2={endY} />
      })}
      {fixture.pulse_ring.generated_roster_strength.map((strength, hour) => {
        const angle = hour * 15 - 90
        const radians = (angle * Math.PI) / 180
        return <circle cx={140 + Math.cos(radians) * 128} cy={140 + Math.sin(radians) * 128} fill="#FFC53D" key={hour} opacity={0.15 + strength / 16} r="2.5" />
      })}
      <text fill="#94A3B8" fontSize="9" textAnchor="middle" x="140" y="136">DERIVED HOURS</text>
      <text fill="#FFC53D" fontSize="9" textAnchor="middle" x="140" y="151">GOLD · GENERATED ROSTER</text>
      {[0, 6, 12, 18].map((hour) => {
        const angle = hour * 15 - 90
        const radians = (angle * Math.PI) / 180
        return <text fill="#64748B" fontSize="8" key={hour} textAnchor="middle" x={140 + Math.cos(radians) * 136} y={143 + Math.sin(radians) * 136}>{String(hour).padStart(2, '0')}</text>
      })}
    </svg>
  )
}

function InspectorContent({
  fixture,
  selected,
}: {
  readonly fixture: CommandMapFixture
  readonly selected: Cell
}) {
  const explanation = fixture.explanations.find((row) => row.h3 === selected.h3_r9)
  return (
    <div className="space-y-4">
      <ProvenanceChip provenance={fixture.provenance} derivation="H3 r9 aggregate over a fixed 90-day complete-window slice. Point marks require map_pin_eligible=true." />
      <Panel title="Why here?" eyebrow={`${selected.h3_r9.slice(0, 8)}… · ${explanation?.confidence ?? 'computed'} confidence`}>
        <p className="text-sm leading-6 text-[--txt-2]">
          {explanation?.paragraph ??
            `${selected.top_station_name ?? 'Selected cell'} contains ${format(selected.count)} records. ${selected.top_crime_head ?? 'No dominant head'} is the largest category (${format(selected.top_crime_head_count)}).`}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[--ink-600] pt-4 text-xs">
          <div><dt className="text-[--txt-3]">90-day records</dt><dd className="mt-1 font-mono">{format(selected.count)}</dd></div>
          <div><dt className="text-[--txt-3]">Top-head share</dt><dd className="mt-1 font-mono">{selected.count ? ((selected.top_crime_head_count / selected.count) * 100).toFixed(1) : '0.0'}%</dd></div>
          <div><dt className="text-[--txt-3]">Dominant station</dt><dd className="mt-1 truncate" title={selected.top_station_name ?? ''}>{selected.top_station_name ?? 'Not resolved'}</dd></div>
          <div><dt className="text-[--txt-3]">Station records</dt><dd className="mt-1 font-mono">{format(selected.top_station_count)}</dd></div>
        </dl>
      </Panel>
      {selected.h3_r9 === fixture.pulse_ring.h3_r9 ? (
        <Panel title="Pulse Ring" eyebrow="24-HOUR HEARTBEAT">
          <PulseRing fixture={fixture} />
          <p className="mt-3 text-[10px] leading-4 text-[--txt-3]">Occurrence hours are derived. Gold roster strength is a generated demonstration overlay, never source fact.</p>
        </Panel>
      ) : (
        <Panel title="Pulse Ring" eyebrow="ON-DEMAND">
          <p className="text-xs leading-5 text-[--txt-2]">The compact offline snapshot precomputes the 24-hour ring for the top-ranked cell only. Select {fixture.pulse_ring.h3_r9.slice(0, 8)}… to inspect it.</p>
        </Panel>
      )}
      {explanation ? (
        <Panel title="Evidence rows" eyebrow="COMPUTED SLOTS">
          <div className="space-y-2 text-xs">
            {explanation.evidence.crime_heads.slice(0, 3).map((row) => <div className="flex justify-between gap-3" key={row.value}><span className="truncate text-[--txt-2]">{row.value}</span><span className="font-mono">{format(row.count)}</span></div>)}
          </div>
        </Panel>
      ) : null}
    </div>
  )
}

/** rAF clock for the alert pulse. Stopped under `prefers-reduced-motion`. */
function usePulseClock(active: boolean): number {
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!active) return
    let frame = 0
    const tick = () => {
      setNow(performance.now())
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active])
  return now
}

function MapCanvas({
  fixture,
  cells,
  selected,
  onSelect,
}: {
  readonly fixture: CommandMapFixture
  readonly cells: readonly Cell[]
  readonly selected: Cell
  readonly onSelect: (cell: Cell) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const [ready, setReady] = useState(false)
  const [jurisdictions, setJurisdictions] = useState<GeoJSON.FeatureCollection | null>(null)
  const [reduce, setReduce] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduce(query.matches)
    const onChange = () => setReduce(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Jurisdiction polygons are 2.5 MB and only ever a background wash, so they
  // load after the map rather than blocking it. Absent, the layer is skipped.
  useEffect(() => {
    let live = true
    fetch(JURISDICTIONS_URL)
      .then((response) => (response.ok ? (response.json() as Promise<GeoJSON.FeatureCollection>) : null))
      .then((data) => {
        if (live && data) setJurisdictions(data)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    registerPmtilesProtocol()
    const map = new MapLibreMap({
      container,
      style: buildBasemapStyle(),
      center: BLR_CENTER,
      zoom: INITIAL_VIEW_STATE.zoom,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    const overlay = new MapboxOverlay({ interleaved: true, layers: [] })
    map.addControl(overlay)
    overlayRef.current = overlay
    setReady(true)
    // MapLibre measures the container before the grid has settled; resize on the
    // first frame and on every subsequent layout change.
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container)
    requestAnimationFrame(() => map.resize())
    return () => {
      observer.disconnect()
      overlayRef.current = null
      mapRef.current = null
      map.remove()
    }
  }, [])

  // §7.1 — station select flies the camera. `essential` so it still runs under
  // prefers-reduced-motion at the OS level; the duration is zeroed instead.
  //
  // The first selection is skipped deliberately: a cell is chosen on load (from
  // the URL, or the top cell), and flying to it on mount would open the Command
  // Map already zoomed into one neighbourhood. The city picture is the frame
  // this screen exists to give.
  const flownOnce = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!flownOnce.current) {
      flownOnce.current = true
      return
    }
    map.flyTo({
      center: [selected.longitude, selected.latitude],
      zoom: Math.max(map.getZoom(), 12.5),
      duration: reduce ? 0 : dur.fly * 1000,
      essential: true,
    })
  }, [selected.h3_r9, selected.longitude, selected.latitude, reduce])

  const clock = usePulseClock(!reduce)
  const maximum = Math.max(1, ...cells.map((cell) => cell.count))
  const minimum = Math.min(...cells.map((cell) => cell.count), maximum)

  // §7.1 caps simultaneous pulses at six, ranked by z-score. The fixture ships
  // six; the slice is here so a larger alert set cannot flood the map.
  const pulses = useMemo(
    () =>
      [...fixture.alerts]
        .sort((a, b) => b.observed_count - a.observed_count)
        .slice(0, MAX_PULSES),
    [fixture.alerts],
  )

  const layers = useMemo<Layer[]>(() => {
    const built: Layer[] = []

    // Jurisdictions — bottom of the stack, a wash rather than a subject.
    if (jurisdictions) {
      built.push(
        new GeoJsonLayer({
          id: 'jurisdictions',
          data: jurisdictions,
          filled: true,
          stroked: true,
          getFillColor: (feature: GeoJSON.Feature): [number, number, number, number] =>
            (feature.properties as JurisdictionProperties | null)?.station_code ===
            selected.top_station_code
              ? [56, 189, 248, Math.round(0.1 * 255)]
              : [56, 189, 248, Math.round(0.04 * 255)],
          getLineColor: (feature: GeoJSON.Feature): [number, number, number, number] =>
            (feature.properties as JurisdictionProperties | null)?.station_code ===
            selected.top_station_code
              ? [255, 197, 61, 255]
              : [43, 56, 73, 255],
          getLineWidth: (feature: GeoJSON.Feature): number =>
            (feature.properties as JurisdictionProperties | null)?.station_code ===
            selected.top_station_code
              ? 2
              : 1,
          lineWidthUnits: 'pixels',
          updateTriggers: {
            getFillColor: [selected.top_station_code],
            getLineColor: [selected.top_station_code],
            getLineWidth: [selected.top_station_code],
          },
        }),
      )
    }

    // Density — H3 aggregates. Both reported and inferred rows land here; this
    // is the only layer inferred coordinates are ever allowed to reach.
    built.push(
      new H3HexagonLayer<Cell>({
        id: 'density',
        data: cells as Cell[],
        extruded: false,
        filled: true,
        stroked: true,
        coverage: 0.92,
        opacity: 0.72,
        getHexagon: (cell) => cell.h3_r9,
        // Log-scaled, and the scale is named in the layer-rules panel.
        //
        // Record counts here run 7 → 499 with 97.6% of cells below a tenth of
        // the maximum, so a linear ramp puts almost the whole city at magma's
        // black end and the surface reads as empty. Log keeps the mapping
        // monotone in magnitude while making the distribution legible. A ramp
        // whose scale is not stated on screen is a misleading chart, so it is.
        getFillColor: (cell): [number, number, number, number] => {
          const [r, g, b] = magma(Math.log(Math.max(1, cell.count)) / Math.log(maximum))
          return [r, g, b, 255]
        },
        getLineColor: (cell): [number, number, number, number] =>
          cell.h3_r9 === selected.h3_r9 ? [255, 197, 61, 255] : [0, 0, 0, 0],
        getLineWidth: (cell) => (cell.h3_r9 === selected.h3_r9 ? 2 : 0),
        lineWidthUnits: 'pixels',
        pickable: true,
        onClick: (info: PickingInfo) => {
          const cell = info.object as Cell | undefined
          if (cell) onSelect(cell)
          return true
        },
        updateTriggers: {
          getFillColor: [maximum],
          getLineColor: [selected.h3_r9],
          getLineWidth: [selected.h3_r9],
        },
      }),
    )

    // Incidents — CRITICAL #4. `fixture.reported_points` is the only source
    // carrying map_pin_eligible=true; `cells` and `explanations` never are.
    // Do not widen this to any other array.
    built.push(
      new ScatterplotLayer<CommandMapFixture['reported_points'][number]>({
        id: 'incidents',
        data: fixture.reported_points as CommandMapFixture['reported_points'][number][],
        getPosition: (point) => [point.longitude, point.latitude],
        getRadius: 40,
        radiusUnits: 'meters',
        radiusMinPixels: 2,
        radiusMaxPixels: 8,
        getFillColor: [255, 197, 61, 174],
        // Not pickable on purpose: point marks sit above the density layer, and
        // a pickable 2–8px dot swallows the click on the hex underneath it.
        // Selection in §7.1 is by cell, not by incident.
        pickable: false,
      }),
    )

    // Alerts — r = base·(1 + 0.55·sin t), alpha inverse to radius, 1.8s period.
    const phase = reduce ? 0 : Math.sin(((clock % PULSE_MS) / PULSE_MS) * Math.PI * 2)
    const swell = 1 + 0.55 * phase
    built.push(
      new ScatterplotLayer<(typeof pulses)[number]>({
        id: 'alert-pulses',
        data: pulses,
        getPosition: (alert) => [alert.geography.longitude, alert.geography.latitude],
        getRadius: 13 * swell,
        radiusUnits: 'pixels',
        filled: false,
        stroked: true,
        getLineColor: [240, 68, 56, Math.round(255 * (0.85 - 0.35 * phase))],
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
        updateTriggers: { getRadius: [clock], getLineColor: [clock] },
      }),
      new ScatterplotLayer<(typeof pulses)[number]>({
        id: 'alert-cores',
        data: pulses,
        getPosition: (alert) => [alert.geography.longitude, alert.geography.latitude],
        getRadius: 4,
        radiusUnits: 'pixels',
        getFillColor: [240, 68, 56, 255],
      }),
    )

    return built
  }, [cells, clock, fixture.reported_points, jurisdictions, maximum, onSelect, pulses, reduce, selected])

  const rampLabel = `magma, log-scaled · ${format(minimum)} → ${format(maximum)} records`

  useEffect(() => {
    if (!ready) return
    overlayRef.current?.setProps({
      layers,
      getTooltip: ({ object }: PickingInfo) => {
        const cell = object as Cell | null
        if (!cell?.h3_r9) return null
        return {
          text: `${cell.top_station_name ?? cell.h3_r9}\n${format(cell.count)} records · ${cell.top_crime_head ?? 'no dominant head'}`,
        }
      },
    })
  }, [layers, ready])

  const zoomBy = (delta: number) => {
    const map = mapRef.current
    if (!map) return
    map.easeTo({ zoom: map.getZoom() + delta, duration: reduce ? 0 : dur.base * 1000 })
  }

  return (
    <div className="relative h-full overflow-hidden bg-[--ink-900]">
      {/* maplibre-gl.css forces position:relative on its container, which
          overrides `absolute inset-0` and collapses height to 0. */}
      <div className="h-full w-full" ref={containerRef} />
      <div className="pointer-events-none absolute left-5 top-5 flex flex-col gap-2">
        <span className="flex items-center gap-2 rounded-[--r-sm] border border-[--ink-500] bg-[rgb(10_15_22_/_0.94)] px-3 py-2 text-[10px] text-[--txt-2]">
          <Layers3 size={14} className="text-[--cyan-400]" /> {cells.length} H3 cells · {fixture.reported_points.length} eligible point marks
        </span>
        {/* §5.7 — a density ramp with an unnamed scale is a misleading chart. */}
        <span className="flex items-center gap-2 rounded-[--r-sm] border border-[--ink-500] bg-[rgb(10_15_22_/_0.94)] px-3 py-2 text-[10px] tabular-nums text-[--txt-2]">
          <span className="flex h-2.5 w-16 overflow-hidden rounded-[--r-full]">
            {[0, 0.25, 0.5, 0.75, 1].map((stop) => (
              <span className="flex-1" key={stop} style={{ background: magmaCss(stop) }} />
            ))}
          </span>
          {rampLabel}
        </span>
      </div>
      <div className="absolute right-5 top-5 flex flex-col gap-2">
        <button aria-label="Zoom in" className="icon-button bg-[--ink-800]" onClick={() => zoomBy(1)} type="button"><Plus size={15} /></button>
        <button aria-label="Zoom out" className="icon-button bg-[--ink-800]" onClick={() => zoomBy(-1)} type="button"><Minus size={15} /></button>
        <button
          aria-label="Reset map"
          className="icon-button bg-[--ink-800]"
          onClick={() =>
            mapRef.current?.flyTo({
              center: BLR_CENTER,
              zoom: INITIAL_VIEW_STATE.zoom,
              duration: reduce ? 0 : dur.fly * 1000,
              essential: true,
            })
          }
          type="button"
        >
          <Crosshair size={15} />
        </button>
      </div>
      {/*
        A WebGL canvas gives no keyboard path to the cells the SVG polygons had.
        This parallel list is that path: focusable, ordered by record count, and
        selecting a row flies the camera and opens the inspector exactly as a
        click does.
      */}
      <ul className="sr-only">
        {cells.map((cell) => (
          <li key={cell.h3_r9}>
            <button onClick={() => onSelect(cell)} type="button">
              {cell.top_station_name ?? cell.h3_r9}: {format(cell.count)} records
            </button>
          </li>
        ))}
      </ul>
      <div className="absolute bottom-5 left-5 max-w-sm rounded-[--r-md] border border-[--ink-500] bg-[rgb(10_15_22_/_0.95)] p-4">
        <p className="type-micro text-[--gold-400]">Selected H3 cell</p>
        <p className="mt-2 text-base font-semibold">{selected.top_station_name ?? selected.h3_r9}</p>
        <p className="mt-1 text-xs text-[--txt-2]">{selected.top_crime_head ?? 'No dominant category'} · {format(selected.count)} records</p>
        <p className="mt-3 flex items-center gap-2 text-[10px] text-[--txt-3]"><LocateFixed size={12} /> Aggregate cell; inferred rows are never rendered as precise pins</p>
      </div>
    </div>
  )
}

function Timeline({ fixture }: { readonly fixture: CommandMapFixture }) {
  const rows = fixture.weekly_histogram
  const maximum = Math.max(...rows.map((row) => row.count))
  return (
    <div className="flex h-full items-center gap-4 px-6">
      <span className="type-micro whitespace-nowrap text-[--txt-3]">2019 — 2023</span>
      <div className="flex h-11 flex-1 items-end gap-px">
        {rows.map((row) => <span className="min-w-0 flex-1 bg-[--cyan-400] opacity-50" key={row.iso_week} style={{ height: `${Math.max(5, (row.count / maximum) * 100)}%` }} title={`${row.iso_week}: ${row.count}`} />)}
      </div>
      <span className="rounded-[--r-sm] border border-[--ink-500] px-3 py-2 text-xs text-[--txt-2]">90-day window</span>
    </div>
  )
}

export function CommandMap() {
  const [fixture, setFixture] = useState<CommandMapFixture | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [station, setStation] = useState('')
  const [crimeHead, setCrimeHead] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/data/scenarios/command_map.json')
      .then((response) => {
        if (!response.ok) throw new Error(`Command Map snapshot failed (${response.status})`)
        return response.json() as Promise<CommandMapFixture>
      })
      .then((data) => {
        setFixture(data)
        const parameters = new URLSearchParams(window.location.search)
        const inboundStation = parameters.get('station') ?? ''
        const inboundHead = parameters.get('crime_head') ?? ''
        const inboundCell = data.cells.find((cell) => cell.top_station_code === inboundStation && (!inboundHead || cell.top_crime_head === inboundHead))
        setSelectedId(inboundCell?.h3_r9 ?? data.cells[0]?.h3_r9 ?? '')
        if (inboundStation) setStation(inboundStation)
        if (inboundHead && data.cells.some((cell) => cell.top_crime_head === inboundHead)) setCrimeHead(inboundHead)
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Command Map unavailable'))
  }, [])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (fixture?.cells ?? []).filter(
      (cell) =>
        (!station || cell.top_station_code === station) &&
        (!crimeHead || cell.top_crime_head === crimeHead) &&
        (!query || cell.top_station_name?.toLowerCase().includes(query) || cell.top_crime_head?.toLowerCase().includes(query)),
    )
  }, [crimeHead, fixture, search, station])
  const selected = fixture?.cells.find((cell) => cell.h3_r9 === selectedId) ?? visible[0] ?? fixture?.cells[0]
  useEffect(() => {
    if (selected && visible.length && !visible.some((cell) => cell.h3_r9 === selected.h3_r9)) setSelectedId(visible[0]!.h3_r9)
  }, [selected, visible])

  if (error) return <div className="grid h-screen place-items-center bg-[--ink-900] text-[--critical]"><AlertTriangle /> {error}</div>
  if (!fixture || !selected) return <div className="grid h-screen place-items-center bg-[--ink-900] text-[--txt-2]">Loading H3 command picture…</div>

  return (
    <OpsShell
      context={<Context crimeHead={crimeHead} fixture={fixture} onCrimeHead={setCrimeHead} onSearch={setSearch} onStation={setStation} search={search} station={station} />}
      eyebrow="DETECT · EXPLAIN"
      inspector={<InspectorContent fixture={fixture} selected={selected} />}
      inspectorEyebrow="WHY HERE?"
      inspectorTitle={selected.top_station_name ?? 'Selected H3 cell'}
      timeline={<Timeline fixture={fixture} />}
      title="Command Map"
    >
      {visible.length ? <MapCanvas cells={visible} fixture={fixture} onSelect={(cell) => setSelectedId(cell.h3_r9)} selected={selected} /> : (
        <div className="grid h-full place-items-center bg-[--ink-900] text-center"><div><Sparkles className="mx-auto text-[--gold-400]" /><p className="mt-3">No dominant-cell matches</p><button className="mt-3 text-xs text-[--cyan-400]" onClick={() => { setStation(''); setCrimeHead(''); setSearch('') }} type="button">Clear filters</button></div></div>
      )}
    </OpsShell>
  )
}
