/**
 * A16 — deterministic Command Feed fixture from complete-window baselines.
 *
 * Every alert satisfies the BUILD_SPEC detector: weekly count exceeds the
 * 99% control limit and raw count is at least five. The UI replay clock is
 * presentation metadata; alert evidence remains tied to its observed week.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { OUTPUT } from './00_config.js'
import { GENERATION_VERSION, sha256File } from './lib/hash.js'
import { recordOutput } from './lib/manifest.js'
import { query } from './lib/parquet.js'

const BASELINE_PATH = resolve(OUTPUT.derived, 'weekly_baselines.parquet')
const INCIDENT_PATH = resolve(OUTPUT.derived, 'incidents_time.parquet')
const OUTPUT_PATH = resolve(OUTPUT.scenarios, 'command_feed.json')
const REPORT_PATH = resolve(OUTPUT.reports, 'a16_command_feed.md')
const FEED_LIMIT = 30

interface AlertRow extends Record<string, unknown> {
  readonly station_code: string | null
  readonly unit_name: string
  readonly police_division: string | null
  readonly crime_head: string
  readonly week_start: string
  readonly fir_count: number
  readonly expected_count: number
  readonly ucl_99: number
  readonly z_score: number
  readonly history: { readonly items: readonly number[] }
  readonly latitude: number | null
  readonly longitude: number | null
  readonly coordinate_records: number | bigint
}

function severityWeight(crimeHead: string): number {
  const value = crimeHead.toLowerCase()
  if (/(murder|rape|dacoity|terror|explosive)/.test(value)) return 1.5
  if (/(robbery|kidnap|automobile|weapon|sexual)/.test(value)) return 1.25
  if (/(information technology|cyber|dowry|criminal intimidation)/.test(value)) return 1.15
  return 1
}

function round(value: number, digits = 2): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

async function main(): Promise<void> {
  const [baselineChecksum, incidentChecksum] = await Promise.all([
    sha256File(BASELINE_PATH),
    sha256File(INCIDENT_PATH),
  ])
  const rows = await query(
    `WITH series AS (
       SELECT station_key, station_code, unit_name, crime_head,
              strftime(week_start, '%Y-%m-%d') AS week_start,
              fir_count, expected_count, ucl_99, z_score,
              list(fir_count) OVER (
                PARTITION BY station_key, crime_head ORDER BY week_start
                ROWS BETWEEN 12 PRECEDING AND CURRENT ROW
              ) AS history
       FROM read_parquet('${BASELINE_PATH.replaceAll("'", "''")}')
     ),
     station_geo AS (
       SELECT station_code, min(police_division) AS police_division,
              avg(latitude) FILTER (WHERE map_pin_eligible) AS latitude,
              avg(longitude) FILTER (WHERE map_pin_eligible) AS longitude,
              count(*) FILTER (WHERE map_pin_eligible) AS coordinate_records
       FROM read_parquet('${INCIDENT_PATH.replaceAll("'", "''")}')
       WHERE within_complete_window
       GROUP BY station_code
     )
     SELECT s.*, g.police_division, g.latitude, g.longitude,
            coalesce(g.coordinate_records, 0) AS coordinate_records
     FROM series s
     LEFT JOIN station_geo g USING (station_code)
     WHERE s.week_start >= '2023-07-01'
       AND s.fir_count >= 5
       AND s.fir_count > s.ucl_99
     ORDER BY s.week_start DESC, s.z_score DESC, s.station_key, s.crime_head`,
  ) as AlertRow[]

  const ranked = rows
    .map((row) => {
      const weight = severityWeight(row.crime_head)
      return {
        row,
        weight,
        score: row.z_score * weight,
      }
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.row.week_start.localeCompare(left.row.week_start) ||
        left.row.unit_name.localeCompare(right.row.unit_name) ||
        left.row.crime_head.localeCompare(right.row.crime_head),
    )
    .slice(0, FEED_LIMIT)

  const alerts = ranked.map(({ row, score, weight }, index) => ({
    id: `alert-${String(index + 1).padStart(2, '0')}`,
    type: 'category_spike',
    title: row.crime_head,
    station_code: row.station_code,
    station_name: row.unit_name,
    police_division: row.police_division,
    week_start: row.week_start,
    observed_count: row.fir_count,
    expected_count: round(row.expected_count, 1),
    ucl_99: row.ucl_99,
    z_score: round(row.z_score),
    display_z_score: row.z_score > 20 ? '20+σ' : `${round(row.z_score, 1)}σ`,
    severity_weight: weight,
    rank_score: round(score),
    severity: score >= 10 ? 'critical' : score >= 6 ? 'high' : 'watch',
    history_13_weeks: [...row.history.items],
    geography:
      row.latitude !== null && row.longitude !== null
        ? {
            latitude: round(row.latitude, 6),
            longitude: round(row.longitude, 6),
            coordinate_records: Number(row.coordinate_records),
            method: 'mean_reported_eligible_coordinates',
          }
        : null,
    replay_offset_ms: Math.round((index * 60_000) / Math.max(1, FEED_LIMIT - 1)),
    provenance: {
      source_authority: 'third_party_mirror',
      transformation: 'derived',
      method: 'weekly_negative_binomial_ucl_v1',
      source_checksum: baselineChecksum,
      generation_version: GENERATION_VERSION,
    },
  }))
  const fixture = {
    schema_version: 1,
    fixture_id: 'command-feed-v1',
    snapshot_through: '2023-12-31',
    replay_duration_ms: 60_000,
    detector: {
      condition: 'fir_count >= 5 AND fir_count > ucl_99',
      ranking: 'z_score × deterministic crime-head severity weight',
      candidate_window: '2023-07-01 through 2023-12-31',
    },
    alerts,
  }
  await mkdir(OUTPUT.scenarios, { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
  await recordOutput(
    '16_command_feed',
    OUTPUT_PATH,
    alerts.length,
    [
      { path: BASELINE_PATH, sha256: baselineChecksum },
      { path: INCIDENT_PATH, sha256: incidentChecksum },
    ],
    {
      detector_candidates: rows.length,
      mappable_alerts: alerts.filter((alert) => alert.geography).length,
      replay_duration_ms: fixture.replay_duration_ms,
    },
  )
  await mkdir(OUTPUT.reports, { recursive: true })
  await writeFile(
    REPORT_PATH,
    `# A16 Command Feed\n\n` +
      `- Ranked alerts: **${alerts.length}**\n` +
      `- Detector candidates in H2 2023: **${rows.length}**\n` +
      `- Alerts with an observed-coordinate station centroid: **${alerts.filter((alert) => alert.geography).length}**\n` +
      `- Replay duration: **60 seconds**\n\n` +
      `All alert facts are derived from complete-window baselines. The replay clock and acknowledgement state are presentation/session metadata.\n`,
    'utf8',
  )
  process.stdout.write(
    `A16 · ${alerts.length} ranked alerts · ${alerts.filter((alert) => alert.geography).length} mappable · 60s replay\n`,
  )
}

await main()
