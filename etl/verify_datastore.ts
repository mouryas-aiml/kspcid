/**
 * A4 Data Store verifier.
 *
 * The default path validates the local source contract and schema without
 * requiring credentials. Set KSPCID_VERIFY_CATALYST=1 after each owner-run
 * import to reconcile the actual production Data Store and Catalyst Search.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createDataAdapter } from '../functions/shared/data-access/index.js'
import { query } from './lib/parquet.js'

const ROOT = resolve(import.meta.dirname, '..')
const CLOUD = process.env.KSPCID_VERIFY_CATALYST === '1'

interface CountRow {
  readonly row_count: number | bigint | string
}

interface IncidentSearchRow {
  readonly incident_id: string
  readonly case_ref: string
  readonly act_section: string
}

interface JusticeRow {
  readonly stage: string
  readonly record_count: number | bigint | string
}

interface Schema {
  readonly tables: {
    readonly Incidents: {
      readonly expected_rows: number
      readonly columns: Readonly<
        Record<
          string,
          {
            readonly type: string
            readonly max_length?: number
            readonly search_index?: boolean
          }
        >
      >
    }
    readonly Stations: { readonly expected_rows: number }
    readonly WeeklyBaselines: { readonly expected_rows: number }
  }
}

function count(rows: readonly CountRow[]): number {
  return Number(rows[0]?.row_count)
}

async function main(): Promise<void> {
  const schema = JSON.parse(
    await readFile(resolve(ROOT, 'etl', 'datastore', 'schema.json'), 'utf8'),
  ) as Schema
  const incidentColumns = schema.tables.Incidents.columns
  assert.equal(incidentColumns['act_section']?.type, 'Text')
  assert.equal(incidentColumns['act_section']?.search_index, undefined)
  for (const column of [
    'case_ref',
    'crime_head',
    'place_of_offence',
    'act_section_search_1',
    'act_section_search_2',
    'act_section_search_3',
  ]) {
    assert.equal(
      incidentColumns[column]?.search_index,
      true,
      `${column} must carry a Catalyst Search index`,
    )
  }

  const [sourceCounts, reducedCounts, actLengths] = await Promise.all([
    query(
      `SELECT
         (SELECT count(*) FROM read_parquet('${resolve(ROOT, 'data/derived/incidents_time.parquet').replaceAll("'", "''")}')) AS incidents,
         (SELECT count(*) FROM read_parquet('${resolve(ROOT, 'data/derived/stations.parquet').replaceAll("'", "''")}')) AS stations`,
    ),
    query(
      `WITH b AS (
         SELECT * FROM read_parquet('${resolve(ROOT, 'data/derived/weekly_baselines.parquet').replaceAll("'", "''")}')
       ),
       p AS (
         SELECT station_key, crime_head
         FROM b GROUP BY station_key, crime_head
         HAVING max(CASE WHEN fir_count >= 5 AND fir_count > ucl_99 THEN 1 ELSE 0 END) = 1
       )
       SELECT count(*) AS baselines FROM b INNER JOIN p USING (station_key, crime_head)`,
    ),
    query(
      `SELECT max(length(act_section)) AS longest,
              count(*) FILTER (WHERE length(act_section) > 255) AS chunked
       FROM read_parquet('${resolve(ROOT, 'data/derived/incidents_time.parquet').replaceAll("'", "''")}')`,
    ),
  ])
  assert.equal(Number(sourceCounts[0]?.['incidents']), schema.tables.Incidents.expected_rows)
  assert.equal(Number(sourceCounts[0]?.['stations']), schema.tables.Stations.expected_rows)
  assert.equal(
    Number(reducedCounts[0]?.['baselines']),
    schema.tables.WeeklyBaselines.expected_rows,
  )
  assert.equal(Number(actLengths[0]?.['longest']), 619)
  assert.equal(Number(actLengths[0]?.['chunked']), 191)

  const justiceFixture = JSON.parse(
    await readFile(resolve(ROOT, 'data', 'scenarios', 'justice_pipeline.json'), 'utf8'),
  ) as {
    readonly observed: {
      readonly stages: readonly { readonly stage: string; readonly count: number }[]
    }
  }
  const localJustice = new Map(
    justiceFixture.observed.stages.map((row) => [row.stage, row.count]),
  )
  const anchors: Readonly<Record<string, number>> = {
    pending_trial: 105_647,
    undetected: 92_874,
    convicted: 73_310,
    false_case: 25_668,
  }
  for (const [stage, expected] of Object.entries(anchors)) {
    assert.equal(localJustice.get(stage), expected, `${stage} fixture anchor drift`)
  }

  const adapter = createDataAdapter({ mode: CLOUD ? 'catalyst' : 'local' })
  try {
    const incidentCounts = await adapter.queryTable<CountRow>({
      table: 'IncidentsTime',
      aggregates: [{ fn: 'count', column: '*', as: 'row_count' }],
    })
    const stationCounts = await adapter.queryTable<CountRow>({
      table: 'Stations',
      aggregates: [{ fn: 'count', column: '*', as: 'row_count' }],
    })
    assert.equal(count(incidentCounts), schema.tables.Incidents.expected_rows)
    assert.equal(count(stationCounts), schema.tables.Stations.expected_rows)

    const sample = await adapter.queryTable<IncidentSearchRow>({
      table: 'IncidentsTime',
      columns: ['incident_id', 'case_ref', 'act_section'],
      filters: [{ column: 'act_section', operator: 'is_not_null' }],
      orderBy: [{ column: 'incident_id' }],
      limit: 1,
    })
    const target = sample[0]
    assert.ok(target)
    const caseHits = await adapter.searchText<IncidentSearchRow>({
      table: 'IncidentsTime',
      search: target.case_ref,
      searchColumns: ['case_ref'],
      selectColumns: ['incident_id', 'case_ref', 'act_section'],
      limit: 20,
    })
    assert.ok(
      caseHits.some((row) => row.case_ref === target.case_ref),
      'Case-reference FTS failed',
    )
    const actToken = target.act_section
      .split(/[^A-Za-z0-9]+/)
      .find((value) => value.length >= 4)
    assert.ok(actToken)
    const actHits = await adapter.searchText<IncidentSearchRow>({
      table: 'IncidentsTime',
      search: `${actToken}*`,
      searchColumns: CLOUD
        ? ['act_section_search_1', 'act_section_search_2', 'act_section_search_3']
        : ['act_section'],
      selectColumns: ['incident_id', 'case_ref', 'act_section'],
      limit: 100,
    })
    assert.ok(
      actHits.some((row) =>
        row.act_section.toLowerCase().includes(actToken.toLowerCase()),
      ),
      'Act/section FTS failed',
    )

    if (CLOUD) {
      const baselineCounts = await adapter.queryTable<CountRow>({
        table: 'WeeklyBaselines',
        aggregates: [{ fn: 'count', column: '*', as: 'row_count' }],
      })
      assert.equal(
        count(baselineCounts),
        schema.tables.WeeklyBaselines.expected_rows,
      )
      const cloudJustice = await adapter.queryTable<JusticeRow>({
        table: 'JusticeFlow',
        columns: ['stage', 'record_count'],
        filters: [{ column: 'dimension_type', operator: 'eq', value: 'global_stage' }],
      })
      const values = new Map(
        cloudJustice.map((row) => [row.stage, Number(row.record_count)]),
      )
      for (const [stage, expected] of Object.entries(anchors)) {
        assert.equal(values.get(stage), expected, `${stage} cloud anchor drift`)
      }
    }
  } finally {
    await adapter.close()
  }

  process.stdout.write(
    `verify:datastore — PASS (${CLOUD ? 'Catalyst production' : 'local source contract'})\n` +
      `  incidents / stations  425,408 / 178\n` +
      `  reduced baselines     286,330 (685 complete series)\n` +
      `  act/section chunks    191 long values, maximum 619 characters\n` +
      `  FTS                    case reference + act/section\n` +
      `  justice anchors        105,647 / 92,874 / 73,310 / 25,668\n`,
  )
}

await main()
