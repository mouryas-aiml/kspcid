/**
 * `kv-optimize` — Catalyst AIO patrol-placement heuristic.
 *
 * This is deliberately the labelled greedy + local-search approximation. It
 * reads the same scenario and routing artifacts through the environment-
 * selected data adapter, so local verification and Catalyst execution share
 * one contract.
 */
import {
  createDataAdapter,
  type CreateDataAdapterOptions,
  type DataAdapter,
} from '../shared/data-access/index.js'

interface OptimizeRequest {
  readonly scenarioId: 'demo-corridor-patrol-2021-2023-night'
  readonly targetMinutes: 3 | 5 | 7 | 10 | 15
  readonly reserveUnits: number
}

interface Region {
  readonly cells: number
  readonly response_budgets_seconds: readonly number[]
  readonly words_per_bitset: number
}

interface Scenario {
  readonly scenario_id: string
  readonly demand_model: {
    readonly demand: readonly {
      readonly hex_index: number
      readonly recency_weighted_demand: number
      readonly beat_demand: readonly {
        readonly beat: string
        readonly recency_weighted_demand: number
      }[]
    }[]
  }
  readonly roster: readonly { readonly unit_id: string }[]
  readonly provenance: {
    readonly source_checksum: string
    readonly generation_version: string
  }
}

export interface OptimizeResponse {
  readonly scenarioId: string
  readonly deployment: Readonly<Record<string, number | null>>
  readonly coveredDemand: number
  readonly coverageRatio: number
  readonly equity: number
  readonly method: 'MCLP-inspired heuristic (greedy + local search)'
  readonly formulationReference: 'Church & ReVelle (1974)'
  readonly iterations: 300
  readonly elapsedMs: number
  readonly source: 'live_heuristic'
  readonly provenance: {
    readonly source_authority: 'third_party_mirror'
    readonly transformation: 'derived'
    readonly method: 'greedy_300_swap_equity_repair'
    readonly source_checksum: string
    readonly generation_version: string
  }
}

function decodeJson<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T
}

function uint32(bytes: Uint8Array): Uint32Array {
  const copy = bytes.slice()
  return new Uint32Array(copy.buffer, copy.byteOffset, copy.byteLength / Uint32Array.BYTES_PER_ELEMENT)
}

function bitsetAt(
  coverage: Uint32Array,
  region: Region,
  origin: number,
  budgetIndex: number,
): Uint32Array {
  const offset =
    (origin * region.response_budgets_seconds.length + budgetIndex) *
    region.words_per_bitset
  return coverage.subarray(offset, offset + region.words_per_bitset)
}

function union(
  positions: readonly number[],
  coverage: Uint32Array,
  region: Region,
  budgetIndex: number,
): Uint32Array {
  const result = new Uint32Array(region.words_per_bitset)
  for (const origin of positions) {
    const candidate = bitsetAt(coverage, region, origin, budgetIndex)
    for (let word = 0; word < result.length; word += 1) {
      result[word] = (result[word] ?? 0) | (candidate[word] ?? 0)
    }
  }
  return result
}

function covered(bitset: Uint32Array, hexIndex: number): boolean {
  return Boolean((bitset[hexIndex >>> 5] ?? 0) & (1 << (hexIndex & 31)))
}

function coverageMeasure(scenario: Scenario, bitset: Uint32Array): {
  hit: number
  total: number
  equity: number
} {
  let hit = 0
  let total = 0
  const beatHit = new Map<string, number>()
  const beatTotal = new Map<string, number>()
  for (const cell of scenario.demand_model.demand) {
    const cellCovered = covered(bitset, cell.hex_index)
    total += cell.recency_weighted_demand
    if (cellCovered) hit += cell.recency_weighted_demand
    for (const beat of cell.beat_demand) {
      beatTotal.set(beat.beat, (beatTotal.get(beat.beat) ?? 0) + beat.recency_weighted_demand)
      if (cellCovered) {
        beatHit.set(beat.beat, (beatHit.get(beat.beat) ?? 0) + beat.recency_weighted_demand)
      }
    }
  }
  const values = [...beatTotal]
    .map(([beat, value]) => (beatHit.get(beat) ?? 0) / value)
    .sort((a, b) => a - b)
  const sum = values.reduce((result, value) => result + value, 0)
  const weighted = values.reduce((result, value, index) => result + (index + 1) * value, 0)
  const gini =
    values.length === 0 || sum === 0
      ? 0
      : (2 * weighted) / (values.length * sum) - (values.length + 1) / values.length
  return { hit, total, equity: 1 - gini }
}

function objective(measure: { hit: number; total: number; equity: number }): number {
  return 400 * (measure.total > 0 ? measure.hit / measure.total : 0) + 150 * measure.equity
}

export async function optimizeWithAdapter(
  request: OptimizeRequest,
  adapter: DataAdapter,
): Promise<OptimizeResponse> {
  const started = performance.now()
  const [regionBytes, scenario, coverageBytes] = await Promise.all([
    adapter.getObject('routing/corridor_region.json'),
    adapter.getDocument<Scenario>({
      collection: 'scenarios',
      id: 'demo_corridor_patrol',
    }),
    adapter.getObject('routing/coverage_bitsets.bin'),
  ])
  const region = decodeJson<Region>(regionBytes)
  if (!scenario) throw new Error('Patrol scenario is missing from NoSQL')
  if (scenario.scenario_id !== request.scenarioId) {
    throw new Error(`Scenario artifact mismatch: ${request.scenarioId}`)
  }
  const budgetIndex = region.response_budgets_seconds.indexOf(request.targetMinutes * 60)
  if (budgetIndex < 0) throw new Error(`Unsupported response target: ${request.targetMinutes}`)
  const coverage = uint32(coverageBytes)
  const activeCount = Math.max(1, scenario.roster.length - request.reserveUnits)
  const candidates = scenario.demand_model.demand
    .map((cell) => cell.hex_index)
    .sort((a, b) => a - b)
  if (candidates.length === 0) throw new Error('Scenario has no candidate demand cells')

  const positions: number[] = []
  for (let unit = 0; unit < activeCount; unit += 1) {
    let best = candidates[0]!
    let bestObjective = -1
    for (const candidate of candidates) {
      const measure = coverageMeasure(
        scenario,
        union([...positions, candidate], coverage, region, budgetIndex),
      )
      const candidateObjective = objective(measure)
      if (
        candidateObjective > bestObjective ||
        (candidateObjective === bestObjective && candidate < best)
      ) {
        best = candidate
        bestObjective = candidateObjective
      }
    }
    positions.push(best)
  }

  let bestMeasure = coverageMeasure(
    scenario,
    union(positions, coverage, region, budgetIndex),
  )
  for (let iteration = 0; iteration < 300; iteration += 1) {
    const positionIndex = iteration % positions.length
    const candidate = candidates[(iteration * 37 + 11) % candidates.length]!
    const trial = [...positions]
    trial[positionIndex] = candidate
    const measure = coverageMeasure(scenario, union(trial, coverage, region, budgetIndex))
    if (objective(measure) > objective(bestMeasure)) {
      positions[positionIndex] = candidate
      bestMeasure = measure
    }
  }

  if (bestMeasure.equity < 0.55) {
    const currentCoverage = union(positions, coverage, region, budgetIndex)
    const repair = [...scenario.demand_model.demand]
      .filter((cell) => !covered(currentCoverage, cell.hex_index))
      .sort(
        (a, b) =>
          b.recency_weighted_demand - a.recency_weighted_demand ||
          a.hex_index - b.hex_index,
      )[0]
    if (repair) {
      const trial = [...positions]
      trial[0] = repair.hex_index
      const measure = coverageMeasure(scenario, union(trial, coverage, region, budgetIndex))
      if (measure.equity > bestMeasure.equity) {
        positions[0] = repair.hex_index
        bestMeasure = measure
      }
    }
  }

  const deployment = Object.fromEntries(
    scenario.roster.map((unit, index) => [
      unit.unit_id,
      index < activeCount ? positions[index % positions.length]! : null,
    ]),
  )
  return {
    scenarioId: scenario.scenario_id,
    deployment,
    coveredDemand: bestMeasure.hit,
    coverageRatio: bestMeasure.total > 0 ? bestMeasure.hit / bestMeasure.total : 0,
    equity: bestMeasure.equity,
    method: 'MCLP-inspired heuristic (greedy + local search)',
    formulationReference: 'Church & ReVelle (1974)',
    iterations: 300,
    elapsedMs: performance.now() - started,
    source: 'live_heuristic',
    provenance: {
      source_authority: 'third_party_mirror',
      transformation: 'derived',
      method: 'greedy_300_swap_equity_repair',
      source_checksum: scenario.provenance.source_checksum,
      generation_version: scenario.provenance.generation_version,
    },
  }
}

/** Request-scoped entry used by the Catalyst AIO wrapper. */
export async function handleOptimize(
  request: OptimizeRequest,
  options: CreateDataAdapterOptions = {},
): Promise<OptimizeResponse> {
  const adapter = createDataAdapter(options)
  try {
    return await optimizeWithAdapter(request, adapter)
  } finally {
    await adapter.close()
  }
}
