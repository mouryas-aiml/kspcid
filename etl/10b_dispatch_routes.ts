/**
 * 10b — dispatch route geometry for the Patrol Lab trail (BUILD_SPEC §8.9).
 *
 * §8.9 draws the dispatch trail "along the real OSRM route geometry". No such
 * geometry existed: `08_routing_matrix.ts` queries OSRM with `overview=false`,
 * because the duration matrix only ever needed scalars. Drawing a straight line
 * between two hex centroids over a real street basemap would assert a path that
 * does not exist, so the layer stayed unbuilt until this step.
 *
 * Scope — why this is a few hundred routes and not 1.34 million.
 *
 * Routing arbitrary origin × destination over the corridor is 1,159² pairs and
 * unaffordable. But a replay is deterministic and each incident is served by
 * exactly one unit (`simulation.ts`), so the only trails the demo can ever draw
 * are the ones the two reference plans produce: the baseline posts and the
 * stored optimizer deployment, 120 replay events each. Conditions modify
 * durations, not geometry (§8.4), so rain and closure need no extra routes.
 *
 * What this deliberately does NOT cover: a plan the user builds by hand. Moving
 * a unit produces an origin no precompute can anticipate. Online, the client can
 * query local OSRM live; offline, that plan gets no trail. That gap is real and
 * is stated in the artifact rather than papered over with a straight line.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { baselineDeployment, initialDeployment } from '../client/src/lib/patrol/optimizer.js'
import { simulateUntil } from '../client/src/lib/patrol/simulation.js'
import type {
  Deployment,
  PatrolData,
  PrecomputedOptimizerFallback,
} from '../client/src/lib/patrol/types.js'
import { OUTPUT } from './00_config.js'
import { GENERATION_VERSION, sha256File } from './lib/hash.js'

const OSRM_URL = process.env.KSPCID_OSRM_URL ?? 'http://localhost:5001'
const OUTPUT_PATH = resolve(OUTPUT.routing, 'dispatch_routes.json')

/**
 * Coordinate precision. 5 decimal places is ~1.1 m at this latitude — below the
 * width of the trail at every zoom the Patrol Lab reaches, and it keeps the
 * artifact roughly a third the size of raw OSRM output.
 */
const COORD_DP = 5

interface OsrmRouteResponse {
  readonly code: string
  readonly routes: Array<{
    readonly duration: number
    readonly distance: number
    readonly geometry: { readonly coordinates: Array<[number, number]> }
  }>
  readonly message?: string
}

interface DispatchRouteRecord {
  readonly origin: number
  readonly destination: number
  readonly plans: readonly string[]
  readonly osrm_duration_seconds: number
  readonly osrm_distance_m: number
  readonly points: number
  readonly geometry: Array<[number, number]>
}

function float32(bytes: Uint8Array): Float32Array {
  const copy = bytes.slice()
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4)
}

function uint32(bytes: Uint8Array): Uint32Array {
  const copy = bytes.slice()
  return new Uint32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4)
}

async function loadData(): Promise<PatrolData> {
  const [region, hexIndex, scenario, fallback, durationBytes, coverageBytes] = await Promise.all([
    readFile(resolve(OUTPUT.routing, 'corridor_region.json'), 'utf8').then(JSON.parse),
    readFile(resolve(OUTPUT.routing, 'hex_index.json'), 'utf8').then(JSON.parse),
    readFile(resolve(OUTPUT.scenarios, 'demo_corridor_patrol.json'), 'utf8').then(JSON.parse),
    readFile(resolve(OUTPUT.scenarios, 'optimizer_fallback.json'), 'utf8').then(JSON.parse),
    readFile(resolve(OUTPUT.routing, 'duration_matrix.bin')),
    readFile(resolve(OUTPUT.routing, 'coverage_bitsets.bin')),
  ])
  return {
    region,
    hexIndex,
    scenario,
    fallback: fallback as PrecomputedOptimizerFallback,
    durations: float32(durationBytes),
    coverage: uint32(coverageBytes),
    // This step *produces* the routes; the replay it runs never reads them.
    dispatchRoutes: new Map(),
  } satisfies PatrolData
}

/**
 * Replay a plan and collect the origin → destination pair behind every dispatch.
 *
 * This runs the shipping `simulateUntil`, not a re-implementation of it, so the
 * pairs precomputed here are exactly the pairs the client will ask for. A miss
 * has no unit and therefore no trail.
 */
function pairsForPlan(data: PatrolData, deployment: Deployment): Set<string> {
  const lastMinute = data.scenario.replay_events.reduce(
    (latest, event) => Math.max(latest, event.simulation_minute),
    0,
  )
  const snapshot = simulateUntil(data, deployment, lastMinute, false, false)
  const pairs = new Set<string>()
  for (const dispatch of snapshot.dispatches) {
    if (!dispatch.unitId) continue
    const origin = deployment[dispatch.unitId]
    if (origin === null || origin === undefined) continue
    if (origin === dispatch.event.hex_index) continue
    pairs.add(`${origin}:${dispatch.event.hex_index}`)
  }
  return pairs
}

async function fetchRoute(
  data: PatrolData,
  origin: number,
  destination: number,
): Promise<{ duration: number; distance: number; geometry: Array<[number, number]> }> {
  const from = data.hexIndex.cells[origin]
  const to = data.hexIndex.cells[destination]
  if (!from || !to) throw new Error(`Hex index out of range: ${origin} → ${destination}`)
  // Same raw centroids the duration matrix sent, so OSRM snaps identically and
  // the drawn path belongs to the duration the score was computed from.
  const url =
    `${OSRM_URL}/route/v1/driving/` +
    `${from.longitude.toFixed(6)},${from.latitude.toFixed(6)};` +
    `${to.longitude.toFixed(6)},${to.latitude.toFixed(6)}` +
    '?overview=full&geometries=geojson&steps=false&alternatives=false'
  const response = await fetch(url)
  if (!response.ok) throw new Error(`OSRM HTTP ${response.status}: ${await response.text()}`)
  const payload = (await response.json()) as OsrmRouteResponse
  const route = payload.routes[0]
  if (payload.code !== 'Ok' || !route) {
    throw new Error(`OSRM route failed for ${origin} → ${destination}: ${payload.code}`)
  }
  const geometry = route.geometry.coordinates.map(
    ([lon, lat]) =>
      [Number(lon.toFixed(COORD_DP)), Number(lat.toFixed(COORD_DP))] as [number, number],
  )
  if (geometry.length < 2) {
    throw new Error(`OSRM returned a degenerate geometry for ${origin} → ${destination}`)
  }
  return { duration: route.duration, distance: route.distance, geometry }
}

async function main(): Promise<void> {
  const data = await loadData()
  const reserve = data.scenario.planning_defaults.reserve_units
  // Three reference plans, not two. `opening` is the plan the Patrol Lab loads
  // with (roster start posts) and is the one most trails are drawn from; the
  // three-way end card compares `baseline` against the player's plan and
  // `optimizer`. All three are deterministic, so all three are precomputable.
  const plans: Array<readonly [string, Deployment]> = [
    ['opening', initialDeployment(data, reserve)],
    ['baseline', baselineDeployment(data, reserve)],
    ['optimizer', data.fallback.deployment],
  ]

  const planPairs = plans.map(([id, deployment]) => [id, pairsForPlan(data, deployment)] as const)
  const planFor = new Map<string, string[]>()
  for (const [id, pairs] of planPairs) {
    for (const key of pairs) {
      const existing = planFor.get(key)
      if (existing) existing.push(id)
      else planFor.set(key, [id])
    }
  }
  // Sorted so regeneration from a checksummed input is byte-identical (§14.6).
  const keys = [...planFor.keys()].sort((a, b) => {
    const [aOrigin, aDestination] = a.split(':').map(Number) as [number, number]
    const [bOrigin, bDestination] = b.split(':').map(Number) as [number, number]
    return aOrigin - bOrigin || aDestination - bDestination
  })

  const routes: DispatchRouteRecord[] = []
  for (const key of keys) {
    const [origin, destination] = key.split(':').map(Number) as [number, number]
    const route = await fetchRoute(data, origin, destination)
    routes.push({
      origin,
      destination,
      plans: planFor.get(key) ?? [],
      osrm_duration_seconds: route.duration,
      osrm_distance_m: route.distance,
      points: route.geometry.length,
      geometry: route.geometry,
    })
  }

  const [scenarioChecksum, matrixChecksum] = await Promise.all([
    sha256File(resolve(OUTPUT.scenarios, 'demo_corridor_patrol.json')),
    sha256File(resolve(OUTPUT.routing, 'duration_matrix.bin')),
  ])

  const document = {
    schema_version: 1,
    region_id: data.region.id,
    scenario_id: data.scenario.scenario_id,
    coordinate_order: 'lon,lat',
    coordinate_decimal_places: COORD_DP,
    conditions: 'free_flow',
    // §8.4 — conditions modify durations, not geometry. One path per pair.
    geometry_varies_with_conditions: false,
    plans: plans.map(([id]) => id),
    plan_pair_counts: Object.fromEntries(planPairs.map(([id, pairs]) => [id, pairs.size])),
    routes_total: routes.length,
    total_points: routes.reduce((sum, route) => sum + route.points, 0),
    coverage_note:
      'Precomputed for the baseline and stored-optimizer replays only. A plan the ' +
      'user builds by hand produces origins no precompute can anticipate: those ' +
      'dispatches draw no trail rather than a straight line.',
    routes,
    source_authority: 'open_reference',
    transformation: 'derived',
    method: 'osrm_dispatch_geometry_v1',
    source_checksum: scenarioChecksum,
    routing_source_checksum: matrixChecksum,
    generation_version: GENERATION_VERSION,
  }

  await writeFile(OUTPUT_PATH, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  const bytes = (await readFile(OUTPUT_PATH)).byteLength
  process.stdout.write(
    `10b dispatch routes — WROTE\n` +
      `  OSRM                ${OSRM_URL}\n` +
      `  plans               ${planPairs.map(([id, pairs]) => `${id} ${pairs.size}`).join(' · ')}\n` +
      `  unique routes       ${routes.length}\n` +
      `  geometry points     ${document.total_points.toLocaleString()}\n` +
      `  artifact            ${(bytes / 1024).toFixed(0)} KB\n`,
  )
}

await main()
