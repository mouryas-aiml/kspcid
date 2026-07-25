/** Acceptance checks for A17b non-geographic Cyber Intelligence Wing. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { OUTPUT } from './00_config.js'
import { CYBER_MAPPABLE } from './00_config.js'
import { sha256File } from './lib/hash.js'
import { query } from './lib/parquet.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

interface Fixture {
  readonly zero_geographic_dependency: boolean
  readonly summary: {
    readonly cyber_records: number
    readonly all_records: number
    readonly caseload_share_pct: number
    readonly nonzero_coordinates: number
    readonly nonzero_share_pct: number
    readonly mappable_coordinates: number
    readonly mappable_share_pct: number
  }
  readonly monthly_volume: readonly { cyber_records: number; partial_window: boolean }[]
  readonly top_act_sections: readonly { act_section: string; count: number }[]
  readonly complaint_modes: readonly { complaint_mode: string; count: number }[]
  readonly complaint_modes_by_year: readonly { year: number; complaint_mode: string; count: number }[]
  readonly outcomes: readonly { stage: string; count: number }[]
  readonly victims: Readonly<Record<string, number>>
  readonly provenance: Readonly<Record<string, unknown>>
}

async function main(): Promise<void> {
  const fixturePath = resolve(OUTPUT.scenarios, 'cyber_wing.json')
  const sourcePath = resolve(OUTPUT.derived, 'incidents_time.parquet')
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture
  const raw = await query(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE crime_group = 'CYBER CRIME') AS cyber,
            count(*) FILTER (
              WHERE crime_group = 'CYBER CRIME'
                AND source_latitude <> 0 AND source_longitude <> 0
            ) AS nonzero,
            count(*) FILTER (
              WHERE crime_group = 'CYBER CRIME'
                AND source_latitude BETWEEN 12.7 AND 13.2
                AND source_longitude BETWEEN 77.35 AND 77.85
            ) AS mappable,
            sum(victim_male) FILTER (WHERE crime_group = 'CYBER CRIME') AS male,
            sum(victim_female) FILTER (WHERE crime_group = 'CYBER CRIME') AS female,
            sum(victim_boy) FILTER (WHERE crime_group = 'CYBER CRIME') AS boy,
            sum(victim_girl) FILTER (WHERE crime_group = 'CYBER CRIME') AS girl
       FROM read_parquet('${sourcePath.replaceAll("'", "''")}')`,
  ) as Array<Record<string, unknown>>
  const row = raw[0]!
  assert(fixture.zero_geographic_dependency, 'Cyber view must have zero geographic dependency')
  assert(fixture.summary.cyber_records === Number(row['cyber']) && fixture.summary.cyber_records === 64_599, 'Cyber total drift')
  assert(fixture.summary.all_records === Number(row['total']) && fixture.summary.all_records === 425_408, 'Caseload denominator drift')
  assert(fixture.summary.caseload_share_pct === 15.19, 'Cyber caseload share drift')
  assert(fixture.summary.nonzero_coordinates === Number(row['nonzero']) && fixture.summary.nonzero_coordinates === 10_626, 'Non-zero coordinate count drift')
  assert(fixture.summary.mappable_coordinates === Number(row['mappable']) && fixture.summary.mappable_coordinates === CYBER_MAPPABLE.rows, 'Mappable coordinate count drift')
  assert(fixture.summary.mappable_share_pct === 13.66, 'Mappable share drift')
  assert(fixture.monthly_volume.reduce((sum, value) => sum + value.cyber_records, 0) === 64_599, 'Monthly cyber conservation failed')
  assert(fixture.monthly_volume.some((value) => value.partial_window), '2024 partial-window disclosure missing')
  assert(fixture.complaint_modes.reduce((sum, value) => sum + value.count, 0) === 64_599, 'Complaint-mode conservation failed')
  assert(fixture.complaint_modes_by_year.reduce((sum, value) => sum + value.count, 0) === 64_599, 'Complaint-mode year cube conservation failed')
  assert(fixture.complaint_modes.find((value) => value.complaint_mode === 'Online')?.count === 2, 'Cyber Online complaint-mode drift')
  assert(fixture.outcomes.reduce((sum, value) => sum + value.count, 0) === 64_599, 'Outcome conservation failed')
  assert(
    Object.entries(fixture.victims).every(([category, value]) => value === Number(row[category])),
    'Victim-category reconciliation failed',
  )
  assert(
    fixture.provenance['source_authority'] === 'third_party_mirror' &&
      fixture.provenance['transformation'] === 'normalized',
    'Cyber provenance drift',
  )
  const checksum = await sha256File(fixturePath)
  process.stdout.write(
    `verify:cyber — PASS\n` +
      `  cyber / all         ${fixture.summary.cyber_records.toLocaleString()} / ${fixture.summary.all_records.toLocaleString()} (${fixture.summary.caseload_share_pct.toFixed(2)}%)\n` +
      `  mappable            ${fixture.summary.mappable_coordinates.toLocaleString()} (${fixture.summary.mappable_share_pct.toFixed(2)}%)\n` +
      `  nonzero             ${fixture.summary.nonzero_coordinates.toLocaleString()} (${fixture.summary.nonzero_share_pct.toFixed(1)}%)\n` +
      `  geographic deps     zero\n` +
      `  fixture sha256      ${checksum}\n`,
  )
}

await main()
