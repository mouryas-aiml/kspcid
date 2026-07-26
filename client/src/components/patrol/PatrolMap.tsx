'use client'

/**
 * Patrol Lab map surface — BUILD_SPEC §8.9.
 *
 * MapLibre GL basemap (self-hosted PMTiles, §3.4) with deck.gl layers attached
 * as a MapboxOverlay in interleaved mode, so street labels composite above the
 * demand surface rather than being buried by it.
 *
 * This is a RENDERER only. Geometry, coverage bitsets and scoring are untouched
 * — every cell already carries real lat/lon, so H3HexagonLayer consumes the H3
 * index directly. See reports/t0_spike.md for why maplibre-gl is driven
 * directly rather than through react-map-gl.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { H3HexagonLayer, TripsLayer } from '@deck.gl/geo-layers'
import { IconLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers'
import { PathStyleExtension } from '@deck.gl/extensions'
import type { Layer, PickingInfo } from '@deck.gl/core'
import { Map as MapLibreMap } from 'maplibre-gl'
import { cellsToMultiPolygon } from 'h3-js'
import { interpolateMagma } from 'd3-scale-chromatic'
import { useReducedMotion } from 'motion/react'

import { buildBasemapStyle, registerPmtilesProtocol } from '@/lib/map/basemap'
import { dispatchRoute, isCovered, unionCoverage } from '@/lib/patrol/routing'
import { simulateUntil } from '@/lib/patrol/simulation'
import { usePatrolStore } from '@/lib/patrol/store'
import type { PatrolData, ScoreBreakdown } from '@/lib/patrol/types'
import 'maplibre-gl/dist/maplibre-gl.css'

type RGBA = [number, number, number, number]

const unitColour: Record<string, [number, number, number]> = {
  Hoysala: [56, 189, 248],
  Cheetah: [255, 197, 61],
  'Foot patrol': [45, 212, 191],
  'Pink Hoysala': [244, 114, 182],
  Traffic: [247, 144, 9],
}

/** §5.2 — interpolateMagma domain-clipped to [0.12, 0.94]. Never hand-rolled. */
function magma(intensity: number): [number, number, number] {
  const clipped = 0.12 + Math.max(0, Math.min(1, intensity)) * (0.94 - 0.12)
  const parsed = interpolateMagma(clipped).match(/\d+/g)
  if (!parsed || parsed.length < 3) return [0, 0, 0]
  return [Number(parsed[0]), Number(parsed[1]), Number(parsed[2])]
}

/** Incident shockwave — radius 0→40px, alpha 0.9→0 over 700ms (§8.9). */
const SHOCKWAVE_MS = 700
/** Radial coverage reveal on drop — 500ms (§8.9). */
const REVEAL_MS = 500
/** Idle unit breathe — scale 1.00 ↔ 1.04 over 2.4s (§8.9). */
const BREATHE_MS = 2400
/** Dispatch trail length, in seconds of simulation time (§8.9). */
const TRAIL_LENGTH_S = 90
/** Arrival ring — expands over 400ms, then the incident dot turns solid green (§8.9). */
const ARRIVAL_RING_MS = 400

/**
 * A dispatch in flight, resolved onto its precomputed OSRM path.
 *
 * `timestamps` are seconds of simulation time, so `TripsLayer.currentTime` is
 * just the playback minute × 60 and the head sits where the unit actually is.
 * Vertices are spaced by cumulative great-circle distance rather than evenly,
 * so the head does not lurch through the dense parts of the polyline.
 */
interface Trail {
  readonly key: string
  readonly path: [number, number][]
  readonly timestamps: number[]
}

function haversineMetres(a: readonly [number, number], b: readonly [number, number]): number {
  const toRad = Math.PI / 180
  const dLat = (b[1] - a[1]) * toRad
  const dLon = (b[0] - a[0]) * toRad
  const lat = ((a[1] + b[1]) / 2) * toRad
  const x = dLon * Math.cos(lat)
  return Math.hypot(x, dLat) * 6_371_000
}

function buildTrail(
  key: string,
  geometry: readonly (readonly [number, number])[],
  startSeconds: number,
  travelSecondsTotal: number,
): Trail | null {
  if (geometry.length < 2 || travelSecondsTotal <= 0) return null
  const cumulative = [0]
  for (let i = 1; i < geometry.length; i += 1) {
    cumulative.push((cumulative[i - 1] ?? 0) + haversineMetres(geometry[i - 1]!, geometry[i]!))
  }
  const total = cumulative[cumulative.length - 1] ?? 0
  if (total <= 0) return null
  return {
    key,
    path: geometry.map(([lon, lat]) => [lon, lat] as [number, number]),
    timestamps: cumulative.map(
      (distance) => startSeconds + (distance / total) * travelSecondsTotal,
    ),
  }
}

function useAnimationClock(active: boolean): number {
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

/** 34px hexagonal unit chip, drawn once per colour into a data URL (§8.9). */
function unitIcon(colour: [number, number, number], selected: boolean): string {
  const stroke = `rgb(${colour.join(',')})`
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="68" height="68" viewBox="-34 -34 68 68">` +
    `<path d="M0,-26 L22,-13 L22,13 L0,26 L-22,13 L-22,-13 Z" fill="#10161F" ` +
    `stroke="${stroke}" stroke-width="${selected ? 6 : 4}"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function PatrolMap({
  data,
  score,
  minute,
  rain,
  roadClosure,
}: {
  readonly data: PatrolData
  readonly score: ScoreBreakdown
  readonly minute: number
  readonly rain: boolean
  readonly roadClosure: boolean
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const [ready, setReady] = useState(false)

  const deployment = usePatrolStore((state) => state.deployment)
  const selectedUnit = usePatrolStore((state) => state.selectedUnit)
  const selectUnit = usePatrolStore((state) => state.selectUnit)
  const deploySelected = usePatrolStore((state) => state.deploySelected)
  const targetMinutes = usePatrolStore((state) => state.targetMinutes)
  const showGhost = usePatrolStore((state) => state.showGhost)
  const optimized = usePatrolStore((state) => state.optimized)
  const reduce = useReducedMotion()

  const demand = useMemo(
    () =>
      new Map(
        data.scenario.demand_model.demand.map((cell) => [
          cell.hex_index,
          cell.recency_weighted_demand,
        ]),
      ),
    [data],
  )
  const maxDemand = useMemo(() => Math.max(...demand.values()), [demand])
  const selectedBudget = data.region.response_budgets_seconds.indexOf(targetMinutes * 60)
  const coverage = useMemo(
    () => unionCoverage(data, deployment, Math.max(0, selectedBudget)),
    [data, deployment, selectedBudget],
  )
  const snapshot = useMemo(
    () => simulateUntil(data, deployment, minute, rain, roadClosure),
    [data, deployment, minute, rain, roadClosure],
  )

  // Fit to the routing region rather than guessing a zoom — the corridor is a
  // small slice of BLR_BBOX and a fixed zoom leaves streets too thin to read.
  const bounds = useMemo(() => {
    const cells = data.hexIndex.cells
    let minLon = Infinity
    let minLat = Infinity
    let maxLon = -Infinity
    let maxLat = -Infinity
    for (const cell of cells) {
      minLon = Math.min(minLon, cell.longitude)
      maxLon = Math.max(maxLon, cell.longitude)
      minLat = Math.min(minLat, cell.latitude)
      maxLat = Math.max(maxLat, cell.latitude)
    }
    return [
      [minLon, minLat],
      [maxLon, maxLat],
    ] as [[number, number], [number, number]]
  }, [data])

  // ── Basemap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    registerPmtilesProtocol()
    const map = new MapLibreMap({
      container,
      style: buildBasemapStyle(),
      center: [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2],
      zoom: 12,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    const overlay = new MapboxOverlay({ interleaved: true, layers: [] })
    map.addControl(overlay)
    overlayRef.current = overlay
    setReady(true)
    // maplibre measures the container before layout settles, so it must be
    // resized before fitBounds — otherwise the fit runs against the 400x300
    // default canvas and lands at the wrong zoom.
    let fitted = false
    const sizeAndFit = () => {
      map.resize()
      if (!fitted && container.clientWidth > 0 && container.clientHeight > 0) {
        fitted = true
        map.fitBounds(bounds, { padding: 48, animate: false })
      }
    }
    const observer = new ResizeObserver(sizeAndFit)
    observer.observe(container)
    requestAnimationFrame(sizeAndFit)
    return () => {
      observer.disconnect()
      overlayRef.current = null
      mapRef.current = null
      map.remove()
    }
  }, [bounds])

  // Covered cells, and the union outline of the road-time blanket (§8.9).
  const coveredH3 = useMemo(
    () => data.hexIndex.cells.filter((cell) => isCovered(coverage, cell.index)).map((c) => c.h3),
    [coverage, data],
  )
  const coverageOutline = useMemo(() => {
    if (coveredH3.length === 0) return []
    // cellsToMultiPolygon gives the true union boundary, not per-hex strokes.
    return cellsToMultiPolygon(coveredH3, true).flatMap((polygon) =>
      polygon.map((ring) => ring.map(([lon, lat]) => [lon, lat] as [number, number])),
    )
  }, [coveredH3])

  // A drop changes the coverage set; the reveal animates from that moment.
  const revealStart = useRef(0)
  useEffect(() => {
    revealStart.current = performance.now()
  }, [coverage])

  const recentDispatches = useMemo(
    () => snapshot.dispatches.filter((d) => minute - d.event.simulation_minute < 22),
    [snapshot, minute],
  )
  const missedEver = useMemo(
    () => snapshot.dispatches.filter((d) => d.result === 'missed'),
    [snapshot],
  )
  const committedUnits = useMemo(
    () =>
      new Set(
        snapshot.dispatches
          .filter((d) => ['enroute', 'on_scene', 'returning'].includes(d.result))
          .flatMap((d) => d.unitId ?? []),
      ),
    [snapshot],
  )

  // Dispatch trails — only for pairs `10b_dispatch_routes.ts` precomputed.
  // A hand-built plan produces origins no precompute anticipated; those draw no
  // trail rather than a straight line that asserts a path OSRM never returned.
  const trails = useMemo<Trail[]>(() => {
    const built: Trail[] = []
    for (const dispatch of snapshot.dispatches) {
      if (dispatch.unitId === null || dispatch.responseMinutes === null) continue
      const origin = deployment[dispatch.unitId]
      if (origin === null || origin === undefined) continue
      const destination = dispatch.event.hex_index
      const route = dispatchRoute(data, origin, destination)
      if (!route) continue
      // Math.ceil matches simulation.ts, so the head lands exactly when the
      // dispatch flips to on_scene rather than a fraction of a minute early.
      const travelMinutes = Math.ceil(dispatch.responseMinutes)
      const startSeconds = dispatch.event.simulation_minute * 60
      if (minute * 60 > startSeconds + travelMinutes * 60 + TRAIL_LENGTH_S) continue
      const trail = buildTrail(
        `${dispatch.event.incident_id}:${dispatch.unitId}`,
        route.geometry,
        startSeconds,
        travelMinutes * 60,
      )
      if (trail) built.push(trail)
    }
    return built
  }, [snapshot, deployment, data, minute])

  // Arrival rings are wall-clock (§8.9: 400ms), so the ring is recorded the
  // first time a dispatch is seen arrived and expires on its own.
  const arrivals = useRef(new Map<string, number>())
  const arrivedKeys = useMemo(
    () =>
      snapshot.dispatches
        .filter((d) => d.unitId && d.result !== 'missed' && d.result !== 'enroute')
        .map((d) => `${d.event.incident_id}:${d.unitId}`),
    [snapshot],
  )
  useEffect(() => {
    const seen = new Set(arrivedKeys)
    const now = performance.now()
    for (const key of seen) {
      if (!arrivals.current.has(key)) arrivals.current.set(key, now)
    }
    // Scrubbing backwards un-arrives dispatches; drop them so replaying the
    // same minute plays the ring again instead of silently skipping it.
    for (const key of arrivals.current.keys()) {
      if (!seen.has(key)) arrivals.current.delete(key)
    }
  }, [arrivedKeys])

  const clock = useAnimationClock(!reduce)

  const layers = useMemo<Layer[]>(() => {
    const elapsedReveal = Math.min(1, (clock - revealStart.current) / REVEAL_MS)
    const breathe = reduce ? 1 : 1 + 0.04 * Math.sin((clock / BREATHE_MS) * Math.PI * 2)

    const built: Layer[] = [
      // Demand surface — magma, clipped 0.12–0.94.
      new H3HexagonLayer<{ h3: string; index: number; value: number }>({
        id: 'demand',
        data: data.hexIndex.cells.map((cell) => ({
          h3: cell.h3,
          index: cell.index,
          value: demand.get(cell.index) ?? 0,
        })),
        extruded: false,
        filled: true,
        stroked: false,
        coverage: 0.94,
        getHexagon: (d) => d.h3,
        getFillColor: (d): RGBA => {
          // Zero-demand cells stay fully transparent. Painting them veils the
          // basemap, and T1 acceptance requires streets visible underneath.
          if (d.value <= 0) return [0, 0, 0, 0]
          const intensity = maxDemand > 0 ? d.value / maxDemand : 0
          const [r, g, b] = magma(intensity)
          return [r, g, b, Math.round((0.5 + intensity * 0.42) * 255)]
        },
        pickable: true,
        onClick: (info: PickingInfo) => {
          const object = info.object as { index: number } | undefined
          if (object) deploySelected(object.index)
          return true
        },
        updateTriggers: { getFillColor: [maxDemand, demand] },
      }),

      // Coverage blanket — teal-400 @ 0.14 fill, radially revealed over 500ms.
      new H3HexagonLayer<{ h3: string }>({
        id: 'coverage-blanket',
        data: coveredH3.map((h3) => ({ h3 })),
        extruded: false,
        filled: true,
        stroked: false,
        coverage: 0.94,
        getHexagon: (d) => d.h3,
        getFillColor: [45, 212, 191, Math.round(0.14 * 255 * elapsedReveal)],
        updateTriggers: { getFillColor: [elapsedReveal] },
      }),

      // Union outline — teal-400 @ 0.6, 1.5px, dashed [6,4].
      // PathStyleExtension's dash props are not in PathLayer's prop type, so the
      // options object is asserted once rather than each prop individually.
      new PathLayer(
        {
          id: 'coverage-outline',
          data: coverageOutline.map((ring) => ({ path: ring })),
          getPath: (d: { path: [number, number][] }) => d.path,
          getColor: [45, 212, 191, Math.round(0.6 * 255 * elapsedReveal)],
          getWidth: 1.5,
          widthUnits: 'pixels',
          getDashArray: [6, 4],
          dashJustified: true,
          extensions: [new PathStyleExtension({ dash: true })],
          updateTriggers: { getColor: [elapsedReveal] },
        } as ConstructorParameters<typeof PathLayer>[0],
      ),
    ]

    // Optimized ghost overlay — §8.9 calls this the strongest single interaction.
    if (showGhost && optimized) {
      const ghosts = Object.entries(optimized.deployment)
        .map(([unitId, hexIndex]) =>
          hexIndex === null ? null : { unitId, cell: data.hexIndex.cells[hexIndex] },
        )
        .filter((g): g is { unitId: string; cell: NonNullable<(typeof data.hexIndex.cells)[0]> } =>
          Boolean(g?.cell),
        )
      built.push(
        new ScatterplotLayer<(typeof ghosts)[0]>({
          id: 'ghost-posts',
          data: ghosts,
          getPosition: (d) => [d.cell.longitude, d.cell.latitude],
          getRadius: 15,
          radiusUnits: 'pixels',
          filled: false,
          stroked: true,
          getLineColor: [167, 139, 250, 170],
          getLineWidth: 2,
          lineWidthUnits: 'pixels',
        }),
      )
    }

    // Missed incidents keep a permanent critical ring (§8.9).
    built.push(
      new ScatterplotLayer<{ lon: number; lat: number }>({
        id: 'missed-rings',
        data: missedEver
          .map((d) => data.hexIndex.cells[d.event.hex_index])
          .filter(Boolean)
          .map((cell) => ({ lon: cell!.longitude, lat: cell!.latitude })),
        getPosition: (d) => [d.lon, d.lat],
        getRadius: 11,
        radiusUnits: 'pixels',
        filled: false,
        stroked: true,
        getLineColor: [240, 68, 56, 220],
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
      }),
    )

    // Incident spawn shockwave — radius 0→40px, alpha 0.9→0 over 700ms.
    if (!reduce) {
      built.push(
        new ScatterplotLayer<{ lon: number; lat: number; age: number; missed: boolean }>({
          id: 'incident-shockwave',
          data: recentDispatches
            .map((d) => {
              const cell = data.hexIndex.cells[d.event.hex_index]
              if (!cell) return null
              const age = ((clock / 1000) % (SHOCKWAVE_MS / 1000)) / (SHOCKWAVE_MS / 1000)
              return {
                lon: cell.longitude,
                lat: cell.latitude,
                age,
                missed: d.result === 'missed',
              }
            })
            .filter((d): d is NonNullable<typeof d> => d !== null),
          getPosition: (d) => [d.lon, d.lat],
          getRadius: (d) => d.age * 40,
          radiusUnits: 'pixels',
          filled: false,
          stroked: true,
          getLineColor: (d): RGBA =>
            d.missed
              ? [240, 68, 56, Math.round((0.9 - d.age * 0.9) * 255)]
              : [255, 197, 61, Math.round((0.9 - d.age * 0.9) * 255)],
          getLineWidth: 2,
          lineWidthUnits: 'pixels',
          updateTriggers: { getRadius: [clock], getLineColor: [clock] },
        }),
      )
    }

    // Dispatch trail along the real OSRM route geometry (§8.9).
    if (trails.length > 0) {
      built.push(
        new TripsLayer<Trail>({
          id: 'dispatch-trails',
          data: trails,
          getPath: (d) => d.path,
          getTimestamps: (d) => d.timestamps,
          getColor: [56, 189, 248],
          getWidth: 3,
          widthUnits: 'pixels',
          opacity: 0.85,
          trailLength: TRAIL_LENGTH_S,
          currentTime: minute * 60,
          fadeTrail: true,
          capRounded: true,
          jointRounded: true,
        }),
      )
      // Head — 6px cyan dot at the interpolated position along the same path.
      const heads = trails
        .map((trail) => {
          const now = minute * 60
          const last = trail.timestamps[trail.timestamps.length - 1] ?? 0
          if (now < (trail.timestamps[0] ?? 0) || now > last) return null
          let i = 1
          while (i < trail.timestamps.length && (trail.timestamps[i] ?? 0) < now) i += 1
          const t0 = trail.timestamps[i - 1] ?? 0
          const t1 = trail.timestamps[i] ?? t0
          const a = trail.path[i - 1]!
          const b = trail.path[i] ?? a
          const f = t1 > t0 ? (now - t0) / (t1 - t0) : 0
          return {
            key: trail.key,
            lon: a[0] + (b[0] - a[0]) * f,
            lat: a[1] + (b[1] - a[1]) * f,
          }
        })
        .filter((h): h is NonNullable<typeof h> => h !== null)
      if (heads.length > 0) {
        built.push(
          new ScatterplotLayer<(typeof heads)[0]>({
            id: 'dispatch-heads',
            data: heads,
            getPosition: (d) => [d.lon, d.lat],
            getRadius: 3,
            radiusUnits: 'pixels',
            getFillColor: [56, 189, 248, 255],
          }),
        )
      }
    }

    // Arrival ring — 400ms expanding --ok, then the incident dot goes solid green.
    if (!reduce) {
      const rings = recentDispatches
        .map((d) => {
          if (!d.unitId || d.result === 'missed' || d.result === 'enroute') return null
          const started = arrivals.current.get(`${d.event.incident_id}:${d.unitId}`)
          if (started === undefined) return null
          const progress = (clock - started) / ARRIVAL_RING_MS
          if (progress < 0 || progress > 1) return null
          const cell = data.hexIndex.cells[d.event.hex_index]
          if (!cell) return null
          return { lon: cell.longitude, lat: cell.latitude, progress }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
      if (rings.length > 0) {
        built.push(
          new ScatterplotLayer<(typeof rings)[0]>({
            id: 'arrival-rings',
            data: rings,
            getPosition: (d) => [d.lon, d.lat],
            getRadius: (d) => 4 + d.progress * 16,
            radiusUnits: 'pixels',
            filled: false,
            stroked: true,
            getLineColor: (d): RGBA => [18, 183, 106, Math.round((1 - d.progress) * 255)],
            getLineWidth: 2,
            lineWidthUnits: 'pixels',
            updateTriggers: { getRadius: [clock], getLineColor: [clock] },
          }),
        )
      }
    }

    // Incident dots — gold while open, --critical when missed, solid --ok once served.
    built.push(
      new ScatterplotLayer<{ lon: number; lat: number; state: 'open' | 'missed' | 'served' }>({
        id: 'incidents',
        data: recentDispatches
          .map((d) => {
            const cell = data.hexIndex.cells[d.event.hex_index]
            if (!cell) return null
            const state =
              d.result === 'missed'
                ? ('missed' as const)
                : d.result === 'enroute'
                  ? ('open' as const)
                  : ('served' as const)
            return { lon: cell.longitude, lat: cell.latitude, state }
          })
          .filter((d): d is NonNullable<typeof d> => d !== null),
        getPosition: (d) => [d.lon, d.lat],
        getRadius: 4.5,
        radiusUnits: 'pixels',
        getFillColor: (d): RGBA =>
          d.state === 'missed'
            ? [240, 68, 56, 255]
            : d.state === 'served'
              ? [18, 183, 106, 255]
              : [255, 197, 61, 255],
        updateTriggers: { getFillColor: [minute] },
      }),
    )

    // Unit tokens — 34px hex chips, type-coloured border, dim when committed.
    const units = data.scenario.roster
      .map((unit) => {
        const hexIndex = deployment[unit.unit_id]
        if (hexIndex === null || hexIndex === undefined) return null
        const cell = data.hexIndex.cells[hexIndex]
        if (!cell) return null
        return {
          unit,
          lon: cell.longitude,
          lat: cell.latitude,
          committed: committedUnits.has(unit.unit_id),
          selected: selectedUnit === unit.unit_id,
        }
      })
      .filter((u): u is NonNullable<typeof u> => u !== null)

    built.push(
      new IconLayer<(typeof units)[0]>({
        id: 'unit-tokens',
        data: units,
        getPosition: (d) => [d.lon, d.lat],
        getIcon: (d) => ({
          url: unitIcon(unitColour[d.unit.unit_type] ?? [248, 250, 252], d.selected),
          width: 68,
          height: 68,
          mask: false,
        }),
        getSize: (d) => (d.selected ? 34 * 1.18 : 34 * (d.committed ? 1 : breathe)),
        sizeUnits: 'pixels',
        getColor: (d): RGBA => [255, 255, 255, d.committed ? 140 : 255],
        pickable: true,
        onClick: (info: PickingInfo) => {
          const object = info.object as { unit: { unit_id: string } } | undefined
          if (object) selectUnit(object.unit.unit_id)
          return true
        },
        updateTriggers: { getSize: [breathe, selectedUnit], getIcon: [selectedUnit] },
      }),
    )

    return built
  }, [
    clock,
    reduce,
    data,
    demand,
    maxDemand,
    coveredH3,
    coverageOutline,
    showGhost,
    optimized,
    missedEver,
    recentDispatches,
    trails,
    minute,
    deployment,
    committedUnits,
    selectedUnit,
    deploySelected,
    selectUnit,
  ])

  useEffect(() => {
    if (!ready) return
    overlayRef.current?.setProps({
      layers,
      getTooltip: ({ object }: PickingInfo) => {
        const cell = object as { h3?: string; value?: number } | undefined
        if (!cell?.h3) return null
        return {
          text: `H3 ${cell.h3}\nweighted demand ${(cell.value ?? 0).toFixed(2)}`,
          style: { fontSize: '11px', fontFamily: 'var(--f-mono)' },
        }
      },
    })
  }, [layers, ready])

  return (
    <div className="relative h-full overflow-hidden bg-[--ink-900]">
      {/* maplibre-gl.css forces position:relative on its container, which
          overrides `absolute inset-0` and collapses height to 0. */}
      <div ref={containerRef} className="h-full w-full" />

      <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap items-center gap-2">
        <span className="map-badge">H3 r9 demand</span>
        <span className="map-badge text-[--teal-400]">{targetMinutes}m road-time blanket</span>
        {selectedUnit ? (
          <span className="map-badge text-[--gold-400]">Choose a destination hex</span>
        ) : null}
      </div>

      {/* A WebGL canvas has no focusable children. This keeps the roster
          keyboard-reachable, replacing the per-token tabIndex the SVG had. */}
      <div
        className="absolute bottom-16 left-4 flex flex-wrap gap-1 opacity-0 transition-opacity focus-within:opacity-100"
        role="group"
        aria-label="Select a patrol unit"
      >
        {data.scenario.roster.map((unit) => (
          <button
            key={unit.unit_id}
            type="button"
            onClick={() => selectUnit(unit.unit_id)}
            aria-pressed={selectedUnit === unit.unit_id}
            className={`rounded-[--r-sm] border px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
              selectedUnit === unit.unit_id
                ? 'border-[--gold-400] text-[--gold-400]'
                : 'border-[--ink-500] text-[--txt-3]'
            }`}
          >
            {unit.call_sign}
          </button>
        ))}
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 max-w-[420px] rounded-[--r-sm] border border-[--ink-500] bg-[rgb(10_15_22_/_0.92)] px-3 py-2 text-[10px] text-[--txt-2]">
        Replay marks are H3 aggregates. Coordinates inferred from text are never rendered as precise pins.
      </div>

      <div className="pointer-events-none absolute right-4 top-4 rounded-[--r-md] border border-[--ink-500] bg-[rgb(10_15_22_/_0.92)] px-3 py-2">
        <span className="type-micro text-[--txt-3]">LIVE PLAN</span>
        <strong
          className="ml-3 font-mono text-xl tabular-nums"
          style={{ color: score.total < 500 ? 'var(--critical)' : score.total < 650 ? 'var(--warn)' : score.total < 790 ? 'var(--cyan-400)' : 'var(--ok)' }}
        >
          {score.total}
        </strong>
      </div>
    </div>
  )
}
