/** Acceptance checks for A15 exact observed-stage Justice Pipeline. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { ANALYSIS_CUTOFF, OUTPUT } from './00_config.js'
import { sha256File } from './lib/hash.js'
import { query } from './lib/parquet.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

interface Fixture {
  readonly analysis_cutoff: string
  readonly observed: {
    readonly mode: string
    readonly total_records: number
    readonly stages: readonly { stage: string; count: number }[]
    readonly by_year: readonly { year: number; stage: string; count: number }[]
    readonly stations: readonly {
      station_code: string
      stages: Readonly<Record<string, number>>
      ageing: Readonly<Record<string, number>>
    }[]
    readonly provenance: Readonly<Record<string, unknown>>
  }
  readonly modelled: {
    readonly mode: string
    readonly edges: readonly { source: string; target: string; count: number }[]
    readonly provenance: Readonly<Record<string, unknown>>
  }
}

async function main(): Promise<void> {
  const fixturePath = resolve(OUTPUT.scenarios, 'justice_pipeline.json')
  const sourcePath = resolve(OUTPUT.derived, 'incidents_time.parquet')
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture
  const rawStages = await query(
    `SELECT stage, count(*) AS count
       FROM read_parquet('${sourcePath.replaceAll("'", "''")}')
      GROUP BY stage ORDER BY stage`,
  ) as Array<Record<string, unknown>>
  const rawAgeing = await query(
    `SELECT count(*) AS count
       FROM read_parquet('${sourcePath.replaceAll("'", "''")}')
      WHERE within_complete_window
        AND stage IN ('pending_trial', 'under_investigation', 'undetected', 'un_traced')`,
  ) as Array<Record<string, unknown>>
  const fixtureStages = new Map(fixture.observed.stages.map((row) => [row.stage, row.count]))
  const rawTotal = rawStages.reduce((sum, row) => sum + Number(row['count']), 0)
  const stationTotal = fixture.observed.stations.reduce(
    (sum, station) =>
      sum + Object.values(station.stages).reduce((stageSum, count) => stageSum + count, 0),
    0,
  )
  const ageingTotal = fixture.observed.stations.reduce(
    (sum, station) =>
      sum + Object.values(station.ageing).reduce((ageSum, count) => ageSum + count, 0),
    0,
  )

  assert(fixture.observed.mode === 'one_hop_current_stage', 'Observed view must remain one hop')
  assert(fixture.analysis_cutoff === ANALYSIS_CUTOFF, 'Analysis cutoff drift')
  assert(fixture.observed.total_records === 425_408, 'Observed total must equal 425,408')
  assert(rawTotal === fixture.observed.total_records, 'Raw-to-fixture record conservation failed')
  assert(stationTotal === fixture.observed.total_records, 'Station cube conservation failed')
  assert(fixtureStages.get('undetected') === 92_874, 'Undetected anchor drift')
  assert(fixtureStages.get('pending_trial') === 105_647, 'Pending Trial anchor drift')
  assert(fixtureStages.get('convicted') === 73_310, 'Convicted anchor drift')
  assert(
    rawStages.every((row) => fixtureStages.get(String(row['stage'])) === Number(row['count'])),
    'Observed stage values differ from raw current-stage group-by',
  )
  assert(
    fixture.observed.by_year.reduce((sum, row) => sum + row.count, 0) === fixture.observed.total_records,
    'Year cube conservation failed',
  )
  assert(ageingTotal === Number(rawAgeing[0]?.['count']), 'Complete-window ageing conservation failed')
  assert(
    fixture.observed.provenance['transformation'] === 'normalized' &&
      fixture.observed.provenance['source_authority'] === 'third_party_mirror',
    'Observed provenance drift',
  )
  assert(
    fixture.modelled.mode === 'generated_terminal_constrained_paths' &&
      fixture.modelled.provenance['transformation'] === 'generated' &&
      fixture.modelled.provenance['source_authority'] === 'generated_demo',
    'Generated transition provenance drift',
  )
  assert(
    fixture.modelled.edges.length > fixture.observed.stages.length &&
      fixture.modelled.edges.every((edge) => edge.count > 0),
    'Generated path fixture is incomplete',
  )

  const checksum = await sha256File(fixturePath)
  process.stdout.write(
    `verify:justice — PASS\n` +
      `  observed records    ${fixture.observed.total_records.toLocaleString()}\n` +
      `  stages / stations   ${fixture.observed.stages.length} / ${fixture.observed.stations.length}\n` +
      `  ageing records      ${ageingTotal.toLocaleString()}\n` +
      `  generated edges     ${fixture.modelled.edges.length} (labelled)\n` +
      `  fixture sha256      ${checksum}\n`,
  )
}

await main()
