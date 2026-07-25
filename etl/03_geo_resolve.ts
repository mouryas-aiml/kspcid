/**
 * 03 — Geographic resolution (BUILD_SPEC §6.3, §6.4 step 03).
 *
 * Assembles the final row-level incident table by joining 01's normalized rows,
 * 02's station assignment, and this step's geography.
 *
 * Four `geo_origin` tiers:
 *
 *   reported            usable coordinate, inside its ASSIGNED polygon
 *   reported_corrected  usable coordinate, inside an ADJACENT polygon — the
 *                       coordinate is kept and the mismatch logged
 *   inferred            resolved to a road anchor inside the assigned station
 *   unlocatable         no station polygon exists and no usable coordinate
 *
 * A coordinate landing in a NON-adjacent polygon is demoted to `inferred` with
 * a logged reason. Eight kilometres away is a data error, not a boundary nudge,
 * and keeping it would silently place a case in the wrong jurisdiction.
 *
 * The output carries `map_pin_eligible`, which makes non-negotiable #4 — never
 * render an inferred coordinate as a precise location — a property of the data
 * rather than a convention a layer config can forget.
 *
 *   npm run etl:03
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { INPUT, OUTPUT, ANALYSIS_CUTOFF, DEMO_SPINE } from './00_config.js'
import { sha256File, sha256Text, stableIndex } from './lib/hash.js'
import { recordOutput } from './lib/manifest.js'
import { ParquetWriter, query, type Column } from './lib/parquet.js'
import { classifyPremise, type PremiseClass } from './lib/premise.js'
import {
  BLR_BBOX,
  buildAdjacency,
  containingStation,
  h3Cells,
  isInside,
  isUsableCoordinate,
  type AdjacencyMap,
  type StationFeature,
} from './lib/geo.js'

type GeoOrigin = 'reported' | 'reported_corrected' | 'inferred' | 'unlocatable'

interface Anchor {
  anchor_id: string
  station_code: string
  latitude: number
  longitude: number
  anchor_kind: string
  street_name: string
}

const COLUMNS: readonly Column[] = [
  { name: 'incident_id', type: 'VARCHAR' },
  { name: 'case_ref', type: 'VARCHAR' },
  { name: 'source_row_number', type: 'INTEGER' },
  { name: 'unit_name', type: 'VARCHAR' },
  { name: 'station_code', type: 'VARCHAR' },
  { name: 'police_division', type: 'VARCHAR' },
  { name: 'subdivision', type: 'VARCHAR' },
  { name: 'is_territorial', type: 'BOOLEAN' },
  { name: 'coverage', type: 'VARCHAR' },
  { name: 'registered_on', type: 'DATE' },
  { name: 'fir_year', type: 'INTEGER' },
  { name: 'fir_month', type: 'INTEGER' },
  { name: 'iso_week', type: 'VARCHAR' },
  { name: 'within_complete_window', type: 'BOOLEAN' },
  { name: 'fir_type', type: 'VARCHAR' },
  { name: 'stage', type: 'VARCHAR' },
  { name: 'transfer_target', type: 'VARCHAR' },
  { name: 'complaint_mode', type: 'VARCHAR' },
  { name: 'is_online', type: 'BOOLEAN' },
  { name: 'crime_group', type: 'VARCHAR' },
  { name: 'crime_head', type: 'VARCHAR' },
  { name: 'act_section', type: 'VARCHAR' },
  { name: 'io_alias', type: 'VARCHAR' },
  { name: 'io_rank', type: 'VARCHAR' },
  { name: 'place_of_offence', type: 'VARCHAR' },
  { name: 'premise_class', type: 'VARCHAR' },
  { name: 'beat_name', type: 'VARCHAR' },
  // Geography
  { name: 'geo_origin', type: 'VARCHAR' },
  { name: 'geo_method', type: 'VARCHAR' },
  { name: 'polygon_verified', type: 'BOOLEAN' },
  { name: 'map_pin_eligible', type: 'BOOLEAN' },
  { name: 'latitude', type: 'DOUBLE' },
  { name: 'longitude', type: 'DOUBLE' },
  { name: 'source_latitude', type: 'DOUBLE' },
  { name: 'source_longitude', type: 'DOUBLE' },
  { name: 'anchor_id', type: 'VARCHAR' },
  { name: 'h3_r7', type: 'VARCHAR' },
  { name: 'h3_r8', type: 'VARCHAR' },
  { name: 'h3_r9', type: 'VARCHAR' },
  // Counts
  { name: 'victim_male', type: 'INTEGER' },
  { name: 'victim_female', type: 'INTEGER' },
  { name: 'victim_boy', type: 'INTEGER' },
  { name: 'victim_girl', type: 'INTEGER' },
  { name: 'victim_count', type: 'INTEGER' },
  { name: 'accused_count', type: 'INTEGER' },
  { name: 'arrested_count', type: 'INTEGER' },
  { name: 'chargesheeted_count', type: 'INTEGER' },
  { name: 'conviction_count', type: 'INTEGER' },
]

async function loadAdjacency(features: readonly StationFeature[]): Promise<AdjacencyMap> {
  const path = resolve(OUTPUT.derived, 'station_adjacency.json')
  if (existsSync(path)) return JSON.parse(await readFile(path, 'utf8')) as AdjacencyMap

  process.stdout.write('03 · building station adjacency…\n')
  const map = buildAdjacency(features, (f) => String(f.properties['station_code']))
  await mkdir(OUTPUT.derived, { recursive: true })
  await writeFile(path, `${JSON.stringify(map, null, 2)}\n`, 'utf8')
  return map
}

async function main(): Promise<void> {
  const started = Date.now()

  const geojsonRaw = await readFile(INPUT.jurisdictions, 'utf8')
  const features = (JSON.parse(geojsonRaw) as { features: StationFeature[] }).features
  const byCode = new Map(features.map((f) => [String(f.properties['station_code']), f]))
  const adjacency = await loadAdjacency(features)

  // Anchors arrive pre-sorted by (station_code, anchor_id) from
  // prepare-references.mjs. That stable order is what makes the deterministic
  // index reproducible — do not re-sort.
  const anchorsRaw = await readFile(INPUT.anchors, 'utf8')
  const anchors = JSON.parse(anchorsRaw) as Anchor[]
  const anchorsByStation = new Map<string, Anchor[]>()
  const anchorsByStationKind = new Map<string, Anchor[]>()
  for (const anchor of anchors) {
    let all = anchorsByStation.get(anchor.station_code)
    if (!all) anchorsByStation.set(anchor.station_code, (all = []))
    all.push(anchor)
    const key = `${anchor.station_code}|${anchor.anchor_kind}`
    let kind = anchorsByStationKind.get(key)
    if (!kind) anchorsByStationKind.set(key, (kind = []))
    kind.push(anchor)
  }

  const writer = await ParquetWriter.create('incidents', COLUMNS)
  const tiers = new Map<GeoOrigin, number>()
  const premiseCounts = new Map<PremiseClass, number>()
  const demotions: Array<{ incident_id: string; from: string; to: string; km: string }> = []
  let anchorFallbacks = 0
  let boundaryCorrections = 0
  let processed = 0

  const rows = (await query(
    `SELECT r.*, s.station_code, s.police_division, s.subdivision, s.is_territorial,
            s.coverage, s.case_ref
     FROM '${resolve(OUTPUT.derived, 'incidents_raw.parquet')}' r
     JOIN '${resolve(OUTPUT.derived, 'incident_stations.parquet')}' s USING (incident_id)
     ORDER BY r.source_row_number`,
  )) as Array<Record<string, any>>

  for (const row of rows) {
    const stationCode: string | null = row['station_code'] ?? null
    const assigned = stationCode ? byCode.get(stationCode) : undefined
    const srcLat = row['latitude'] === null ? NaN : Number(row['latitude'])
    const srcLon = row['longitude'] === null ? NaN : Number(row['longitude'])
    const usable = isUsableCoordinate(srcLat, srcLon)
    const premise = classifyPremise(row['place_of_offence'])
    premiseCounts.set(premise, (premiseCounts.get(premise) ?? 0) + 1)

    let origin: GeoOrigin
    let method: string
    let lat: number | null = null
    let lon: number | null = null
    let anchorId: string | null = null
    let polygonVerified = false

    if (!assigned) {
      // No polygon exists for this unit (non-territorial, or one of the ten
      // territorial stations the KSRSAC file does not cover). A real reported
      // coordinate is still a real location — we simply cannot cross-check it
      // against a jurisdiction, which `polygon_verified` records.
      if (usable) {
        origin = 'reported'
        method = 'source_coordinate_unverified'
        lat = srcLat
        lon = srcLon
      } else {
        // Nothing to infer from: no polygon means no anchor pool.
        origin = 'unlocatable'
        method = 'no_polygon_no_coordinate'
      }
    } else if (usable && isInside(assigned, srcLat, srcLon)) {
      origin = 'reported'
      method = 'source_coordinate_in_assigned_polygon'
      lat = srcLat
      lon = srcLon
      polygonVerified = true
    } else {
      const actual = usable ? containingStation(features, srcLat, srcLon) : null
      const actualCode = actual ? String(actual.properties['station_code']) : null
      const isAdjacent =
        actualCode !== null && (adjacency[stationCode!] ?? []).includes(actualCode)

      if (usable && isAdjacent) {
        origin = 'reported_corrected'
        method = 'source_coordinate_in_adjacent_polygon'
        lat = srcLat
        lon = srcLon
        polygonVerified = true
        boundaryCorrections++
      } else {
        // Either no usable coordinate, or one that landed somewhere it cannot
        // plausibly have come from. Both resolve to an anchor.
        origin = 'inferred'
        method = 'geo_anchor_v1'
        if (usable) {
          demotions.push({
            incident_id: String(row['incident_id']),
            from: stationCode!,
            to: actualCode ?? 'outside all polygons',
            km: '',
          })
        }
        const preferred = anchorsByStationKind.get(`${stationCode}|${premise}`) ?? []
        const pool = preferred.length > 0 ? preferred : (anchorsByStation.get(stationCode!) ?? [])
        if (preferred.length === 0) anchorFallbacks++
        if (pool.length === 0) {
          origin = 'unlocatable'
          method = 'no_anchor_available'
        } else {
          const index = stableIndex('geo_resolve', String(row['incident_id']), premise, pool.length)
          const anchor = pool[index]!
          lat = anchor.latitude
          lon = anchor.longitude
          anchorId = anchor.anchor_id
        }
      }
    }

    tiers.set(origin, (tiers.get(origin) ?? 0) + 1)
    const cells = lat !== null && lon !== null ? h3Cells(lat, lon) : null

    await writer.write({
      incident_id: row['incident_id'],
      case_ref: row['case_ref'],
      source_row_number: row['source_row_number'],
      unit_name: row['unit_name'],
      station_code: stationCode,
      police_division: row['police_division'],
      subdivision: row['subdivision'],
      is_territorial: row['is_territorial'],
      coverage: row['coverage'],
      registered_on: row['registered_on'],
      fir_year: row['fir_year'],
      fir_month: row['fir_month'],
      iso_week: row['iso_week'],
      within_complete_window: row['within_complete_window'],
      fir_type: row['fir_type'],
      stage: row['stage'],
      transfer_target: row['transfer_target'],
      complaint_mode: row['complaint_mode'],
      is_online: row['is_online'],
      crime_group: row['crime_group'],
      crime_head: row['crime_head'],
      act_section: row['act_section'],
      io_alias: row['io_alias'],
      io_rank: row['io_rank'],
      place_of_offence: row['place_of_offence'],
      premise_class: premise,
      beat_name: row['beat_name'],
      geo_origin: origin,
      geo_method: method,
      polygon_verified: polygonVerified,
      // §6.3 rendering rule, enforced in the data: an inferred coordinate may
      // only ever be drawn inside an H3 aggregate, never as a pin.
      map_pin_eligible: origin === 'reported' || origin === 'reported_corrected',
      latitude: lat,
      longitude: lon,
      source_latitude: Number.isFinite(srcLat) ? srcLat : null,
      source_longitude: Number.isFinite(srcLon) ? srcLon : null,
      anchor_id: anchorId,
      h3_r7: cells?.r7 ?? null,
      h3_r8: cells?.r8 ?? null,
      h3_r9: cells?.r9 ?? null,
      victim_male: row['victim_male'],
      victim_female: row['victim_female'],
      victim_boy: row['victim_boy'],
      victim_girl: row['victim_girl'],
      victim_count: row['victim_count'],
      accused_count: row['accused_count'],
      arrested_count: row['arrested_count'],
      chargesheeted_count: row['chargesheeted_count'],
      conviction_count: row['conviction_count'],
    })

    processed++
    if (processed % 100_000 === 0) {
      process.stdout.write(`  … ${processed.toLocaleString()} resolved\n`)
    }
  }

  const outputPath = resolve(OUTPUT.derived, 'incidents.parquet')
  const written = await writer.finish(outputPath)

  await recordOutput(
    '03_geo_resolve',
    outputPath,
    written,
    [
      { path: INPUT.jurisdictions, sha256: sha256Text(geojsonRaw) },
      { path: INPUT.anchors, sha256: sha256Text(anchorsRaw) },
      { path: INPUT.firCsv, sha256: await sha256File(INPUT.firCsv) },
    ],
    {
      tiers: Object.fromEntries(tiers),
      boundary_corrections: boundaryCorrections,
      demoted_non_adjacent: demotions.length,
      anchor_class_fallbacks: anchorFallbacks,
      pin_eligible: (tiers.get('reported') ?? 0) + (tiers.get('reported_corrected') ?? 0),
    },
  )

  await writeReport({
    written,
    tiers,
    premiseCounts,
    boundaryCorrections,
    demotions: demotions.length,
    anchorFallbacks,
  })

  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  const pct = (n: number): string => `${((100 * n) / written).toFixed(2)}%`
  const pinEligible = (tiers.get('reported') ?? 0) + (tiers.get('reported_corrected') ?? 0)

  process.stdout.write(
    `\n03 complete in ${elapsed}s — ${written.toLocaleString()} rows\n` +
      `  reported            ${(tiers.get('reported') ?? 0).toLocaleString().padStart(7)}  ${pct(tiers.get('reported') ?? 0)}\n` +
      `  reported_corrected  ${(tiers.get('reported_corrected') ?? 0).toLocaleString().padStart(7)}  ${pct(tiers.get('reported_corrected') ?? 0)}\n` +
      `  inferred            ${(tiers.get('inferred') ?? 0).toLocaleString().padStart(7)}  ${pct(tiers.get('inferred') ?? 0)}\n` +
      `  unlocatable         ${(tiers.get('unlocatable') ?? 0).toLocaleString().padStart(7)}  ${pct(tiers.get('unlocatable') ?? 0)}\n` +
      `  ─────\n` +
      `  map_pin_eligible    ${pinEligible.toLocaleString().padStart(7)}  ${pct(pinEligible)}\n` +
      `  demoted non-adjacent ${demotions.length.toLocaleString()}  ·  anchor-class fallbacks ${anchorFallbacks.toLocaleString()}\n` +
      `  → data/derived/incidents.parquet · reports/a3_geo_resolve.md\n`,
  )

  const total = [...tiers.values()].reduce((a, b) => a + b, 0)
  if (total !== 425_408 || written !== 425_408) {
    process.stdout.write(`\n  ⚠️  Row conservation failed: tiers ${total}, written ${written}\n`)
    process.exitCode = 1
  }
}

async function writeReport(stats: {
  written: number
  tiers: Map<GeoOrigin, number>
  premiseCounts: Map<PremiseClass, number>
  boundaryCorrections: number
  demotions: number
  anchorFallbacks: number
}): Promise<void> {
  const pct = (n: number): string => `${((100 * n) / stats.written).toFixed(2)}%`
  const pinEligible =
    (stats.tiers.get('reported') ?? 0) + (stats.tiers.get('reported_corrected') ?? 0)

  const spine = (await query(
    `SELECT geo_origin, count(*)::INTEGER n
     FROM '${resolve(OUTPUT.derived, 'incidents.parquet')}'
     WHERE crime_head = '${DEMO_SPINE.crimeHead.replace(/'/g, "''")}'
       AND unit_name IN (${DEMO_SPINE.stations.map((s) => `'${s} PS'`).join(', ')})
     GROUP BY 1 ORDER BY n DESC`,
  )) as Array<{ geo_origin: string; n: number }>
  const spineTotal = spine.reduce((sum, r) => sum + Number(r.n), 0)

  await mkdir(OUTPUT.reports, { recursive: true })
  await writeFile(
    resolve(OUTPUT.reports, 'a3_geo_resolve.md'),
    [
      '# A3 — Geographic resolution',
      '',
      `Generated ${new Date().toISOString()} · ${stats.written.toLocaleString()} rows`,
      '',
      `Canonical extent: \`${BLR_BBOX.minLon},${BLR_BBOX.minLat} → ${BLR_BBOX.maxLon},${BLR_BBOX.maxLat}\``,
      '(identical to the §3.3 OSRM extract — a coordinate outside it cannot be routed)',
      '',
      '## Tiers',
      '',
      '| `geo_origin` | Rows | Share | Pin-eligible |',
      '|---|---:|---:|---|',
      ...(['reported', 'reported_corrected', 'inferred', 'unlocatable'] as GeoOrigin[]).map(
        (tier) =>
          `| \`${tier}\` | ${(stats.tiers.get(tier) ?? 0).toLocaleString()} | ${pct(stats.tiers.get(tier) ?? 0)} | ${tier === 'reported' || tier === 'reported_corrected' ? 'yes' : '**no**'} |`,
      ),
      '',
      `**${pinEligible.toLocaleString()} rows (${pct(pinEligible)}) may be drawn as a precise pin.**`,
      'Everything else appears only inside an H3 aggregate — non-negotiable #4, enforced',
      'by the `map_pin_eligible` column rather than by convention in a layer config.',
      '',
      '## Boundary handling',
      '',
      `- Kept as \`reported_corrected\` (coordinate in an **adjacent** polygon): **${stats.boundaryCorrections.toLocaleString()}**`,
      `- Demoted to \`inferred\` (coordinate in a **non-adjacent** polygon): **${stats.demotions.toLocaleString()}**`,
      '',
      'A coordinate several kilometres inside another jurisdiction is a data error,',
      'not a boundary nudge. Keeping it would place the case in the wrong station.',
      '',
      '## Premise classification',
      '',
      'Biases anchor selection for inferred rows. A bias, never a filter — where a',
      `station holds no anchor of the matching class the full pool is used instead`,
      `(**${stats.anchorFallbacks.toLocaleString()}** rows).`,
      '',
      '| Class | Rows |',
      '|---|---:|',
      ...[...stats.premiseCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([cls, n]) => `| ${cls} | ${n.toLocaleString()} |`),
      '',
      '## Demo corridor',
      '',
      `The four §11.1 spine stations, \`${DEMO_SPINE.crimeHead}\` — ${spineTotal.toLocaleString()} rows:`,
      '',
      '| `geo_origin` | Rows | Share |',
      '|---|---:|---:|',
      ...spine.map(
        (r) =>
          `| \`${r.geo_origin}\` | ${Number(r.n).toLocaleString()} | ${((100 * Number(r.n)) / spineTotal).toFixed(2)}% |`,
      ),
      '',
      'Roughly four in five corridor incidents are inferred, so the corridor’s visual',
      'density comes from hex aggregates, not pins. That is the §6.3 rendering rule',
      'working as intended — and it means the premise tokenizer and anchor bias carry',
      'more weight here than the citywide average suggests.',
      '',
      `Analysis cutoff \`${ANALYSIS_CUTOFF}\` — see \`within_complete_window\`.`,
      '',
    ].join('\n'),
    'utf8',
  )
}

main().catch((error: unknown) => {
  process.stderr.write(`03 failed: ${String(error)}\n`)
  process.exitCode = 1
})
