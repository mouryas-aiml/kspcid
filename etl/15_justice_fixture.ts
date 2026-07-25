/**
 * A15 — Justice Pipeline observed-stage and ageing fixture.
 *
 * Observed mode is one hop only: registered record → current stage. The source
 * has no transition history. A separately labelled generated mode aggregates
 * illustrative paths constrained by each record's observed terminal stage.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { ANALYSIS_CUTOFF, OUTPUT } from './00_config.js'
import { GENERATION_VERSION, sha256File } from './lib/hash.js'
import { recordOutput } from './lib/manifest.js'
import { query } from './lib/parquet.js'

const INPUT_PATH = resolve(OUTPUT.derived, 'incidents_time.parquet')
const OUTPUT_PATH = resolve(OUTPUT.scenarios, 'justice_pipeline.json')
const REPORT_PATH = resolve(OUTPUT.reports, 'a15_justice_pipeline.md')

const LABELS: Readonly<Record<string, string>> = Object.freeze({
  pending_trial: 'Pending Trial',
  undetected: 'Undetected',
  convicted: 'Convicted',
  traced: 'Traced',
  under_investigation: 'Under Investigation',
  false_case: 'False Case',
  compounded: 'Compounded',
  discharged_acquitted: 'Discharged / Acquitted',
  bound_over: 'Bound Over',
  other_disposal: 'Other Disposal',
  un_traced: 'Untraced',
  abated: 'Abated',
  transferred: 'Transferred',
})

const MODELLED_PATHS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  pending_trial: ['registered', 'under_investigation', 'traced', 'chargesheeted', 'pending_trial'],
  undetected: ['registered', 'under_investigation', 'undetected'],
  convicted: ['registered', 'under_investigation', 'traced', 'chargesheeted', 'pending_trial', 'convicted'],
  traced: ['registered', 'under_investigation', 'traced'],
  under_investigation: ['registered', 'under_investigation'],
  false_case: ['registered', 'under_investigation', 'false_case'],
  compounded: ['registered', 'under_investigation', 'traced', 'compounded'],
  discharged_acquitted: ['registered', 'under_investigation', 'traced', 'chargesheeted', 'pending_trial', 'discharged_acquitted'],
  bound_over: ['registered', 'under_investigation', 'traced', 'bound_over'],
  other_disposal: ['registered', 'under_investigation', 'other_disposal'],
  un_traced: ['registered', 'under_investigation', 'traced', 'un_traced'],
  abated: ['registered', 'under_investigation', 'traced', 'chargesheeted', 'pending_trial', 'abated'],
  transferred: ['registered', 'transferred'],
})

interface CountRow {
  readonly stage: string
  readonly count: number | bigint
}

function number(value: number | bigint): number {
  return Number(value)
}

async function main(): Promise<void> {
  const sourceChecksum = await sha256File(INPUT_PATH)
  const [totalsRaw, yearsRaw, stationsRaw, ageingRaw] = await Promise.all([
    query(
      `SELECT stage, count(*) AS count
         FROM read_parquet('${INPUT_PATH.replaceAll("'", "''")}')
        GROUP BY stage ORDER BY count DESC, stage`,
    ),
    query(
      `SELECT fir_year AS year, stage, count(*) AS count
         FROM read_parquet('${INPUT_PATH.replaceAll("'", "''")}')
        GROUP BY fir_year, stage ORDER BY fir_year, stage`,
    ),
    query(
      `SELECT station_code, min(unit_name) AS unit_name,
              min(police_division) AS police_division, stage, count(*) AS count
         FROM read_parquet('${INPUT_PATH.replaceAll("'", "''")}')
        GROUP BY station_code, stage
        ORDER BY station_code, stage`,
    ),
    query(
      `SELECT station_code, min(unit_name) AS unit_name,
              min(police_division) AS police_division,
              CASE
                WHEN date_diff('day', registered_on, DATE '${ANALYSIS_CUTOFF}') < 30 THEN 'lt_30d'
                WHEN date_diff('day', registered_on, DATE '${ANALYSIS_CUTOFF}') < 90 THEN '30_90d'
                WHEN date_diff('day', registered_on, DATE '${ANALYSIS_CUTOFF}') < 180 THEN '90_180d'
                WHEN date_diff('day', registered_on, DATE '${ANALYSIS_CUTOFF}') < 365 THEN '180_365d'
                WHEN date_diff('day', registered_on, DATE '${ANALYSIS_CUTOFF}') < 730 THEN '1_2y'
                ELSE '2y_plus'
              END AS age_bucket,
              count(*) AS count
         FROM read_parquet('${INPUT_PATH.replaceAll("'", "''")}')
        WHERE within_complete_window
          AND stage IN ('pending_trial', 'under_investigation', 'undetected', 'un_traced')
        GROUP BY station_code, age_bucket
        ORDER BY station_code, age_bucket`,
    ),
  ])
  const totals = (totalsRaw as unknown as CountRow[]).map((row) => ({
    stage: row.stage,
    label: LABELS[row.stage] ?? row.stage,
    count: number(row.count),
  }))
  const terminalCounts = new Map(totals.map(({ stage, count }) => [stage, count]))
  const modelledEdges = new Map<string, { source: string; target: string; count: number }>()
  for (const [terminal, path] of Object.entries(MODELLED_PATHS)) {
    const count = terminalCounts.get(terminal) ?? 0
    for (let index = 1; index < path.length; index += 1) {
      const source = path[index - 1]!
      const target = path[index]!
      const key = `${source}\u0000${target}`
      const current = modelledEdges.get(key) ?? { source, target, count: 0 }
      current.count += count
      modelledEdges.set(key, current)
    }
  }
  const stationMap = new Map<
    string,
    {
      station_code: string
      unit_name: string
      police_division: string
      stages: Record<string, number>
      ageing: Record<string, number>
    }
  >()
  for (const row of stationsRaw as Array<Record<string, unknown>>) {
    const code = String(row['station_code'])
    const station = stationMap.get(code) ?? {
      station_code: code,
      unit_name: String(row['unit_name']),
      police_division: String(row['police_division']),
      stages: {},
      ageing: {},
    }
    station.stages[String(row['stage'])] = Number(row['count'])
    stationMap.set(code, station)
  }
  for (const row of ageingRaw as Array<Record<string, unknown>>) {
    const station = stationMap.get(String(row['station_code']))
    if (station) station.ageing[String(row['age_bucket'])] = Number(row['count'])
  }
  const fixture = {
    schema_version: 1,
    fixture_id: 'justice-pipeline-v1',
    analysis_cutoff: ANALYSIS_CUTOFF,
    observed: {
      mode: 'one_hop_current_stage',
      total_records: totals.reduce((sum, row) => sum + row.count, 0),
      stages: totals,
      by_year: (yearsRaw as Array<Record<string, unknown>>).map((row) => ({
        year: Number(row['year']),
        stage: String(row['stage']),
        count: Number(row['count']),
      })),
      stations: [...stationMap.values()],
      provenance: {
        source_authority: 'third_party_mirror',
        transformation: 'normalized',
        method: 'current_stage_group_by_v1',
        source_checksum: sourceChecksum,
        generation_version: GENERATION_VERSION,
      },
    },
    modelled: {
      mode: 'generated_terminal_constrained_paths',
      edges: [...modelledEdges.values()].sort(
        (left, right) =>
          left.source.localeCompare(right.source) ||
          left.target.localeCompare(right.target),
      ),
      provenance: {
        source_authority: 'generated_demo',
        transformation: 'generated',
        method: 'terminal_constrained_path_v1',
        source_checksum: sourceChecksum,
        generation_version: GENERATION_VERSION,
      },
    },
  }
  await mkdir(OUTPUT.scenarios, { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
  await recordOutput(
    '15_justice_fixture',
    OUTPUT_PATH,
    fixture.observed.total_records,
    [{ path: INPUT_PATH, sha256: sourceChecksum }],
    {
      stages: totals.length,
      stations: stationMap.size,
      modelled_edges: fixture.modelled.edges.length,
    },
  )
  await mkdir(OUTPUT.reports, { recursive: true })
  await writeFile(
    REPORT_PATH,
    `# A15 Justice Pipeline\n\n` +
      `- Observed records: **${fixture.observed.total_records.toLocaleString()}**\n` +
      `- Current-stage categories: **${totals.length}**\n` +
      `- Stations: **${stationMap.size}**\n` +
      `- Undetected: **${(terminalCounts.get('undetected') ?? 0).toLocaleString()}**\n` +
      `- Pending Trial: **${(terminalCounts.get('pending_trial') ?? 0).toLocaleString()}**\n` +
      `- Convicted: **${(terminalCounts.get('convicted') ?? 0).toLocaleString()}**\n\n` +
      `Observed mode is one hop only. Generated multi-hop paths are terminal-constrained and separately labelled.\n`,
    'utf8',
  )
  process.stdout.write(
    `A15 · ${fixture.observed.total_records.toLocaleString()} records · ${totals.length} stages · ${stationMap.size} stations\n`,
  )
}

await main()
