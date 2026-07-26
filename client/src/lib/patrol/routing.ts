import type {
  Deployment,
  DispatchRoute,
  DispatchRoutes,
  PatrolData,
  PatrolScenario,
  PrecomputedOptimizerFallback,
  RoutingRegion,
  HexIndex,
} from './types'
import { publicPath } from '../publicPath'

const DATA_ROOT = publicPath('/data')

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`Unable to load ${path}: ${response.status}`)
  return response.json() as Promise<T>
}

async function fetchTypedArray<T extends Float32Array | Uint32Array>(
  path: string,
  create: (buffer: ArrayBuffer) => T,
): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`Unable to load ${path}: ${response.status}`)
  return create(await response.arrayBuffer())
}

/** Key for the dispatch-route lookup. Origin and destination are cell indices. */
export function routeKey(origin: number, destination: number): string {
  return `${origin}:${destination}`
}

/**
 * The precomputed OSRM path for a dispatch, or `null` if this pair was never
 * precomputed — which is the honest answer for a plan the user built by hand
 * (see `etl/10b_dispatch_routes.ts`). Callers must draw nothing on `null`; a
 * straight line over a street basemap asserts a path that does not exist.
 */
export function dispatchRoute(
  data: PatrolData,
  origin: number,
  destination: number,
): DispatchRoute | null {
  return data.dispatchRoutes.get(routeKey(origin, destination)) ?? null
}

export async function loadPatrolData(): Promise<PatrolData> {
  const [region, hexIndex, scenario, durations, coverage, fallback, routes] = await Promise.all([
    fetchJson<RoutingRegion>(`${DATA_ROOT}/routing/corridor_region.json`),
    fetchJson<HexIndex>(`${DATA_ROOT}/routing/hex_index.json`),
    fetchJson<PatrolScenario>(`${DATA_ROOT}/scenarios/demo_corridor_patrol.json`),
    fetchTypedArray(`${DATA_ROOT}/routing/duration_matrix.bin`, (buffer) => new Float32Array(buffer)),
    fetchTypedArray(`${DATA_ROOT}/routing/coverage_bitsets.bin`, (buffer) => new Uint32Array(buffer)),
    fetchJson<PrecomputedOptimizerFallback>(`${DATA_ROOT}/scenarios/optimizer_fallback.json`),
    fetchJson<DispatchRoutes>(`${DATA_ROOT}/routing/dispatch_routes.json`),
  ])
  if (hexIndex.cells.length !== region.cells) throw new Error('Routing index does not match region')
  if (durations.length !== region.cells * region.cells) throw new Error('Duration matrix size mismatch')
  const expectedCoverage =
    region.cells * region.response_budgets_seconds.length * region.words_per_bitset
  if (coverage.length !== expectedCoverage) throw new Error('Coverage bitset size mismatch')
  if (fallback.scenario_id !== scenario.scenario_id) throw new Error('Optimizer fallback scenario mismatch')
  if (routes.scenario_id !== scenario.scenario_id) throw new Error('Dispatch route scenario mismatch')
  const dispatchRoutes = new Map(
    routes.routes.map((route) => [routeKey(route.origin, route.destination), route]),
  )
  return { region, hexIndex, scenario, durations, coverage, fallback, dispatchRoutes }
}

export function budgetIndex(region: RoutingRegion, targetMinutes: number): number {
  const targetSeconds = targetMinutes * 60
  const exact = region.response_budgets_seconds.indexOf(targetSeconds)
  if (exact >= 0) return exact
  return region.response_budgets_seconds.findIndex((budget) => budget >= targetSeconds)
}

export function bitsetAt(data: PatrolData, origin: number, selectedBudget: number): Uint32Array {
  const { words_per_bitset: words } = data.region
  const offset =
    (origin * data.region.response_budgets_seconds.length + selectedBudget) * words
  return data.coverage.subarray(offset, offset + words)
}

export function unionCoverage(
  data: PatrolData,
  deployment: Deployment,
  selectedBudget: number,
): Uint32Array {
  const out = new Uint32Array(data.region.words_per_bitset)
  for (const origin of Object.values(deployment)) {
    if (origin === null) continue
    const bitset = bitsetAt(data, origin, selectedBudget)
    for (let word = 0; word < out.length; word += 1) {
      out[word] = (out[word] ?? 0) | (bitset[word] ?? 0)
    }
  }
  return out
}

export function isCovered(bitset: Uint32Array, hexIndex: number): boolean {
  return Boolean((bitset[hexIndex >>> 5] ?? 0) & (1 << (hexIndex & 31)))
}

export function travelSeconds(data: PatrolData, origin: number, destination: number): number {
  return data.durations[origin * data.region.cells + destination] ?? Number.POSITIVE_INFINITY
}
