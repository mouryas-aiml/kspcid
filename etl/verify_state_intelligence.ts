import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { parse } from 'csv-parse/sync'

import { APP_ROOT, INPUT, OUTPUT } from './00_config.js'
import { createDataAdapter } from '../functions/shared/data-access/index.js'
import { stateWithAdapter } from '../functions/kv-state/index.js'

const data = JSON.parse(await readFile(resolve(OUTPUT.scenarios, 'state_intelligence.json'), 'utf8')) as any
const geometry = JSON.parse(await readFile(resolve(APP_ROOT, 'reference/processed/karnataka_districts.geojson'), 'utf8')) as any
const crosswalk = parse(await readFile(resolve(APP_ROOT, 'etl/overrides/state_district_crosswalk.csv'), 'utf8'), { columns: true, skip_empty_lines: true }) as any[]

assert.equal(data.schema_version, '1.0.0')
assert.equal(data.snapshot_through, '2023-12-31')
assert.equal(data.state_summary.source_rows, 1_674_734)
assert.equal(data.districts.length, 31)
assert.equal(geometry.features.length, 31)
assert.equal(new Set(data.districts.map((d: any) => d.district_id)).size, 31)
assert.equal(new Set(geometry.features.map((f: any) => f.properties.district_id)).size, 31)
assert.equal(crosswalk.length, 41)
assert.equal(new Set(crosswalk.map((r) => r.source_district)).size, 41)
assert.equal(crosswalk.filter((r) => r.classification === 'special').length, 4)
assert.equal(data.special_units.length, 4)
assert.ok(data.crime_groups.length >= 10)
assert.ok(data.backtest.observations > 1_000)
assert.ok(data.backtest.four_week_mae >= 0)
assert.ok(data.backtest.interval_10_90_coverage_pct >= 0 && data.backtest.interval_10_90_coverage_pct <= 100)
assert.ok(data.backtest.top_quintile_lift > 0)

for (const district of data.districts) {
  assert.ok(Number.isFinite(district.risk.score) && district.risk.score >= 0 && district.risk.score <= 100)
  assert.equal(district.forecast.length, 4)
  assert.equal(district.history.length, 12)
  assert.ok(district.forecast_4w.low <= district.forecast_4w.expected)
  assert.ok(district.forecast_4w.high >= district.forecast_4w.expected)
  assert.ok(district.context.population > 0 && district.context.area_sq_km > 0)
  assert.ok(district.context.urban_share_pct >= 0 && district.context.urban_share_pct <= 100)
  for (const group of data.crime_groups) {
    const outlook = district.outlooks[group]
    if (!outlook) continue
    assert.equal(outlook.forecast.length, 4)
    assert.ok(outlook.forecast.every((p: any) => p.week > data.snapshot_through))
    assert.ok(outlook.history.every((p: any) => p.week <= data.snapshot_through))
    assert.ok(Number.isFinite(outlook.risk.score) && outlook.risk.score >= 0 && outlook.risk.score <= 100)
  }
}

const db = await DuckDBInstance.create(':memory:'); const connection = await db.connect()
const path = INPUT.firCsv.replaceAll("'", "''")
const source = await connection.runAndReadAll(`SELECT count(*) AS rows, count(DISTINCT trim(District_Name)) AS districts FROM read_csv_auto('${path}', header=true, all_varchar=true)`)
const row = source.getRowObjects()[0] as any
assert.equal(Number(row.rows), 1_674_734)
assert.equal(Number(row.districts), 41)

const adapter = createDataAdapter({ mode: 'local' })
try {
  const response = await stateWithAdapter({ mode: 'risk', crimeGroup: 'All registered crime', district: 'KA-01' }, adapter) as any
  assert.equal(response.districts.length, 1)
  assert.equal(response.query.mode, 'risk')
  await assert.rejects(() => stateWithAdapter({ mode: 'invented' }, adapter), /mode must be/)
  await assert.rejects(() => stateWithAdapter({ crimeGroup: 'not-published' }, adapter), /Unsupported crimeGroup/)
  await assert.rejects(() => stateWithAdapter({ district: 'KA-99' }, adapter), /Unsupported district/)
} finally { await adapter.close() }

console.log(`State Intelligence verified: 31 districts · 41 source values · ${data.backtest.observations} leakage-safe backtest observations · endpoint validation`)
