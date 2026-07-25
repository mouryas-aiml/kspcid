/**
 * Reconciliation test — derived Parquet vs the raw source CSV.
 *
 * §7.4 requires the Justice Pipeline totals to reconcile exactly with a raw
 * `GROUP BY` on the source and says, in as many words, *write a test that
 * asserts this*. This is that test, run early and over more than the Sankey:
 * stage counts, victim and accused sums, the cyber share, the completeness
 * window and the demo spine.
 *
 * Both sides go through a real CSV reader. `CrimeHead_Name` contains embedded
 * commas inside quotes, so a shell-level split disagrees with the truth by
 * 73,213 rows — see reports/a00_data_truth.md.
 *
 *   npm run verify
 */
import { resolve } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'

import { INPUT, OUTPUT, TARGET_DISTRICT, ANALYSIS_CUTOFF, DEMO_SPINE } from './00_config.js'

interface Check {
  name: string
  csv: string
  parquet: string
}

const INCIDENTS = `'${resolve(OUTPUT.derived, 'incidents.parquet')}'`

const CHECKS: readonly Check[] = [
  { name: 'total rows', csv: 'count(*)', parquet: 'count(*)' },
  { name: 'distinct units', csv: 'count(DISTINCT UnitName)', parquet: 'count(DISTINCT unit_name)' },
  {
    // Compared against the whitespace-normalized source, not the raw one. Seven
    // crime heads carry two spellings differing only by internal whitespace
    // ("Sudden Quarrel", "For Gain", "Attempt To Commit", …), so raw distinct is
    // 359 and normalized is 352. Asserting against 359 would be demanding that
    // normalization not happen — and leaving those unmerged would split each of
    // those heads across two rows in every count and chart.
    name: 'distinct crime heads (normalized)',
    csv: `count(DISTINCT trim(regexp_replace(CrimeHead_Name, '\\s+', ' ', 'g')))`,
    parquet: 'count(DISTINCT crime_head)',
  },
  {
    name: 'distinct crime groups (normalized)',
    csv: `count(DISTINCT trim(regexp_replace(CrimeGroup_Name, '\\s+', ' ', 'g')))`,
    parquet: 'count(DISTINCT crime_group)',
  },
  {
    name: 'victim male sum',
    csv: 'sum(TRY_CAST("Male" AS BIGINT))',
    parquet: 'sum(victim_male)',
  },
  {
    name: 'victim female sum',
    csv: 'sum(TRY_CAST("Female" AS BIGINT))',
    parquet: 'sum(victim_female)',
  },
  { name: 'victim boy sum', csv: 'sum(TRY_CAST("Boy" AS BIGINT))', parquet: 'sum(victim_boy)' },
  { name: 'victim girl sum', csv: 'sum(TRY_CAST("Girl" AS BIGINT))', parquet: 'sum(victim_girl)' },
  {
    name: 'accused sum',
    csv: 'sum(TRY_CAST("Accused Count" AS BIGINT))',
    parquet: 'sum(accused_count)',
  },
  {
    name: 'chargesheeted sum',
    csv: 'sum(TRY_CAST("Accused_ChargeSheeted Count" AS BIGINT))',
    parquet: 'sum(chargesheeted_count)',
  },
  {
    name: 'conviction sum',
    csv: 'sum(TRY_CAST("Conviction Count" AS BIGINT))',
    parquet: 'sum(conviction_count)',
  },
  {
    name: 'cyber rows',
    csv: `count(*) FILTER (WHERE trim(CrimeGroup_Name) = 'CYBER CRIME')`,
    parquet: `count(*) FILTER (WHERE crime_group = 'CYBER CRIME')`,
  },
  {
    name: 'online complaints',
    csv: `count(*) FILTER (WHERE Complaint_Mode = 'Online')`,
    parquet: 'count(*) FILTER (WHERE is_online)',
  },
  {
    name: 'outside complete window',
    csv: `count(*) FILTER (WHERE FIR_YEAR > '${ANALYSIS_CUTOFF.slice(0, 4)}')`,
    parquet: 'count(*) FILTER (WHERE NOT within_complete_window)',
  },
  {
    name: 'demo spine rows',
    csv: `count(*) FILTER (WHERE CrimeHead_Name = '${DEMO_SPINE.crimeHead}')`,
    parquet: `count(*) FILTER (WHERE crime_head = '${DEMO_SPINE.crimeHead}')`,
  },
]

/** §7.4's canonical stages, each asserted against its raw source value. */
const STAGE_CHECKS: ReadonlyArray<readonly [raw: string, canonical: string]> = [
  ['Pending Trial', 'pending_trial'],
  ['Undetected', 'undetected'],
  ['Convicted', 'convicted'],
  ['False Case', 'false_case'],
  ['Traced', 'traced'],
  ['Under Investigation', 'under_investigation'],
  ['Compounded', 'compounded'],
  ['Dis/Acq', 'discharged_acquitted'],
  ['BoundOver', 'bound_over'],
  ['Other Disposal', 'other_disposal'],
  ['Un Traced', 'un_traced'],
  ['Abated', 'abated'],
]

async function main(): Promise<void> {
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  const q = async (sql: string): Promise<Record<string, unknown>[]> =>
    (await connection.runAndReadAll(sql)).getRowObjects()

  await connection.run(
    `CREATE VIEW blr AS SELECT * FROM read_csv('${INPUT.firCsv}', header=true, all_varchar=true) ` +
      `WHERE District_Name = '${TARGET_DISTRICT}'`,
  )

  const results: Array<{ name: string; csv: string; parquet: string; ok: boolean }> = []

  for (const check of CHECKS) {
    const csv = String((await q(`SELECT ${check.csv} AS v FROM blr`))[0]?.['v'])
    const parquet = String((await q(`SELECT ${check.parquet} AS v FROM ${INCIDENTS}`))[0]?.['v'])
    results.push({ name: check.name, csv, parquet, ok: csv === parquet })
  }

  for (const [raw, canonical] of STAGE_CHECKS) {
    const csv = String(
      (await q(`SELECT count(*) AS v FROM blr WHERE FIR_Stage = '${raw}'`))[0]?.['v'],
    )
    const parquet = String(
      (await q(`SELECT count(*) AS v FROM ${INCIDENTS} WHERE stage = '${canonical}'`))[0]?.['v'],
    )
    results.push({ name: `stage: ${raw}`, csv, parquet, ok: csv === parquet })
  }

  // Transfers collapse 44 raw variants into one bucket, so they reconcile as a
  // pattern match rather than an equality on the raw string.
  {
    const csv = String(
      (await q(`SELECT count(*) AS v FROM blr WHERE FIR_Stage LIKE 'Transfer%'`))[0]?.['v'],
    )
    const parquet = String(
      (await q(`SELECT count(*) AS v FROM ${INCIDENTS} WHERE stage = 'transferred'`))[0]?.['v'],
    )
    results.push({ name: 'stage: Transfered (all variants)', csv, parquet, ok: csv === parquet })
  }

  // Row conservation across the geography tiers — nothing may be lost in 03.
  {
    const total = String((await q(`SELECT count(*) AS v FROM ${INCIDENTS}`))[0]?.['v'])
    const tiers = String(
      (
        await q(
          `SELECT count(*) AS v FROM ${INCIDENTS} WHERE geo_origin IN ` +
            `('reported','reported_corrected','inferred','unlocatable')`,
        )
      )[0]?.['v'],
    )
    results.push({ name: 'geo tier conservation', csv: total, parquet: tiers, ok: total === tiers })
  }

  // Non-negotiable #4, asserted rather than assumed.
  {
    const violations = String(
      (
        await q(
          `SELECT count(*) AS v FROM ${INCIDENTS} ` +
            `WHERE map_pin_eligible AND geo_origin NOT IN ('reported','reported_corrected')`,
        )
      )[0]?.['v'],
    )
    results.push({
      name: 'no inferred row is pin-eligible',
      csv: '0',
      parquet: violations,
      ok: violations === '0',
    })
  }

  connection.closeSync()

  const failed = results.filter((r) => !r.ok)
  for (const r of results) {
    process.stdout.write(
      `  ${r.ok ? '✅' : '❌'} ${r.name.padEnd(34)} source=${r.csv.padStart(9)}  derived=${r.parquet.padStart(9)}\n`,
    )
  }
  process.stdout.write(
    failed.length === 0
      ? `\n  ✅ ${results.length} reconciliations exact.\n`
      : `\n  ❌ ${failed.length} of ${results.length} failed.\n`,
  )
  if (failed.length > 0) process.exitCode = 1
}

main().catch((error: unknown) => {
  process.stderr.write(`reconciliation failed: ${String(error)}\n`)
  process.exitCode = 1
})
