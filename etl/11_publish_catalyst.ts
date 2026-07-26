/**
 * A4 local publication compiler.
 *
 * This stage performs no cloud mutation. DuckDB shapes the checked Parquet and
 * fixture inputs into Catalyst Data Store CSVs under .staging/dsimport, proves
 * the reduced baseline preserves the Command Feed detector set, and emits a
 * checksummed import manifest for the owner-run Catalyst import commands.
 */
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

import { sha256File } from './lib/hash.js'

const ROOT = resolve(import.meta.dirname, '..')
const STAGING = resolve(ROOT, '.staging', 'dsimport')
const INCIDENTS = resolve(ROOT, 'data', 'derived', 'incidents_time.parquet')
const STATIONS = resolve(ROOT, 'data', 'derived', 'stations.parquet')
const BASELINES = resolve(ROOT, 'data', 'derived', 'weekly_baselines.parquet')
const JUSTICE_FIXTURE = resolve(ROOT, 'data', 'scenarios', 'justice_pipeline.json')

interface JusticeFixture {
  readonly observed: {
    readonly provenance: {
      readonly source_checksum: string
      readonly generation_version: string
    }
  }
  readonly modelled: {
    readonly provenance: {
      readonly source_authority: string
      readonly transformation: string
      readonly method: string
      readonly source_checksum: string
      readonly generation_version: string
    }
    readonly edges: readonly {
      readonly source: string
      readonly target: string
      readonly count: number
    }[]
  }
}

interface DataStoreSchema {
  readonly tables: Readonly<
    Record<
      string,
      {
        readonly columns: Readonly<
          Record<
            string,
            {
              readonly mandatory?: boolean
              readonly max_length?: number
            }
          >
        >
      }
    >
  >
}

const PHYSICAL_TABLES: Readonly<Record<string, string>> = {
  stations: 'Stations',
  incidents: 'Incidents',
  baselines: 'WeeklyBaselines',
  justice: 'JusticeFlow',
  alerts: 'Alerts',
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function pathSql(path: string): string {
  return path.replaceAll("'", "''")
}

async function scalar(
  connection: DuckDBConnection,
  sql: string,
  column: string,
): Promise<number> {
  const result = await connection.runAndReadAll(sql)
  return Number(result.getRowObjectsJS()[0]?.[column])
}

async function copyCsv(
  connection: DuckDBConnection,
  name: string,
  select: string,
): Promise<string> {
  const output = resolve(STAGING, `${name}.csv`)
  await connection.run(
    `COPY (${select}) TO '${pathSql(output)}' ` +
      `(FORMAT CSV, HEADER true, DELIMITER ',', QUOTE '"', ESCAPE '"')`,
  )
  return output
}

async function validateCsvSchema(
  connection: DuckDBConnection,
  path: string,
  tableName: string,
  schema: DataStoreSchema,
): Promise<void> {
  const table = schema.tables[tableName]
  if (!table) throw new Error(`Missing Data Store schema for ${tableName}`)
  const source = `read_csv_auto('${pathSql(path)}', header = true)`
  const described = await connection.runAndReadAll(`DESCRIBE SELECT * FROM ${source}`)
  const actual = new Set(
    described.getRowObjectsJS().map((row) => String(row['column_name'])),
  )
  const expected = Object.keys(table.columns)
  const missing = expected.filter((column) => !actual.has(column))
  const extra = [...actual].filter((column) => !(column in table.columns))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${tableName} CSV/schema column drift: missing [${missing.join(', ')}], ` +
        `extra [${extra.join(', ')}]`,
    )
  }

  const expressions: string[] = []
  for (const [column, definition] of Object.entries(table.columns)) {
    if (definition.mandatory) {
      expressions.push(
        `count(*) FILTER (WHERE ${identifier(column)} IS NULL) AS ${identifier(`${column}__nulls`)}`,
      )
    }
    if (definition.max_length !== undefined) {
      expressions.push(
        `max(length(CAST(${identifier(column)} AS VARCHAR))) AS ${identifier(`${column}__length`)}`,
      )
    }
  }
  if (expressions.length === 0) return
  const result = await connection.runAndReadAll(
    `SELECT ${expressions.join(', ')} FROM ${source}`,
  )
  const row = result.getRowObjectsJS()[0] ?? {}
  const violations: string[] = []
  for (const [column, definition] of Object.entries(table.columns)) {
    if (definition.mandatory && Number(row[`${column}__nulls`] ?? 0) !== 0) {
      violations.push(`${tableName}.${column} contains nulls but is mandatory`)
    }
    const actualLength = Number(row[`${column}__length`] ?? 0)
    if (
      definition.max_length !== undefined &&
      actualLength > definition.max_length
    ) {
      violations.push(
        `${tableName}.${column} length ${actualLength} exceeds ${definition.max_length}`,
      )
    }
  }
  if (violations.length > 0) throw new Error(violations.join('\n'))
}

async function main(): Promise<void> {
  await mkdir(STAGING, { recursive: true })
  const [justice, dataStoreSchema] = await Promise.all([
    readFile(JUSTICE_FIXTURE, 'utf8').then(
      (value) => JSON.parse(value) as JusticeFixture,
    ),
    readFile(resolve(ROOT, 'etl', 'datastore', 'schema.json'), 'utf8').then(
      (value) => JSON.parse(value) as DataStoreSchema,
    ),
  ])
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  try {
    await connection.run(
      `CREATE TEMP TABLE modelled_edges (
         source_stage VARCHAR,
         target_stage VARCHAR,
         record_count BIGINT
       )`,
    )
    for (const edge of justice.modelled.edges) {
      await connection.run(
        `INSERT INTO modelled_edges VALUES (` +
          `${sqlString(edge.source)}, ${sqlString(edge.target)}, ${edge.count})`,
      )
    }

    const incidentRows = await scalar(
      connection,
      `SELECT count(*) AS count FROM read_parquet('${pathSql(INCIDENTS)}')`,
      'count',
    )
    const stationRows = await scalar(
      connection,
      `SELECT count(*) AS count FROM read_parquet('${pathSql(STATIONS)}')`,
      'count',
    )
    const rawBaselineRows = await scalar(
      connection,
      `SELECT count(*) AS count FROM read_parquet('${pathSql(BASELINES)}')`,
      'count',
    )
    const reducedBaselineRows = await scalar(
      connection,
      `WITH baselines AS (
         SELECT * FROM read_parquet('${pathSql(BASELINES)}')
       ),
       eligible_pairs AS (
         SELECT station_key, crime_head
         FROM baselines
         GROUP BY station_key, crime_head
         HAVING max(CASE WHEN fir_count >= 5 AND fir_count > ucl_99 THEN 1 ELSE 0 END) = 1
       )
       SELECT count(*) AS count
       FROM baselines
       INNER JOIN eligible_pairs USING (station_key, crime_head)`,
      'count',
    )
    const lostFeedCandidates = await scalar(
      connection,
      `WITH baselines AS (
         SELECT * FROM read_parquet('${pathSql(BASELINES)}')
       ),
       eligible_pairs AS (
         SELECT station_key, crime_head
         FROM baselines
         GROUP BY station_key, crime_head
         HAVING max(CASE WHEN fir_count >= 5 AND fir_count > ucl_99 THEN 1 ELSE 0 END) = 1
       ),
       reduced AS (
         SELECT b.* FROM baselines b
         INNER JOIN eligible_pairs USING (station_key, crime_head)
       ),
       expected AS (
         SELECT station_key, crime_head, week_start, fir_count, ucl_99, z_score
         FROM baselines
         WHERE week_start >= DATE '2023-07-01'
           AND fir_count >= 5 AND fir_count > ucl_99
       ),
       actual AS (
         SELECT station_key, crime_head, week_start, fir_count, ucl_99, z_score
         FROM reduced
         WHERE week_start >= DATE '2023-07-01'
           AND fir_count >= 5 AND fir_count > ucl_99
       )
       SELECT count(*) AS count FROM (
         (SELECT * FROM expected EXCEPT SELECT * FROM actual)
         UNION ALL
         (SELECT * FROM actual EXCEPT SELECT * FROM expected)
       )`,
      'count',
    )
    if (incidentRows !== 425_408) {
      throw new Error(`Incident source drift: expected 425408, found ${incidentRows}`)
    }
    if (stationRows !== 178) {
      throw new Error(`Station source drift: expected 178, found ${stationRows}`)
    }
    if (rawBaselineRows !== 5_797_660 || reducedBaselineRows !== 286_330) {
      throw new Error(
        `Baseline reduction drift: ${rawBaselineRows} raw / ${reducedBaselineRows} reduced`,
      )
    }
    if (lostFeedCandidates !== 0) {
      throw new Error(`Reduced baseline changes ${lostFeedCandidates} Command Feed facts`)
    }

    const outputs = await Promise.all([
      copyCsv(
        connection,
        'stations',
        `SELECT * FROM read_parquet('${pathSql(STATIONS)}') ORDER BY station_code`,
      ),
      copyCsv(
        connection,
        'incidents',
        `SELECT *,
                substr(coalesce(act_section, ''), 1, 255) AS act_section_search_1,
                nullif(substr(coalesce(act_section, ''), 256, 255), '') AS act_section_search_2,
                nullif(substr(coalesce(act_section, ''), 511, 255), '') AS act_section_search_3
         FROM read_parquet('${pathSql(INCIDENTS)}')
         ORDER BY incident_id`,
      ),
      copyCsv(
        connection,
        'baselines',
        `WITH baselines AS (
           SELECT * FROM read_parquet('${pathSql(BASELINES)}')
         ),
         eligible_pairs AS (
           SELECT station_key, crime_head
           FROM baselines
           GROUP BY station_key, crime_head
           HAVING max(CASE WHEN fir_count >= 5 AND fir_count > ucl_99 THEN 1 ELSE 0 END) = 1
         )
         SELECT b.station_key || ':' || b.crime_head || ':' || b.iso_week AS baseline_id,
                b.*
         FROM baselines b
         INNER JOIN eligible_pairs USING (station_key, crime_head)
         ORDER BY b.station_key, b.crime_head, b.week_start`,
      ),
      copyCsv(
        connection,
        'justice',
        `WITH incidents AS (
           SELECT * FROM read_parquet('${pathSql(INCIDENTS)}')
         ),
         global_stage AS (
           SELECT 'global:' || stage AS flow_id,
                  'global_stage' AS dimension_type,
                  NULL::VARCHAR AS station_code,
                  NULL::VARCHAR AS unit_name,
                  NULL::VARCHAR AS police_division,
                  NULL::INTEGER AS fir_year,
                  stage,
                  NULL::VARCHAR AS age_bucket,
                  NULL::VARCHAR AS source_stage,
                  NULL::VARCHAR AS target_stage,
                  count(*)::BIGINT AS record_count,
                  'third_party_mirror' AS source_authority,
                  'normalized' AS transformation,
                  'current_stage_group_by_v1' AS method
           FROM incidents GROUP BY stage
         ),
         year_stage AS (
           SELECT 'year:' || fir_year::VARCHAR || ':' || stage AS flow_id,
                  'year_stage' AS dimension_type,
                  NULL::VARCHAR AS station_code,
                  NULL::VARCHAR AS unit_name,
                  NULL::VARCHAR AS police_division,
                  fir_year,
                  stage,
                  NULL::VARCHAR AS age_bucket,
                  NULL::VARCHAR AS source_stage,
                  NULL::VARCHAR AS target_stage,
                  count(*)::BIGINT AS record_count,
                  'third_party_mirror' AS source_authority,
                  'normalized' AS transformation,
                  'current_stage_group_by_v1' AS method
           FROM incidents GROUP BY fir_year, stage
         ),
         station_stage AS (
           SELECT 'station:' || coalesce(station_code, 'UNMAPPED') || ':' || stage AS flow_id,
                  'station_stage' AS dimension_type,
                  station_code,
                  min(unit_name) AS unit_name,
                  min(police_division) AS police_division,
                  NULL::INTEGER AS fir_year,
                  stage,
                  NULL::VARCHAR AS age_bucket,
                  NULL::VARCHAR AS source_stage,
                  NULL::VARCHAR AS target_stage,
                  count(*)::BIGINT AS record_count,
                  'third_party_mirror' AS source_authority,
                  'normalized' AS transformation,
                  'current_stage_group_by_v1' AS method
           FROM incidents GROUP BY station_code, stage
         ),
         station_age AS (
           SELECT 'age:' || coalesce(station_code, 'UNMAPPED') || ':' ||
                    CASE
                      WHEN date_diff('day', registered_on, DATE '2023-12-31') < 30 THEN 'lt_30d'
                      WHEN date_diff('day', registered_on, DATE '2023-12-31') < 90 THEN '30_90d'
                      WHEN date_diff('day', registered_on, DATE '2023-12-31') < 180 THEN '90_180d'
                      WHEN date_diff('day', registered_on, DATE '2023-12-31') < 365 THEN '180_365d'
                      WHEN date_diff('day', registered_on, DATE '2023-12-31') < 730 THEN '1_2y'
                      ELSE '2y_plus'
                    END AS flow_id,
                  'station_age' AS dimension_type,
                  station_code,
                  min(unit_name) AS unit_name,
                  min(police_division) AS police_division,
                  NULL::INTEGER AS fir_year,
                  NULL::VARCHAR AS stage,
                  CASE
                    WHEN date_diff('day', registered_on, DATE '2023-12-31') < 30 THEN 'lt_30d'
                    WHEN date_diff('day', registered_on, DATE '2023-12-31') < 90 THEN '30_90d'
                    WHEN date_diff('day', registered_on, DATE '2023-12-31') < 180 THEN '90_180d'
                    WHEN date_diff('day', registered_on, DATE '2023-12-31') < 365 THEN '180_365d'
                    WHEN date_diff('day', registered_on, DATE '2023-12-31') < 730 THEN '1_2y'
                    ELSE '2y_plus'
                  END AS age_bucket,
                  NULL::VARCHAR AS source_stage,
                  NULL::VARCHAR AS target_stage,
                  count(*)::BIGINT AS record_count,
                  'third_party_mirror' AS source_authority,
                  'derived' AS transformation,
                  'open_case_age_bucket_v1' AS method
           FROM incidents
           WHERE within_complete_window
             AND stage IN ('pending_trial', 'under_investigation', 'undetected', 'un_traced')
           GROUP BY station_code, age_bucket
         ),
         modelled AS (
           SELECT 'modelled:' || source_stage || ':' || target_stage AS flow_id,
                  'modelled_edge' AS dimension_type,
                  NULL::VARCHAR AS station_code,
                  NULL::VARCHAR AS unit_name,
                  NULL::VARCHAR AS police_division,
                  NULL::INTEGER AS fir_year,
                  NULL::VARCHAR AS stage,
                  NULL::VARCHAR AS age_bucket,
                  source_stage,
                  target_stage,
                  record_count,
                  ${sqlString(justice.modelled.provenance.source_authority)} AS source_authority,
                  ${sqlString(justice.modelled.provenance.transformation)} AS transformation,
                  ${sqlString(justice.modelled.provenance.method)} AS method
           FROM modelled_edges
         ),
         combined AS (
           SELECT * FROM global_stage
           UNION ALL SELECT * FROM year_stage
           UNION ALL SELECT * FROM station_stage
           UNION ALL SELECT * FROM station_age
           UNION ALL SELECT * FROM modelled
         )
         SELECT *,
                CASE WHEN dimension_type = 'modelled_edge'
                  THEN ${sqlString(justice.modelled.provenance.source_checksum)}
                  ELSE ${sqlString(justice.observed.provenance.source_checksum)}
                END AS source_checksum,
                CASE WHEN dimension_type = 'modelled_edge'
                  THEN ${sqlString(justice.modelled.provenance.generation_version)}
                  ELSE ${sqlString(justice.observed.provenance.generation_version)}
                END AS generation_version
         FROM combined ORDER BY dimension_type, flow_id`,
      ),
      copyCsv(
        connection,
        'alerts',
        `SELECT NULL::VARCHAR AS alert_id,
                NULL::VARCHAR AS station_code,
                NULL::VARCHAR AS crime_head,
                NULL::VARCHAR AS iso_week,
                NULL::VARCHAR AS status,
                NULL::VARCHAR AS actor_user_id,
                NULL::VARCHAR AS note,
                NULL::TIMESTAMP AS created_at,
                NULL::TIMESTAMP AS updated_at
         WHERE false`,
      ),
    ])

    const expected: Readonly<Record<string, number>> = {
      stations: stationRows,
      incidents: incidentRows,
      baselines: reducedBaselineRows,
      justice: 2_150,
      alerts: 0,
    }
    const files = []
    for (const output of outputs) {
      const name = output.slice(output.lastIndexOf('/') + 1, -4)
      const csvRows = await scalar(
        connection,
        `SELECT count(*) AS count FROM read_csv_auto('${pathSql(output)}', header = true)`,
        'count',
      )
      if (csvRows !== expected[name]) {
        throw new Error(`${name} CSV row drift: expected ${expected[name]}, found ${csvRows}`)
      }
      await validateCsvSchema(
        connection,
        output,
        PHYSICAL_TABLES[name] ?? name,
        dataStoreSchema,
      )
      const info = await stat(output)
      files.push({
        table: name,
        path: relative(ROOT, output),
        rows: csvRows,
        bytes: info.size,
        sha256: await sha256File(output),
      })
    }
    const datasetSha256 = createHash('sha256')
      .update(
        files
          .map((file) =>
            [file.table, file.rows, file.bytes, file.sha256].join('\0'),
          )
          .join('\n'),
      )
      .digest('hex')
    const stableManifest = {
      schema_version: 1,
      dataset_sha256: datasetSha256,
      source_manifest: 'data/manifest.json',
      baseline_reduction: {
        raw_rows: rawBaselineRows,
        imported_rows: reducedBaselineRows,
        retained_station_crime_pairs: reducedBaselineRows / 418,
        command_feed_fact_mismatches: lostFeedCandidates,
      },
      files,
    }
    const committedManifest = JSON.parse(
      await readFile(resolve(ROOT, 'etl', 'cloud', 'publication-manifest.json'), 'utf8'),
    ) as unknown
    if (JSON.stringify(stableManifest) !== JSON.stringify(committedManifest)) {
      throw new Error(
        'Publication manifest drift: inspect the staged files and explicitly update ' +
          'etl/cloud/publication-manifest.json before any upload',
      )
    }
    const manifestPath = resolve(STAGING, 'manifest.json')
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          ...stableManifest,
          generated_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    process.stdout.write(
      `A4 shape · ${incidentRows.toLocaleString()} incidents · ` +
        `${stationRows} stations · ${reducedBaselineRows.toLocaleString()} baselines · ` +
        `0 Command Feed mismatches\n` +
        `Staged at ${dirname(manifestPath)}\n`,
    )
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
}

await main()
