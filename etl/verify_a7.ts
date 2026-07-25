/**
 * Acceptance checks for BUILD_SPEC A7 (ETL 04–06).
 *
 * Kept separate from the 30 source reconciliation checks: those prove A00–A3
 * preserve the raw facts; these prove later inference/derived artifacts obey
 * their own contracts without changing the reconciliation count.
 */
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

import { OUTPUT } from './00_config.js'
import { query } from './lib/parquet.js'

function number(value: unknown): number {
  return Number(value)
}

async function main(): Promise<void> {
  const time = (
    await query(
      `SELECT count(*) total,
              count(*) FILTER (WHERE crime_group = 'CYBER CRIME'
                                AND estimated_occurrence_hour IS NULL) cyber_null,
              count(*) FILTER (WHERE crime_group = 'MISSING PERSON'
                                AND estimated_occurrence_hour IS NULL) missing_null,
              count(*) FILTER (WHERE crime_group NOT IN ('CYBER CRIME', 'MISSING PERSON')
                                AND estimated_occurrence_hour IS NULL) unexpected_null,
              count(*) FILTER (WHERE estimated_occurrence_hour < 0
                                OR estimated_occurrence_hour > 23) out_of_range
       FROM '${resolve(OUTPUT.derived, 'incidents_time.parquet')}'`,
    )
  )[0]!
  assert.equal(number(time['total']), 425_408)
  assert.equal(number(time['cyber_null']), 64_599)
  assert.equal(number(time['missing_null']), 39_234)
  assert.equal(number(time['unexpected_null']), 0)
  assert.equal(number(time['out_of_range']), 0)

  const mo = (
    await query(
      `SELECT count(*) total,
              count(*) FILTER (WHERE vector_dimensions <> 64) wrong_dimensions,
              count(DISTINCT vector_document_id) documents
       FROM '${resolve(OUTPUT.derived, 'mo_signatures.parquet')}'`,
    )
  )[0]!
  assert.equal(number(mo['total']), 425_408)
  assert.equal(number(mo['wrong_dimensions']), 0)
  assert.equal(number(mo['documents']), 425_408)

  const baseline = (
    await query(
      `SELECT count(*) total,
              sum(fir_count) fitted_rows,
              count(*) FILTER (WHERE week_start >= DATE '2024-01-01') rows_2024,
              min(week_start) min_week,
              max(week_start) max_week
       FROM '${resolve(OUTPUT.derived, 'weekly_baselines.parquet')}'`,
    )
  )[0]!
  assert.equal(number(baseline['total']), 5_797_660)
  assert.equal(number(baseline['fitted_rows']), 412_754)
  assert.equal(number(baseline['rows_2024']), 0)
  assert.equal(String(baseline['min_week']), '2015-12-28')
  assert.equal(String(baseline['max_week']), '2023-12-25')

  process.stdout.write(
    'A7 verified: time null rules, MO dimensions, and complete-window baselines pass.\n',
  )
}

await main()
