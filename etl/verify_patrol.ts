/** Acceptance checks for A9–A11 Patrol Lab. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  baselineDeployment,
  initialDeployment,
  optimizeDeployment,
} from '../client/src/lib/patrol/optimizer.js'
import { bitsetAt, isCovered } from '../client/src/lib/patrol/routing.js'
import { scoreDeployment } from '../client/src/lib/patrol/scoring.js'
import { simulateUntil } from '../client/src/lib/patrol/simulation.js'
import type { Deployment, PatrolData, PatrolScenario } from '../client/src/lib/patrol/types.js'
import { handleOptimize } from '../functions/kv-optimize/index.js'
import { OUTPUT } from './00_config.js'
import { sha256File } from './lib/hash.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
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
  const [region, hexIndex, scenario, durationBytes, coverageBytes] = await Promise.all([
    readFile(resolve(OUTPUT.routing, 'corridor_region.json'), 'utf8').then(JSON.parse),
    readFile(resolve(OUTPUT.routing, 'hex_index.json'), 'utf8').then(JSON.parse),
    readFile(resolve(OUTPUT.scenarios, 'demo_corridor_patrol.json'), 'utf8').then(JSON.parse),
    readFile(resolve(OUTPUT.routing, 'duration_matrix.bin')),
    readFile(resolve(OUTPUT.routing, 'coverage_bitsets.bin')),
  ])
  return {
    region,
    hexIndex,
    scenario,
    durations: float32(durationBytes),
    coverage: uint32(coverageBytes),
  } as PatrolData
}

async function main(): Promise<void> {
  const data = await loadData()
  const scenario = data.scenario as PatrolScenario
  assert(scenario.time_window.complete_window, 'Scenario must use a complete collection window')
  assert(scenario.roster.length === 16, 'Expected 16 generated demonstration units')
  assert(scenario.roster.every((unit) => unit.generated), 'Roster provenance must be generated')
  assert(scenario.replay_events.length === 120, 'Expected deterministic 120-event replay')
  assert(
    scenario.integrated_scenario?.corridor === 'ORR / Old Madras Road' &&
      scenario.integrated_scenario?.narrative_stations?.length === 4 &&
      scenario.integrated_scenario?.crosses_division_boundary,
    'A18 integrated corridor contract failed',
  )
  assert(
    scenario.injections?.length === 1 &&
      scenario.injections[0]?.injection_id === 'old-madras-road-closure' &&
      scenario.injections[0]?.simulation_minute === 180 &&
      scenario.injections[0]?.source_authority === 'generated_demo' &&
      scenario.injections[0]?.transformation === 'generated',
    'A18 road-closure injection contract failed',
  )
  assert(
    scenario.conditions?.road_closure_multiplier === 1.12 &&
      scenario.conditions?.rain_multiplier === 1.35 &&
      scenario.conditions?.geometry_changes_at_runtime === false,
    'Runtime condition contract failed',
  )
  assert(
    scenario.replay_events.every((event) =>
      ['reported', 'reported_corrected', 'inferred'].includes(event.geo_origin),
    ),
    'Replay geography origin must be explicit',
  )

  const budget = data.region.response_budgets_seconds.indexOf(420)
  assert(budget >= 0, '7-minute coverage budget missing')
  let crossBoundary = false
  for (const origin of data.hexIndex.cells) {
    if (!origin.core_station_code) continue
    const bitset = bitsetAt(data, origin.index, budget)
    crossBoundary = data.hexIndex.cells.some(
      (destination) =>
        destination.core_station_code !== null &&
        destination.core_station_code !== origin.core_station_code &&
        isCovered(bitset, destination.index),
    )
    if (crossBoundary) break
  }
  assert(crossBoundary, 'Road-time coverage must cross a station boundary')

  const baseline = baselineDeployment(data, 2)
  const scoreStarted = performance.now()
  let score = scoreDeployment(data, baseline, 7, 2)
  const scoreRuns = 500
  for (let run = 1; run < scoreRuns; run += 1) {
    score = scoreDeployment(data, baseline, 7, 2)
  }
  const averageScoreMs = (performance.now() - scoreStarted) / scoreRuns
  assert(averageScoreMs < 4, `Score recompute ${averageScoreMs.toFixed(3)}ms exceeds 4ms`)
  assert(score.total >= 0 && score.total <= 1000, 'Score must stay inside 0–1000')

  const optimized = optimizeDeployment(data, 7, 2)
  assert(optimized.elapsedMs < 200, `Client heuristic took ${optimized.elapsedMs.toFixed(1)}ms`)
  assert(optimized.score.total >= score.total, 'Client heuristic must not underperform baseline')
  assert(optimized.method === 'greedy_local_search_equity_repair', 'Client method label drift')

  const live = await handleOptimize({
    scenarioId: 'demo-corridor-patrol-2021-2023-night',
    targetMinutes: 7,
    reserveUnits: 2,
  })
  assert(live.elapsedMs < 200, `kv-optimize took ${live.elapsedMs.toFixed(1)}ms`)
  assert(live.method.includes('MCLP-inspired heuristic'), 'Heuristic truth label missing')
  assert(Object.keys(live.deployment).length === scenario.roster.length, 'Optimizer roster mismatch')

  // Dispatch trail geometry (§8.9) covers every dispatch the three reference
  // plans produce. Without this the trails vanish silently the next time the
  // scenario, the roster or the optimizer moves, and the map quietly loses a
  // layer rather than failing a gate.
  const dispatchRoutes = JSON.parse(
    await readFile(resolve(OUTPUT.routing, 'dispatch_routes.json'), 'utf8'),
  ) as {
    scenario_id: string
    plans: string[]
    routes: Array<{ origin: number; destination: number; points: number }>
  }
  assert(dispatchRoutes.scenario_id === scenario.scenario_id, 'Dispatch route scenario drift')
  assert(
    ['opening', 'baseline', 'optimizer'].every((plan) => dispatchRoutes.plans.includes(plan)),
    'Dispatch routes must cover the opening, baseline and optimizer plans',
  )
  assert(
    dispatchRoutes.routes.every((route) => route.points >= 2),
    'Dispatch route geometry must have at least two points',
  )
  const routeKeys = new Set(
    dispatchRoutes.routes.map((route) => `${route.origin}:${route.destination}`),
  )
  const referencePlans: Array<readonly [string, Deployment]> = [
    ['opening', initialDeployment(data, 2)],
    ['baseline', baseline],
    ['optimizer', optimized.deployment],
  ]
  const lastMinute = scenario.replay_events.reduce(
    (latest, event) => Math.max(latest, event.simulation_minute),
    0,
  )
  for (const [plan, deployment] of referencePlans) {
    for (const dispatch of simulateUntil(data, deployment, lastMinute, false, false).dispatches) {
      if (!dispatch.unitId) continue
      const origin = deployment[dispatch.unitId]
      if (origin === null || origin === undefined) continue
      if (origin === dispatch.event.hex_index) continue
      assert(
        routeKeys.has(`${origin}:${dispatch.event.hex_index}`),
        `Dispatch trail missing for ${plan}: ${origin} → ${dispatch.event.hex_index}`,
      )
    }
  }

  const scenarioChecksum = await sha256File(
    resolve(OUTPUT.scenarios, 'demo_corridor_patrol.json'),
  )
  process.stdout.write(
    `verify:patrol — PASS\n` +
      `  scenario sha256     ${scenarioChecksum}\n` +
      `  dispatch trails     ${dispatchRoutes.routes.length} routes · 3 reference plans covered\n` +
      `  score recompute     ${averageScoreMs.toFixed(3)} ms average (${scoreRuns} runs)\n` +
      `  client heuristic    ${optimized.elapsedMs.toFixed(1)} ms · ${optimized.score.total}\n` +
      `  kv-optimize         ${live.elapsedMs.toFixed(1)} ms · ${(live.coverageRatio * 100).toFixed(1)}% coverage\n` +
      `  cross-boundary      yes\n` +
      `  A18 injection       Old Madras Road @ minute 180\n`,
  )
}

await main()
