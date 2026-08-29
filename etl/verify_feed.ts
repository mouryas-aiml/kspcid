/** Acceptance checks for A16 deterministic weekly-baseline Command Feed. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { OUTPUT } from './00_config.js'
import { sha256File } from './lib/hash.js'
import { query } from './lib/parquet.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** Must track the documented policy in `16_command_feed.ts`. */
const FEED_LIMIT = 25
const MIN_EXPECTED_COUNT = 0.5
const MIN_WINDOW_OBSERVATIONS = 26

interface Alert {
  readonly id: string
  readonly station_code: string | null
  readonly station_name: string
  readonly title: string
  readonly week_start: string
  readonly observed_count: number
  readonly ucl_99: number
  readonly rank_score: number
  readonly z_score: number
  readonly expected_count: number
  readonly window_observations: number
  readonly history_13_weeks: readonly number[]
  readonly replay_offset_ms: number
  readonly geography: { latitude: number; longitude: number } | null
  readonly provenance: Readonly<Record<string, unknown>>
}

interface Fixture {
  readonly snapshot_through: string
  readonly replay_duration_ms: number
  readonly detector: Readonly<Record<string, string>>
  readonly alerts: readonly Alert[]
}

async function main(): Promise<void> {
  const fixturePath = resolve(OUTPUT.scenarios, 'command_feed.json')
  const baselinePath = resolve(OUTPUT.derived, 'weekly_baselines.parquet')
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture
  assert(fixture.alerts.length === FEED_LIMIT, `Expected ${FEED_LIMIT} ranked feed alerts`)
  assert(fixture.snapshot_through === '2023-12-31', 'Snapshot cutoff drift')

  // The cold-start gate. Without it the densely zero-filled baseline grid
  // divides by a near-zero variance and returns z-scores up to 9.017e24, which
  // outrank — and entirely suppress — every spike with real history.
  assert(
    fixture.alerts.every((alert) => Number.isFinite(alert.z_score)),
    'A stored z_score is not finite',
  )
  assert(
    fixture.alerts.every(
      (alert) =>
        alert.expected_count >= MIN_EXPECTED_COUNT &&
        alert.window_observations >= MIN_WINDOW_OBSERVATIONS,
    ),
    'An alert bypassed the cold-start eligibility gate',
  )
  assert(
    fixture.alerts.some(
      (alert) =>
        alert.station_name.includes('Kadugondana Halli') &&
        alert.title.includes('Two Wheelers'),
    ),
    'The Kadugondana Halli two-wheeler series — the demo corridor narrative — is missing from the feed',
  )
  assert(fixture.replay_duration_ms === 60_000, 'Replay must remain exactly 60 seconds')
  assert(
    fixture.alerts.every(
      (alert) =>
        alert.observed_count >= 5 &&
        alert.observed_count > alert.ucl_99 &&
        alert.history_13_weeks.length === 13 &&
        alert.history_13_weeks.at(-1) === alert.observed_count,
    ),
    'Detector or 13-week evidence contract failed',
  )
  assert(
    fixture.alerts.every(
      (alert, index) => index === 0 || alert.rank_score <= fixture.alerts[index - 1]!.rank_score,
    ),
    'Alerts are not deterministically ranked',
  )
  assert(
    fixture.alerts.every(
      (alert, index) =>
        alert.replay_offset_ms ===
        Math.round((index * fixture.replay_duration_ms) / (fixture.alerts.length - 1)),
    ),
    'Replay offsets drifted',
  )
  assert(
    fixture.alerts.every(
      (alert) =>
        alert.provenance['source_authority'] === 'third_party_mirror' &&
        alert.provenance['transformation'] === 'derived' &&
        alert.provenance['method'] === 'weekly_negative_binomial_ucl_v1',
    ),
    'Alert provenance drift',
  )
  assert(
    fixture.alerts.every(
      (alert) =>
        !alert.geography ||
        (alert.geography.latitude >= 12.75 &&
          alert.geography.latitude <= 13.2 &&
          alert.geography.longitude >= 77.45 &&
          alert.geography.longitude <= 77.85),
    ),
    'A feed centroid falls outside the canonical Bengaluru bbox',
  )

  const values = fixture.alerts
    .map(
      (alert) =>
        `(${alert.station_code ? `'${alert.station_code.replaceAll("'", "''")}'` : 'NULL'},` +
        `'${alert.station_name.replaceAll("'", "''")}','${alert.title.replaceAll("'", "''")}',` +
        `DATE '${alert.week_start}',${alert.observed_count},${alert.ucl_99})`,
    )
    .join(',')
  const mismatches = await query(
    `WITH expected(station_code, unit_name, crime_head, week_start, fir_count, ucl_99) AS (
       VALUES ${values}
     )
     SELECT count(*) AS count
     FROM expected e
     LEFT JOIN read_parquet('${baselinePath.replaceAll("'", "''")}') b
       ON b.station_code IS NOT DISTINCT FROM e.station_code
      AND b.unit_name = e.unit_name
      AND b.crime_head = e.crime_head
      AND b.week_start = e.week_start
     WHERE b.fir_count IS NULL OR b.fir_count <> e.fir_count OR b.ucl_99 <> e.ucl_99`,
  ) as Array<Record<string, unknown>>
  assert(Number(mismatches[0]?.['count']) === 0, 'Feed facts do not match weekly baselines')

  const checksum = await sha256File(fixturePath)
  const mappable = fixture.alerts.filter((alert) => alert.geography).length
  process.stdout.write(
    `verify:feed — PASS\n` +
      `  ranked alerts       ${fixture.alerts.length}\n` +
      `  mappable alerts     ${mappable}\n` +
      `  detector            count ≥5 and count > UCL\n` +
      `  eligibility         expected ≥${MIN_EXPECTED_COUNT}, history ≥${MIN_WINDOW_OBSERVATIONS}w\n` +
      `  z-score range       ${Math.min(...fixture.alerts.map((a) => a.z_score))} – ${Math.max(...fixture.alerts.map((a) => a.z_score))}\n` +
      `  replay              ${fixture.replay_duration_ms / 1000}s deterministic\n` +
      `  fixture sha256      ${checksum}\n`,
  )
}

await main()
