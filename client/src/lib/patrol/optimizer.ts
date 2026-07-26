import { bitsetAt, isCovered, unionCoverage } from './routing'
import { scoreDeployment } from './scoring'
import type { Deployment, OptimizationResult, PatrolData } from './types'

function demandCovered(data: PatrolData, coverage: Uint32Array): number {
  return data.scenario.demand_model.demand.reduce(
    (sum, cell) =>
      sum + (isCovered(coverage, cell.hex_index) ? cell.recency_weighted_demand : 0),
    0,
  )
}

function greedyPositions(data: PatrolData, count: number, budget: number): number[] {
  const candidates = data.scenario.demand_model.demand
    .map((cell) => cell.hex_index)
    .sort((a, b) => a - b)
  const selected: number[] = []
  const covered = new Uint32Array(data.region.words_per_bitset)
  for (let unit = 0; unit < count; unit += 1) {
    let bestHex = candidates[0] ?? 0
    let bestGain = -1
    for (const candidate of candidates) {
      const candidateCoverage = bitsetAt(data, candidate, budget)
      const trial = new Uint32Array(covered)
      for (let word = 0; word < trial.length; word += 1) {
        trial[word] = (trial[word] ?? 0) | (candidateCoverage[word] ?? 0)
      }
      const gain = demandCovered(data, trial) - demandCovered(data, covered)
      if (gain > bestGain || (gain === bestGain && candidate < bestHex)) {
        bestHex = candidate
        bestGain = gain
      }
    }
    selected.push(bestHex)
    const bestCoverage = bitsetAt(data, bestHex, budget)
    for (let word = 0; word < covered.length; word += 1) {
      covered[word] = (covered[word] ?? 0) | (bestCoverage[word] ?? 0)
    }
  }
  return selected
}

function toDeployment(data: PatrolData, positions: readonly number[], reserve: number): Deployment {
  const activeCount = Math.max(0, data.scenario.roster.length - reserve)
  return Object.fromEntries(
    data.scenario.roster.map((unit, index) => [
      unit.unit_id,
      index < activeCount ? (positions[index % positions.length] ?? unit.start_hex_index) : null,
    ]),
  )
}

export function optimizeDeployment(
  data: PatrolData,
  targetMinutes: number,
  reserve: number,
): OptimizationResult {
  const started = performance.now()
  const activeCount = Math.max(1, data.scenario.roster.length - reserve)
  const budget = Math.max(
    0,
    data.region.response_budgets_seconds.indexOf(targetMinutes * 60),
  )
  const positions = greedyPositions(data, activeCount, budget)
  let deployment = toDeployment(data, positions, reserve)
  let score = scoreDeployment(data, deployment, targetMinutes, reserve)
  const candidates = data.scenario.demand_model.demand
    .map((cell) => cell.hex_index)
    .sort((a, b) => a - b)

  // Deterministic 300-iteration 1-swap local search.
  for (let iteration = 0; iteration < 300; iteration += 1) {
    const unit = data.scenario.roster[iteration % activeCount]
    const candidate = candidates[(iteration * 37 + 11) % candidates.length]
    if (!unit || candidate === undefined) continue
    const trial = { ...deployment, [unit.unit_id]: candidate }
    const trialScore = scoreDeployment(data, trial, targetMinutes, reserve)
    if (trialScore.total > score.total) {
      deployment = trial
      score = trialScore
    }
  }

  // Equity repair: move the most redundant active unit to the largest-demand
  // cell outside the current blanket when beat-balance drops below 0.55.
  if (score.equity < 0.55) {
    const covered = unionCoverage(data, deployment, budget)
    const repairCell = [...data.scenario.demand_model.demand]
      .filter((cell) => !isCovered(covered, cell.hex_index))
      .sort(
        (a, b) =>
          b.recency_weighted_demand - a.recency_weighted_demand ||
          a.hex_index - b.hex_index,
      )[0]
    const activeUnit = data.scenario.roster.find((unit) => deployment[unit.unit_id] !== null)
    if (repairCell && activeUnit) {
      const trial = { ...deployment, [activeUnit.unit_id]: repairCell.hex_index }
      const trialScore = scoreDeployment(data, trial, targetMinutes, reserve)
      if (trialScore.equity > score.equity) {
        deployment = trial
        score = trialScore
      }
    }
  }
  return {
    deployment,
    score,
    elapsedMs: performance.now() - started,
    method: 'greedy_local_search_equity_repair',
    iterations: 300,
    source: 'client_heuristic',
  }
}

function storedFallback(
  data: PatrolData,
  targetMinutes: number,
  reserve: number,
): OptimizationResult {
  if (
    data.fallback.target_minutes !== targetMinutes ||
    data.fallback.reserve_units !== reserve
  ) {
    return optimizeDeployment(data, targetMinutes, reserve)
  }
  return {
    deployment: data.fallback.deployment,
    score: data.fallback.score,
    elapsedMs: 0,
    method: data.fallback.method,
    iterations: data.fallback.iterations,
    source: 'precomputed_fallback',
  }
}

/**
 * Try the deployment API, then continue with the stored same-schema plan if
 * the call fails or crosses the declared two-second demo ceiling.
 */
export async function optimizeDeploymentWithFallback(
  data: PatrolData,
  targetMinutes: number,
  reserve: number,
): Promise<OptimizationResult> {
  if ((process.env.NEXT_PUBLIC_DEMO_MODE ?? 'offline') === 'offline') {
    return storedFallback(data, targetMinutes, reserve)
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), data.fallback.timeout_ms)
  try {
    const response = await fetch('/api/optimize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenarioId: data.scenario.scenario_id,
        targetMinutes,
        reserveUnits: reserve,
      }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Optimizer unavailable (${response.status})`)
    const result = await response.json() as {
      deployment?: Deployment
      elapsedMs?: number
      iterations?: number
    }
    if (!result.deployment || Object.keys(result.deployment).length !== data.scenario.roster.length) {
      throw new Error('Optimizer response contract mismatch')
    }
    return {
      deployment: result.deployment,
      score: scoreDeployment(data, result.deployment, targetMinutes, reserve),
      elapsedMs: result.elapsedMs ?? 0,
      method: 'greedy_local_search_equity_repair',
      iterations: result.iterations ?? 300,
      source: 'live_heuristic',
    }
  } catch {
    return storedFallback(data, targetMinutes, reserve)
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * The plan the Patrol Lab opens on — every unit at its roster start post, the
 * last `reserve_units` held back.
 *
 * This lives beside `baselineDeployment` rather than in the store because it is
 * a *reference plan*, not UI state: `etl/10b_dispatch_routes.ts` replays it to
 * precompute dispatch geometry, and the two must not be allowed to drift. They
 * already had: the opening plan posts units at `start_hex_index` while the
 * baseline posts them at `planning_defaults.baseline_posts`, which is why the
 * first precompute pass produced no trails for the screen as it loads.
 */
export function initialDeployment(data: PatrolData, reserve: number): Deployment {
  const activeCount = Math.max(0, data.scenario.roster.length - reserve)
  return Object.fromEntries(
    data.scenario.roster.map((unit, index) => [
      unit.unit_id,
      index < activeCount ? unit.start_hex_index : null,
    ]),
  )
}

export function baselineDeployment(data: PatrolData, reserve: number): Deployment {
  const posts = data.scenario.planning_defaults.baseline_posts
  const activeCount = Math.max(0, data.scenario.roster.length - reserve)
  return Object.fromEntries(
    data.scenario.roster.map((unit, index) => [
      unit.unit_id,
      index < activeCount
        ? (posts[index % posts.length]?.hex_index ?? unit.start_hex_index)
        : null,
    ]),
  )
}
