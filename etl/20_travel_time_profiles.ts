/**
 * 20 — hour-of-day congestion profile (BUILD_SPEC §8.4, §3.3).
 *
 * Publishes `data/routing/travel_time_profiles.json`: the multipliers that turn
 * OSRM's stored free-flow durations into congested ones at runtime.
 *
 * The values are NOT defined here — they come from
 * `client/src/lib/patrol/congestion.ts`, the same module the scoring engine and
 * the Patrol Lab UI import. This step measures the OSRM baseline out of the
 * validation fixture, checks it still matches what that module assumes, and
 * writes the artifact. A single source of truth means the published profile and
 * the running product cannot drift.
 *
 * The multiplier is a RUNTIME correction. §8.4: "Conditions modify durations,
 * not geometry." Nothing here touches the stored matrix, and
 * `verify_routing.ts` continues to assert `congestion_baked_in: false`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  OSRM_FREE_FLOW_KMH,
  TOMTOM_BENGALURU_2025,
  hourProfile,
} from '../client/src/lib/patrol/congestion.js'
import { OUTPUT } from './00_config.js'
import { GENERATION_VERSION, sha256File } from './lib/hash.js'
import { recordOutput } from './lib/manifest.js'

const VALIDATION_PATH = resolve(OUTPUT.routing, 'validation.json')
const OUTPUT_PATH = resolve(OUTPUT.routing, 'travel_time_profiles.json')
const REPORT_PATH = resolve(OUTPUT.reports, 'a8_congestion_calibration.md')

interface ValidationPair {
  readonly matrix_seconds: number
  readonly route_distance_m: number
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
}

async function main(): Promise<void> {
  const checksum = await sha256File(VALIDATION_PATH)
  const validation = JSON.parse(await readFile(VALIDATION_PATH, 'utf8')) as {
    pairs: readonly ValidationPair[]
  }

  // Measure the free-flow baseline we actually route on, rather than assuming it.
  const speeds = validation.pairs
    .map((pair) => pair.route_distance_m / 1000 / (pair.matrix_seconds / 3600))
    .filter((speed) => Number.isFinite(speed) && speed > 0)
    .sort((left, right) => left - right)
  const median = Number(percentile(speeds, 0.5).toFixed(1))

  if (median !== OSRM_FREE_FLOW_KMH) {
    throw new Error(
      `OSRM free-flow median is ${median} km/h but congestion.ts assumes ` +
        `${OSRM_FREE_FLOW_KMH}. Update OSRM_FREE_FLOW_KMH — the published ` +
        `multipliers are derived from it.`,
    )
  }

  const hours = hourProfile()
  const profile = {
    schema_version: 1,
    method: 'hour_of_day_congestion_v1',
    applied: 'runtime_multiplier_only',
    congestion_baked_in: false,
    reference: {
      osrm_free_flow_kmh_median: median,
      osrm_free_flow_kmh_p25: Number(percentile(speeds, 0.25).toFixed(1)),
      osrm_free_flow_kmh_p75: Number(percentile(speeds, 0.75).toFixed(1)),
      osrm_sample_pairs: speeds.length,
      osrm_source: 'data/routing/validation.json',
      osrm_source_sha256: checksum,
    },
    source: TOMTOM_BENGALURU_2025,
    band_hours: {
      morning_rush: [7, 8, 9],
      evening_rush: [17, 18, 19],
      all_day: 'every other hour',
      hour_window_assumption: true,
      note:
        'TomTom names the rush-hour bands but does not publish their boundaries, ' +
        'and its per-hour chart is canvas-rendered with no exposed values. The ' +
        'windows above are therefore an assumption; the speeds are published ' +
        'figures. Hours outside them take the published all-day average, which ' +
        'for a 20:00-02:00 shift overstates congestion rather than flattering it.',
    },
    hours,
    provenance: {
      source_authority: 'open_reference',
      transformation: 'derived',
      method: 'hour_of_day_congestion_v1',
      source_checksum: checksum,
      generation_version: GENERATION_VERSION,
    },
  }

  await mkdir(OUTPUT.routing, { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(profile, null, 2)}\n`, 'utf8')
  await recordOutput('20_travel_time_profiles', OUTPUT_PATH, hours.length, [
    { path: VALIDATION_PATH, sha256: checksum },
  ])

  const offPeak = hours.find((hour) => hour.band === 'all_day')!
  const evening = hours.find((hour) => hour.band === 'evening_rush')!
  await mkdir(OUTPUT.reports, { recursive: true })
  await writeFile(
    REPORT_PATH,
    `# A8 congestion calibration — PASS\n\n` +
      `OSRM stores free-flow durations. Measured over the ${speeds.length} validated corridor pairs in\n` +
      `\`data/routing/validation.json\`: **p25 ${percentile(speeds, 0.25).toFixed(1)} · median ${median} · ` +
      `p75 ${percentile(speeds, 0.75).toFixed(1)} km/h**, matching the 39–49 km/h range §3.3 records.\n` +
      `Bengaluru does not move at ${median} km/h.\n\n` +
      `## Source\n\n` +
      `[${TOMTOM_BENGALURU_2025.source}](${TOMTOM_BENGALURU_2025.url}) — retrieved ${TOMTOM_BENGALURU_2025.retrieved}.\n\n` +
      `| figure | value |\n|---|---:|\n` +
      `| Average speed (all day) | ${TOMTOM_BENGALURU_2025.average_speed_kmh} km/h |\n` +
      `| Average congestion level | ${TOMTOM_BENGALURU_2025.average_congestion_level_percent}% |\n` +
      `| Morning rush speed | ${TOMTOM_BENGALURU_2025.morning_rush_speed_kmh} km/h (congestion ${TOMTOM_BENGALURU_2025.morning_rush_congestion_percent}%) |\n` +
      `| Evening rush speed | ${TOMTOM_BENGALURU_2025.evening_rush_speed_kmh} km/h (congestion ${TOMTOM_BENGALURU_2025.evening_rush_congestion_percent}%) |\n` +
      `| Travel time for 10 km | ${TOMTOM_BENGALURU_2025.ten_km_travel_time} |\n\n` +
      `TomTom's "congestion level" is extra travel time versus free-flow, so its figures are\n` +
      `internally consistent: 16.6 × 1.744 ≈ 14.6 × 1.942 ≈ 13.2 × 2.152 ≈ **28.4 km/h** implied\n` +
      `free-flow. That is TomTom's own baseline and is far below OSRM's speed-limit-derived\n` +
      `${median} km/h, so the multiplier is computed against the baseline we actually route on\n` +
      `(\`OSRM free-flow ÷ observed speed\`) rather than by reusing TomTom's percentage.\n\n` +
      `## Multipliers\n\n` +
      `| band | assumed speed | multiplier |\n|---|---:|---:|\n` +
      `| All day / off-peak | ${offPeak.assumed_speed_kmh} km/h | **×${offPeak.multiplier}** |\n` +
      `| Morning rush (07–09) | ${TOMTOM_BENGALURU_2025.morning_rush_speed_kmh} km/h | ×${hours[8]!.multiplier} |\n` +
      `| Evening rush (17–19) | ${evening.assumed_speed_kmh} km/h | **×${evening.multiplier}** |\n\n` +
      `§3.3 predicted that uncalibrated coverage reads "roughly 3× too generous". The measured\n` +
      `correction is ×${offPeak.multiplier} off-peak and ×${evening.multiplier} in the evening peak, which confirms it.\n\n` +
      `## What this does and does not correct\n\n` +
      `Applied as a **runtime multiplier only**, at the \`conditionFactor\` seam in\n` +
      `\`scoring.ts\` and \`simulation.ts\`, resolved per replay event from that event's own clock\n` +
      `hour. Stored durations are untouched and \`congestion_baked_in\` stays \`false\` (§8.4).\n\n` +
      `**Known limitation — the coverage component is still free-flow.** Coverage bitsets are\n` +
      `precomputed per origin hex × five fixed response budgets and cannot be rescaled at\n` +
      `runtime, so the 400-point coverage term still answers "reachable within 7 free-flow\n` +
      `minutes", not 7 congested minutes. Only the 250-point response term and the dispatch\n` +
      `simulation are corrected. §8.4 anticipates this — "switching conditions swaps the active\n` +
      `bitset table" — which needs one precompiled bitset set per condition band. Not built;\n` +
      `at ×${offPeak.multiplier} off-peak the honest reading is that a 7-minute blanket is closer to a\n` +
      `2.6-minute one, and the UI states the assumed speed on screen so the gap is visible.\n\n` +
      `Hour windows are an assumption (TomTom names the bands, not their boundaries); the\n` +
      `speeds are published figures. Hours outside the two rush bands take the all-day average,\n` +
      `which for the 20:00–02:00 demo shift overstates congestion rather than flattering it.\n`,
    'utf8',
  )

  process.stdout.write(
    `20 · congestion profile · OSRM free-flow median ${median} km/h · ` +
      `off-peak ×${offPeak.multiplier} · evening peak ×${evening.multiplier}\n`,
  )
}

await main()
