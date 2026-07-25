/**
 * Demo spine audit (BUILD_SPEC §11.1, §12).
 *
 * An earlier draft built the narrative on a Kadugodi chain-snatching spike. A
 * data audit killed it: 1,784 Bengaluru rows across 109 stations over nine
 * years — roughly 16 per station per *year*, peak station-month of 6. A "12 this
 * week vs 5 expected" alert is not supportable, and it would have collapsed
 * under one query from a judge.
 *
 * So this runs before the corridor is frozen, and it **ranks alternates
 * automatically**. Do not hand-pick a narrative again.
 *
 * Everything is measured inside the complete collection window — a spine
 * validated on the three-month 2024 stub would be meaningless.
 *
 *   npm run etl:spine
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { OUTPUT, INPUT, ANALYSIS_CUTOFF, DEMO_SPINE } from './00_config.js'
import { query } from './lib/parquet.js'
import { minBoundaryDistanceKm, type StationFeature } from './lib/geo.js'

const INCIDENTS = `'${resolve(OUTPUT.derived, 'incidents.parquet')}'`
const WINDOW = `within_complete_window`

interface Candidate {
  crime_head: string
  row_count: number
  pin_eligible: number
  coord_share: number
  stations: number
  peak_station_month: number
  divisions: number
}

async function rankCandidates(): Promise<Candidate[]> {
  return (await query(
    `WITH w AS (SELECT * FROM ${INCIDENTS} WHERE ${WINDOW} AND coverage = 'mapped'),
     per_month AS (
       SELECT crime_head, station_code, fir_year, fir_month, count(*) n
       FROM w GROUP BY 1,2,3,4
     )
     SELECT w.crime_head,
            count(*)::INTEGER                                    AS row_count,
            sum(CASE WHEN map_pin_eligible THEN 1 ELSE 0 END)::INTEGER AS pin_eligible,
            count(DISTINCT w.station_code)::INTEGER              AS stations,
            count(DISTINCT w.police_division)::INTEGER           AS divisions,
            (SELECT max(n) FROM per_month p WHERE p.crime_head = w.crime_head)::INTEGER
                                                                 AS peak_station_month
     FROM w
     GROUP BY w.crime_head
     HAVING count(*) >= 2000
     ORDER BY row_count DESC
     LIMIT 15`,
  )) as unknown as Candidate[]
}

async function main(): Promise<void> {
  const geo = JSON.parse(await readFile(INPUT.jurisdictions, 'utf8')) as {
    features: StationFeature[]
  }
  const byName = new Map(
    geo.features.map((f) => [String(f.properties['station_name']).toLowerCase(), f]),
  )

  const units = DEMO_SPINE.stations.map((s) => `${s} PS`)
  const problems: string[] = []

  // ── Corridor volumes, inside the complete window ──────────────────────────
  const corridor = (await query(
    `SELECT unit_name, station_code, any_value(police_division) division,
            count(*)::INTEGER AS row_count,
            sum(CASE WHEN map_pin_eligible THEN 1 ELSE 0 END)::INTEGER pin_eligible
     FROM ${INCIDENTS}
     WHERE ${WINDOW} AND crime_head = '${DEMO_SPINE.crimeHead.replace(/'/g, "''")}'
       AND unit_name IN (${units.map((u) => `'${u.replace(/'/g, "''")}'`).join(', ')})
     GROUP BY 1, 2 ORDER BY row_count DESC`,
  )) as Array<{
    unit_name: string
    station_code: string
    division: string
    row_count: number
    pin_eligible: number
  }>

  for (const unit of units) {
    if (!corridor.some((c) => c.unit_name === unit)) {
      problems.push(`Corridor station '${unit}' has no rows for the spine crime head.`)
    }
  }

  // ── Boundary adjacency of consecutive pairs (§11.1's own method) ──────────
  const distances: Array<{ pair: string; km: number }> = []
  for (let i = 0; i < DEMO_SPINE.stations.length - 1; i++) {
    const a = resolveFeature(DEMO_SPINE.stations[i]!, byName, corridor)
    const b = resolveFeature(DEMO_SPINE.stations[i + 1]!, byName, corridor)
    if (!a || !b) {
      problems.push(
        `Cannot measure adjacency for ${DEMO_SPINE.stations[i]} ↔ ${DEMO_SPINE.stations[i + 1]}: polygon not found.`,
      )
      continue
    }
    const km = minBoundaryDistanceKm(a, b)
    distances.push({ pair: `${DEMO_SPINE.stations[i]} ↔ ${DEMO_SPINE.stations[i + 1]}`, km })
    if (km > 0.05) {
      problems.push(
        `${DEMO_SPINE.stations[i]} ↔ ${DEMO_SPINE.stations[i + 1]} are ${km.toFixed(3)} km apart — ` +
          `consecutive corridor stations must share a boundary.`,
      )
    }
  }

  // ── The division crossing is the whole "different jurisdictions" claim ────
  const divisions = [...new Set(corridor.map((c) => c.division).filter(Boolean))]
  if (divisions.length < 2) {
    problems.push(
      `Corridor sits in a single division (${divisions.join(', ')}) — the cross-jurisdiction claim fails.`,
    )
  }

  const candidates = await rankCandidates()
  const spineRank = candidates.findIndex((c) => c.crime_head === DEMO_SPINE.crimeHead)

  // ── Report ────────────────────────────────────────────────────────────────
  const total = corridor.reduce((s, c) => s + Number(c.row_count), 0)
  const pinTotal = corridor.reduce((s, c) => s + Number(c.pin_eligible), 0)

  await mkdir(OUTPUT.reports, { recursive: true })
  await writeFile(
    resolve(OUTPUT.reports, 'a3_demo_spine.md'),
    [
      '# Demo spine audit',
      '',
      `Generated ${new Date().toISOString()} · window ≤ ${ANALYSIS_CUTOFF}`,
      '',
      `**Spine:** \`${DEMO_SPINE.crimeGroup} / ${DEMO_SPINE.crimeHead}\``,
      `**Corridor:** ${DEMO_SPINE.stations.join(' → ')}`,
      '',
      problems.length === 0
        ? '✅ **Corridor confirmed.** All checks pass.'
        : `⚠️ **${problems.length} problem(s) found:**\n\n${problems.map((p) => `- ${p}`).join('\n')}`,
      '',
      '## Corridor volumes',
      '',
      '| Station | Division | FIRs | Pin-eligible |',
      '|---|---|---:|---:|',
      ...corridor.map(
        (c) =>
          `| ${c.unit_name} | ${c.division ?? '—'} | ${Number(c.row_count).toLocaleString()} | ` +
          `${Number(c.pin_eligible).toLocaleString()} (${((100 * Number(c.pin_eligible)) / Number(c.row_count)).toFixed(1)}%) |`,
      ),
      `| **Total** | ${divisions.join(' + ')} | **${total.toLocaleString()}** | **${pinTotal.toLocaleString()}** (${((100 * pinTotal) / total).toFixed(1)}%) |`,
      '',
      divisions.length >= 2
        ? `The corridor spans **${divisions.length} divisions** (${divisions.join(', ')}) — "these cases sat in ` +
          'different jurisdictions" is a fact, not staging.'
        : '',
      '',
      '## Boundary adjacency',
      '',
      'Minimum boundary distance between consecutive pairs, measured with Turf on the',
      'actual polygon geometry — not bounding boxes.',
      '',
      '| Pair | Distance (km) |',
      '|---|---:|',
      ...distances.map((d) => `| ${d.pair} | ${d.km.toFixed(3)} |`),
      '',
      '## Ranked alternates',
      '',
      'Every crime head with ≥2,000 mapped FIRs in the complete window. If the corridor',
      'ever weakens, replace the spine from this table rather than by hand.',
      '',
      spineRank >= 0
        ? `The current spine ranks **#${spineRank + 1}** by volume.`
        : '⚠️ The current spine does not appear in this table.',
      '',
      '| # | Crime head | FIRs | Pin-eligible | Stations | Divisions | Peak station-month |',
      '|---:|---|---:|---:|---:|---:|---:|',
      ...candidates.map(
        (c, i) =>
          `| ${i + 1} | ${c.crime_head === DEMO_SPINE.crimeHead ? `**${c.crime_head}**` : c.crime_head} | ` +
          `${Number(c.row_count).toLocaleString()} | ` +
          `${((100 * Number(c.pin_eligible)) / Number(c.row_count)).toFixed(1)}% | ` +
          `${c.stations} | ${c.divisions} | ${c.peak_station_month} |`,
      ),
      '',
      'A believable weekly spike needs a peak station-month well above single digits.',
      'The discarded chain-snatching spine peaked at 6.',
      '',
    ].join('\n'),
    'utf8',
  )

  process.stdout.write(
    `\nDemo spine audit — window ≤ ${ANALYSIS_CUTOFF}\n` +
      `  spine            ${DEMO_SPINE.crimeHead}\n` +
      `  corridor FIRs    ${total.toLocaleString()} across ${corridor.length} stations\n` +
      `  divisions        ${divisions.join(', ')}\n` +
      `  adjacency        ${distances.map((d) => d.km.toFixed(3)).join(' · ')} km\n` +
      `  volume rank      ${spineRank >= 0 ? `#${spineRank + 1}` : 'not ranked'}\n` +
      `  → reports/a3_demo_spine.md\n`,
  )

  if (problems.length > 0) {
    process.stdout.write(`\n  ⚠️  ${problems.length} problem(s):\n`)
    for (const p of problems) process.stdout.write(`    · ${p}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write('\n  ✅ Corridor confirmed.\n')
  }
}

/** Match a spine station name to its polygon, via the crosswalked station code. */
function resolveFeature(
  name: string,
  byName: ReadonlyMap<string, StationFeature>,
  corridor: ReadonlyArray<{ unit_name: string; station_code: string }>,
): StationFeature | undefined {
  const direct = byName.get(name.toLowerCase())
  if (direct) return direct
  const code = corridor.find((c) => c.unit_name === `${name} PS`)?.station_code
  if (!code) return undefined
  return [...byName.values()].find((f) => String(f.properties['station_code']) === code)
}

main().catch((error: unknown) => {
  process.stderr.write(`spine audit failed: ${String(error)}\n`)
  process.exitCode = 1
})
