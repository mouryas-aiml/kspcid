/**
 * A17b — Cyber Intelligence Wing, observed charts only.
 *
 * This artifact intentionally has no map, routing, or graph dependency.
 * Coordinate counts are context metrics computed against the canonical OSRM
 * bbox; they do not drive any visualization on the screen.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { OUTPUT } from './00_config.js'
import { BLR_BBOX } from './lib/geo.js'
import { GENERATION_VERSION, sha256File } from './lib/hash.js'
import { recordOutput } from './lib/manifest.js'
import { query } from './lib/parquet.js'

const INPUT_PATH = resolve(OUTPUT.derived, 'incidents_time.parquet')
const OUTPUT_PATH = resolve(OUTPUT.scenarios, 'cyber_wing.json')
const REPORT_PATH = resolve(OUTPUT.reports, 'a17b_cyber_wing.md')

function normalize(rows: Array<Record<string, unknown>>): Array<Record<string, string | number>> {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value]),
    ) as Record<string, string | number>,
  )
}

async function main(): Promise<void> {
  const sourceChecksum = await sha256File(INPUT_PATH)
  const [summaryRaw, monthlyRaw, sectionsRaw, modesRaw, modesByYearRaw, outcomesRaw, victimsRaw] =
    await Promise.all([
      query(
        `SELECT count(*) AS cyber_records,
                (SELECT count(*) FROM read_parquet('${INPUT_PATH.replaceAll("'", "''")}')) AS all_records,
                count(*) FILTER (
                  WHERE source_latitude <> 0 AND source_longitude <> 0
                ) AS nonzero_coordinates,
                count(*) FILTER (
                  WHERE source_latitude BETWEEN ${BLR_BBOX.minLat} AND ${BLR_BBOX.maxLat}
                    AND source_longitude BETWEEN ${BLR_BBOX.minLon} AND ${BLR_BBOX.maxLon}
                ) AS mappable_coordinates
           FROM read_parquet('${INPUT_PATH.replaceAll("'", "''")}')
          WHERE crime_group = 'CYBER CRIME'`,
      ),
      query(
        `SELECT strftime(date_trunc('month', registered_on), '%Y-%m') AS month,
                count(*) AS total_records,
                count(*) FILTER (WHERE crime_group = 'CYBER CRIME') AS cyber_records,
                NOT bool_and(within_complete_window) AS partial_window
           FROM read_parquet('${INPUT_PATH.replaceAll("'", "''")}')
          GROUP BY month ORDER BY month`,
      ),
      query(
        `SELECT act_section, count(*) AS count
           FROM read_parquet('${INPUT_PATH.replaceAll("'", "''")}')
          WHERE crime_group = 'CYBER CRIME'
          GROUP BY act_section ORDER BY count DESC, act_section LIMIT 18`,
      ),
      query(
        `SELECT complaint_mode, count(*) AS count
           FROM read_parquet('${INPUT_PATH.replaceAll("'", "''")}')
          WHERE crime_group = 'CYBER CRIME'
          GROUP BY complaint_mode ORDER BY count DESC, complaint_mode`,
      ),
      query(
        `SELECT fir_year AS year, complaint_mode, count(*) AS count
           FROM read_parquet('${INPUT_PATH.replaceAll("'", "''")}')
          WHERE crime_group = 'CYBER CRIME'
          GROUP BY fir_year, complaint_mode ORDER BY fir_year, complaint_mode`,
      ),
      query(
        `SELECT stage, count(*) AS count
           FROM read_parquet('${INPUT_PATH.replaceAll("'", "''")}')
          WHERE crime_group = 'CYBER CRIME'
          GROUP BY stage ORDER BY count DESC, stage`,
      ),
      query(
        `SELECT sum(victim_male) AS male, sum(victim_female) AS female,
                sum(victim_boy) AS boy, sum(victim_girl) AS girl
           FROM read_parquet('${INPUT_PATH.replaceAll("'", "''")}')
          WHERE crime_group = 'CYBER CRIME'`,
      ),
    ])
  const summary = normalize(summaryRaw as Array<Record<string, unknown>>)[0]!
  const cyberRecords = Number(summary['cyber_records'])
  const allRecords = Number(summary['all_records'])
  const nonzero = Number(summary['nonzero_coordinates'])
  const mappable = Number(summary['mappable_coordinates'])
  const fixture = {
    schema_version: 1,
    fixture_id: 'cyber-wing-v1',
    zero_geographic_dependency: true,
    summary: {
      cyber_records: cyberRecords,
      all_records: allRecords,
      caseload_share_pct: Math.round((cyberRecords / allRecords) * 10_000) / 100,
      nonzero_coordinates: nonzero,
      nonzero_share_pct: Math.round((nonzero / cyberRecords) * 10_000) / 100,
      mappable_coordinates: mappable,
      mappable_share_pct: Math.round((mappable / cyberRecords) * 10_000) / 100,
      canonical_bbox: BLR_BBOX,
    },
    monthly_volume: normalize(monthlyRaw as Array<Record<string, unknown>>),
    top_act_sections: normalize(sectionsRaw as Array<Record<string, unknown>>),
    complaint_modes: normalize(modesRaw as Array<Record<string, unknown>>),
    complaint_modes_by_year: normalize(modesByYearRaw as Array<Record<string, unknown>>),
    outcomes: normalize(outcomesRaw as Array<Record<string, unknown>>),
    victims: normalize(victimsRaw as Array<Record<string, unknown>>)[0],
    provenance: {
      source_authority: 'third_party_mirror',
      transformation: 'normalized',
      method: 'cyber_group_observed_aggregates_v1',
      source_checksum: sourceChecksum,
      generation_version: GENERATION_VERSION,
    },
  }
  await mkdir(OUTPUT.scenarios, { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
  await recordOutput(
    '17b_cyber_fixture',
    OUTPUT_PATH,
    cyberRecords,
    [{ path: INPUT_PATH, sha256: sourceChecksum }],
    {
      caseload_share_pct: fixture.summary.caseload_share_pct,
      mappable_coordinates: mappable,
      mappable_share_pct: fixture.summary.mappable_share_pct,
      zero_geographic_dependency: true,
    },
  )
  const online = (fixture.complaint_modes as Array<Record<string, string | number>>).find(
    (row) => row['complaint_mode'] === 'Online',
  )
  await mkdir(OUTPUT.reports, { recursive: true })
  await writeFile(
    REPORT_PATH,
    `# A17b Cyber Intelligence Wing\n\n` +
      `- Cyber FIR rows: **${cyberRecords.toLocaleString()} (${fixture.summary.caseload_share_pct.toFixed(2)}%)**\n` +
      `- Non-zero source coordinates: **${nonzero.toLocaleString()} (${fixture.summary.nonzero_share_pct.toFixed(1)}%)**\n` +
      `- Inside canonical routable bbox: **${mappable.toLocaleString()} (${fixture.summary.mappable_share_pct.toFixed(2)}%)**\n` +
      `- Cyber complaint mode explicitly recorded as Online: **${Number(online?.['count'] ?? 0).toLocaleString()}**\n` +
      `- Geographic dependency: **none**\n\n` +
      `DRIFT: the mirror does not support a rising cyber Online complaint-mode claim; only the exact observed counts are rendered.\n`,
    'utf8',
  )
  process.stdout.write(
    `A17b · ${cyberRecords.toLocaleString()} cyber FIRs · ${fixture.summary.caseload_share_pct.toFixed(2)}% caseload · ${fixture.summary.mappable_share_pct.toFixed(2)}% mappable\n`,
  )
}

await main()
