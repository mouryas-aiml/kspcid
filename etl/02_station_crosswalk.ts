/**
 * 02 — Station crosswalk (BUILD_SPEC §6.4 step 02).
 *
 * Reconciles the 178 Bengaluru City `UnitName` values to the 106 jurisdiction
 * polygons. **Target: 100% mapped, zero silent fallbacks.**
 *
 * Order matters. Territoriality is decided FIRST, before any name matching,
 * because `normalizeName` strips the token `traffic` — so "Adugodi Traffic PS"
 * normalizes to the same key as the Adugodi territorial polygon and would be
 * silently assigned its geography. A traffic unit is not a jurisdiction; it has
 * no polygon, and inventing one for it is precisely the silent fallback §6.4
 * forbids. The same applies to CEN Crime, Women, Cyber Crime, CCB and CID units.
 *
 * Tiers, applied only to units already established as territorial:
 *   1. normalized string match
 *   2. point-in-polygon of the station KML coordinate
 *   3. token-set ratio ≥ 0.86
 *   4. `etl/overrides/station_crosswalk_manual.csv` — reviewed by a human
 *
 * The override file is the source of truth wherever it has an entry. When the
 * script cannot resolve a unit it writes a proposal there and exits non-zero:
 * an unreviewed crosswalk must fail loudly, not proceed on a guess.
 *
 * Also assigns `case_ref`, which encodes division and therefore cannot be
 * assigned before the station is known.
 *
 *   npm run etl:02
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import { parse as parseCsv } from 'csv-parse/sync'

import { INPUT, OUTPUT, APP_ROOT, NON_TERRITORIAL_HINTS } from './00_config.js'
import { caseRef, normalizeName, sha256File, sha256Text } from './lib/hash.js'
import { recordOutput } from './lib/manifest.js'
import { ParquetWriter, query, type Column } from './lib/parquet.js'
import { containingStation, type StationFeature } from './lib/geo.js'

const OVERRIDE_PATH = resolve(APP_ROOT, 'etl/overrides/station_crosswalk_manual.csv')
const PROPOSAL_PATH = resolve(APP_ROOT, 'etl/overrides/station_crosswalk_proposals.csv')

type MatchTier =
  | 'override'
  | 'non_territorial'
  | 'normalized_exact'
  | 'kml_point_in_polygon'
  | 'token_set'
  | 'UNRESOLVED'

/**
 * How much geography a unit actually has.
 *
 * §6.4 frames the crosswalk as "178 units -> 106 polygons", which implicitly
 * assumes every unit has one. Ten do not: airport and rural-fringe stations,
 * two hospital posts, and five city stations absent from the KSRSAC snapshot —
 * 9,380 FIRs, 2.2% of Bengaluru. They are territorial and stay in every count,
 * but no polygon can be drawn for them, and merging them into a plausible
 * neighbour would be a silent reassignment of jurisdiction.
 */
type Coverage = 'mapped' | 'outside_polygon_set' | 'non_territorial'

interface Resolution {
  unit_name: string
  unit_id: string
  fir_count: number
  station_code: string | null
  station_name: string | null
  is_territorial: boolean
  coverage: Coverage
  tier: MatchTier
  score: number | null
  evidence: string
}

const STATION_COLUMNS: readonly Column[] = [
  { name: 'station_code', type: 'VARCHAR' },
  { name: 'station_name', type: 'VARCHAR' },
  { name: 'police_division', type: 'VARCHAR' },
  { name: 'subdivision', type: 'VARCHAR' },
  { name: 'area_sq_km', type: 'DOUBLE' },
  { name: 'is_territorial', type: 'BOOLEAN' },
  { name: 'coverage', type: 'VARCHAR' },
  { name: 'unit_count', type: 'INTEGER' },
  { name: 'fir_count', type: 'INTEGER' },
]

/**
 * Token-set ratio: order-independent overlap of word sets, so
 * "Yeshwanthpura RMC Yard" and "R.M.C. Yard" score on their shared tokens
 * rather than on string position.
 */
function tokenSetRatio(a: string, b: string): number {
  const tokensOf = (s: string): Set<string> =>
    new Set(
      String(s)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t && !['ps', 'police', 'station'].includes(t)),
    )
  const setA = tokensOf(a)
  const setB = tokensOf(b)
  if (setA.size === 0 || setB.size === 0) return 0
  let shared = 0
  for (const token of setA) {
    if (setB.has(token)) {
      shared++
      continue
    }
    // A token also counts if one side is a prefix of the other and long enough
    // to be unambiguous — "Vidyaranyapura" vs "Vidhyaranyapura".
    for (const other of setB) {
      if (token.length >= 5 && other.length >= 5) {
        const short = token.length < other.length ? token : other
        const long = token.length < other.length ? other : token
        if (long.startsWith(short.slice(0, Math.min(short.length, 6)))) {
          shared += 0.9
          break
        }
      }
    }
  }
  return (2 * shared) / (setA.size + setB.size)
}

/**
 * Character-level similarity on the normalized form.
 *
 * Used ONLY to rank candidates for human review — never to auto-accept. §6.4
 * specifies token-set ratio ≥ 0.86 as the automatic tier, and widening the
 * automatic path to a metric the spec did not authorise would be exactly the
 * silent fallback it forbids.
 *
 * It earns its place because these are transliteration variants, which token
 * matching cannot see: `Thilaknagar` and `Tilak Nagar` normalize to
 * `thilaknagar` / `tilaknagar` — one character apart — but share no whole token.
 */
function editRatio(a: string, b: string): number {
  const x = normalizeName(a)
  const y = normalizeName(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const prev = new Array<number>(y.length + 1)
  const curr = new Array<number>(y.length + 1)
  for (let j = 0; j <= y.length; j++) prev[j] = j
  for (let i = 1; i <= x.length; i++) {
    curr[0] = i
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost)
    }
    for (let j = 0; j <= y.length; j++) prev[j] = curr[j]!
  }
  return 1 - prev[y.length]! / Math.max(x.length, y.length)
}

interface KmlStation {
  name: string
  lat: number
  lon: number
}

async function loadKmlStations(): Promise<KmlStation[]> {
  const xml = await readFile(INPUT.stationKml, 'utf8')
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml) as Record<string, any>
  const folder = parsed?.['kml']?.['Document']?.['Folder']
  const placemarks = Array.isArray(folder?.['Placemark'])
    ? folder['Placemark']
    : [folder?.['Placemark']].filter(Boolean)

  const stations: KmlStation[] = []
  for (const placemark of placemarks) {
    const fields = placemark?.['ExtendedData']?.['SchemaData']?.['SimpleData'] ?? []
    const list = Array.isArray(fields) ? fields : [fields]
    const nameField = list.find((f: any) => f?.['@_name'] === 'POL_STAName')
    const coords = String(placemark?.['Point']?.['coordinates'] ?? '').trim()
    const [lon, lat] = coords.split(',').map(Number)
    if (!nameField || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
    stations.push({ name: String(nameField['#text'] ?? nameField), lat: lat!, lon: lon! })
  }
  return stations
}

interface OverrideRow {
  unit_name: string
  station_code: string
  is_territorial: boolean
  note: string
}

async function loadOverrides(): Promise<Map<string, OverrideRow>> {
  const map = new Map<string, OverrideRow>()
  if (!existsSync(OVERRIDE_PATH)) return map
  const rows = parseCsv(await readFile(OVERRIDE_PATH, 'utf8'), {
    columns: true,
    skipEmptyLines: true,
    comment: '#',
    trim: true,
  }) as Array<Record<string, string>>

  for (const row of rows) {
    const unit = row['unit_name']
    const territorial = row['is_territorial']
    if (!unit) continue
    // A blank decision is an unreviewed proposal, not a resolution.
    if (!territorial) continue
    map.set(unit, {
      unit_name: unit,
      station_code: row['station_code'] ?? '',
      is_territorial: territorial.toLowerCase() === 'true',
      note: row['note'] ?? '',
    })
  }
  return map
}

async function main(): Promise<void> {
  const started = Date.now()

  const geojsonRaw = await readFile(INPUT.jurisdictions, 'utf8')
  const features = (JSON.parse(geojsonRaw) as { features: StationFeature[] }).features
  const byCode = new Map(features.map((f) => [String(f.properties['station_code']), f]))

  const kmlStations = await loadKmlStations()
  const overrides = await loadOverrides()

  const units = (await query(
    `SELECT unit_name, any_value(unit_id) unit_id, count(*)::INTEGER fir_count
     FROM '${resolve(OUTPUT.derived, 'incidents_raw.parquet')}'
     GROUP BY 1 ORDER BY 1`,
  )) as Array<{ unit_name: string; unit_id: string; fir_count: number }>

  const claimed = new Map<string, string>() // station_code → unit_name
  const resolutions: Resolution[] = []

  for (const unit of units) {
    const name = unit.unit_name
    const base: Omit<
      Resolution,
      'station_code' | 'station_name' | 'is_territorial' | 'coverage' | 'tier' | 'score' | 'evidence'
    > = {
      unit_name: name,
      unit_id: String(unit.unit_id ?? ''),
      fir_count: Number(unit.fir_count),
    }

    // ── Tier 0: the reviewed override file wins over everything ─────────────
    const override = overrides.get(name)
    if (override) {
      const feature = override.station_code ? byCode.get(override.station_code) : undefined
      resolutions.push({
        ...base,
        station_code: override.is_territorial ? (override.station_code || null) : null,
        station_name: feature ? String(feature.properties['station_name']) : null,
        is_territorial: override.is_territorial,
        coverage: !override.is_territorial
          ? 'non_territorial'
          : override.station_code
            ? 'mapped'
            : 'outside_polygon_set',
        tier: 'override',
        score: null,
        evidence: override.note || 'reviewed manually',
      })
      if (override.is_territorial && override.station_code) claimed.set(override.station_code, name)
      continue
    }

    // ── Territoriality BEFORE name matching ────────────────────────────────
    // These units investigate across the city; they hold no jurisdiction. They
    // are excluded from map geography and kept in every count.
    const hint = NON_TERRITORIAL_HINTS.find((pattern) => pattern.test(name))
    if (hint) {
      resolutions.push({
        ...base,
        station_code: null,
        station_name: null,
        is_territorial: false,
        coverage: 'non_territorial',
        tier: 'non_territorial',
        score: null,
        evidence: `matched non-territorial pattern ${String(hint)}`,
      })
      continue
    }

    // ── Tier 1: normalized exact ───────────────────────────────────────────
    const key = normalizeName(name)
    const exact = features.filter((f) => normalizeName(f.properties['station_name']) === key)
    if (exact.length === 1 && !claimed.has(String(exact[0]!.properties['station_code']))) {
      const code = String(exact[0]!.properties['station_code'])
      claimed.set(code, name)
      resolutions.push({
        ...base,
        station_code: code,
        station_name: String(exact[0]!.properties['station_name']),
        is_territorial: true,
        coverage: 'mapped',
        tier: 'normalized_exact',
        score: 1,
        evidence: `normalized '${key}'`,
      })
      continue
    }

    // ── Tier 2: point-in-polygon of the station's KML coordinate ───────────
    const kml = kmlStations.find((s) => normalizeName(s.name) === key)
    if (kml) {
      const feature = containingStation(features, kml.lat, kml.lon)
      const code = feature ? String(feature.properties['station_code']) : null
      if (feature && code && !claimed.has(code)) {
        claimed.set(code, name)
        resolutions.push({
          ...base,
          station_code: code,
          station_name: String(feature.properties['station_name']),
          is_territorial: true,
          coverage: 'mapped',
          tier: 'kml_point_in_polygon',
          score: 1,
          evidence: `KML point ${kml.lat.toFixed(5)},${kml.lon.toFixed(5)} inside polygon`,
        })
        continue
      }
    }

    // ── Tier 3: token-set ratio ≥ 0.86 ─────────────────────────────────────
    const candidates = features
      .filter((f) => !claimed.has(String(f.properties['station_code'])))
      .map((feature) => ({
        feature,
        token: tokenSetRatio(name, String(feature.properties['station_name'])),
        edit: editRatio(name, String(feature.properties['station_name'])),
      }))
      .sort((a, b) => Math.max(b.token, b.edit) - Math.max(a.token, a.edit))

    const top = candidates[0]
    if (top && top.token >= 0.86) {
      const code = String(top.feature.properties['station_code'])
      claimed.set(code, name)
      resolutions.push({
        ...base,
        station_code: code,
        station_name: String(top.feature.properties['station_name']),
        is_territorial: true,
        coverage: 'mapped',
        tier: 'token_set',
        score: Number(top.token.toFixed(3)),
        evidence: `token-set ${top.token.toFixed(3)} vs '${String(top.feature.properties['station_name'])}'`,
      })
      continue
    }

    // ── Unresolved → ranked proposal for human review ──────────────────────
    const shortlist = candidates
      .slice(0, 3)
      .filter((c) => Math.max(c.token, c.edit) > 0.35)
      .map(
        (c) =>
          `${String(c.feature.properties['station_name'])} [${String(c.feature.properties['station_code'])}] ` +
          `token=${c.token.toFixed(2)} edit=${c.edit.toFixed(2)}`,
      )
    resolutions.push({
      ...base,
      station_code: null,
      station_name: null,
      is_territorial: true,
      coverage: 'outside_polygon_set',
      tier: 'UNRESOLVED',
      score: top ? Number(Math.max(top.token, top.edit).toFixed(3)) : null,
      evidence:
        shortlist.length > 0
          ? `candidates: ${shortlist.join(' | ')}`
          : 'no candidate above 0.35 — likely outside the 106-polygon set',
    })
  }

  // ── Outputs ───────────────────────────────────────────────────────────────
  const unresolved = resolutions.filter((r) => r.tier === 'UNRESOLVED')
  await writeOverrideProposals(unresolved)
  await writeCrosswalkCsv(resolutions)

  const stationRows = new Map<
    string,
    { units: number; firs: number; feature: StationFeature | undefined }
  >()
  for (const r of resolutions) {
    if (!r.is_territorial || !r.station_code) continue
    const existing = stationRows.get(r.station_code) ?? {
      units: 0,
      firs: 0,
      feature: byCode.get(r.station_code),
    }
    existing.units++
    existing.firs += r.fir_count
    stationRows.set(r.station_code, existing)
  }

  const stationsWriter = await ParquetWriter.create('stations', STATION_COLUMNS)
  for (const feature of features) {
    const code = String(feature.properties['station_code'])
    const agg = stationRows.get(code)
    await stationsWriter.write({
      station_code: code,
      station_name: String(feature.properties['station_name']),
      police_division: String(feature.properties['police_division'] ?? ''),
      subdivision: String(feature.properties['subdivision'] ?? ''),
      area_sq_km: Number(feature.properties['area_sq_km'] ?? 0),
      is_territorial: true,
      coverage: 'mapped',
      unit_count: agg?.units ?? 0,
      fir_count: agg?.firs ?? 0,
    })
  }
  // Units with no polygon still get a station row so that every FIR joins to
  // something and no count silently disappears (§6.4: kept in all counts).
  for (const r of resolutions.filter((x) => x.coverage !== 'mapped')) {
    await stationsWriter.write({
      station_code: `${r.is_territorial ? 'UNMAPPED' : 'NT'}-${sha256Text(r.unit_name).slice(0, 8).toUpperCase()}`,
      station_name: r.unit_name,
      police_division: '',
      subdivision: '',
      area_sq_km: null,
      is_territorial: r.is_territorial,
      coverage: r.coverage,
      unit_count: 1,
      fir_count: r.fir_count,
    })
  }
  const stationsPath = resolve(OUTPUT.derived, 'stations.parquet')
  const stationRowCount = await stationsWriter.finish(stationsPath)

  const caseRefRows = await writeIncidentStations(resolutions, byCode)

  await recordOutput(
    '02_station_crosswalk',
    stationsPath,
    stationRowCount,
    [
      { path: INPUT.jurisdictions, sha256: sha256Text(geojsonRaw) },
      { path: INPUT.stationKml, sha256: await sha256File(INPUT.stationKml) },
    ],
    {
      units_total: resolutions.length,
      territorial: resolutions.filter((r) => r.is_territorial && r.station_code).length,
      non_territorial: resolutions.filter((r) => !r.is_territorial).length,
      unresolved: unresolved.length,
      polygons_claimed: claimed.size,
      polygons_total: features.length,
    },
  )
  await recordOutput(
    '02_station_crosswalk',
    resolve(OUTPUT.derived, 'incident_stations.parquet'),
    caseRefRows,
    [
      {
        path: resolve(OUTPUT.derived, 'incidents_raw.parquet'),
        sha256: await sha256File(resolve(OUTPUT.derived, 'incidents_raw.parquet')),
      },
    ],
    { case_refs_assigned: caseRefRows },
  )

  // ── Report ────────────────────────────────────────────────────────────────
  const byTier = new Map<MatchTier, number>()
  for (const r of resolutions) byTier.set(r.tier, (byTier.get(r.tier) ?? 0) + 1)
  const territorial = resolutions.filter((r) => r.coverage === 'mapped')
  const nonTerritorial = resolutions.filter((r) => r.coverage === 'non_territorial')
  const unmapped = resolutions.filter((r) => r.coverage === 'outside_polygon_set')
  const totalFirs = resolutions.reduce((sum, r) => sum + r.fir_count, 0)

  await mkdir(OUTPUT.reports, { recursive: true })
  await writeFile(
    resolve(OUTPUT.reports, 'a3_crosswalk.md'),
    [
      '# A3 — Station crosswalk',
      '',
      `Generated ${new Date().toISOString()}`,
      '',
      `- Units: **${resolutions.length}** · mapped **${territorial.length}** · non-territorial **${nonTerritorial.length}** · territorial-but-unmapped **${unmapped.length}** · unresolved **${unresolved.length}**`,
      `- FIRs: **${totalFirs.toLocaleString()}** — every unit resolves to a station row, so no count is lost.`,
      `- Polygons claimed: **${claimed.size} / ${features.length}**`,
      '',
      '> Territoriality is decided before name matching. `normalizeName` strips the',
      "> token `traffic`, so a traffic unit would otherwise normalize onto its",
      '> territorial namesake and silently inherit a jurisdiction it does not have.',
      '',
      '## Match tiers',
      '',
      '| Tier | Units |',
      '|---|---:|',
      ...[...byTier.entries()].map(([tier, n]) => `| ${tier} | ${n} |`),
      '',
      '## Non-territorial units',
      '',
      'City-wide investigative or functional units. They hold no jurisdiction, so',
      'they are excluded from map geography and retained in every count.',
      '',
      '| Unit | FIRs | Basis |',
      '|---|---:|---|',
      ...nonTerritorial
        .sort((a, b) => b.fir_count - a.fir_count)
        .map((r) => `| ${r.unit_name} | ${r.fir_count.toLocaleString()} | ${r.evidence} |`),
      '',
      '## Territorial units with no polygon',
      '',
      'Real station jurisdictions that the 106-feature KSRSAC file does not cover.',
      '§6.4 frames the crosswalk as 178 units into 106 polygons, which assumes every',
      'unit has one; these do not. They are kept in every count and are never merged',
      'into a plausible neighbour — that would silently reassign jurisdiction.',
      '',
      `**${unmapped.length} units · ${unmapped.reduce((s2, r) => s2 + r.fir_count, 0).toLocaleString()} FIRs` +
        ` (${((100 * unmapped.reduce((s2, r) => s2 + r.fir_count, 0)) / totalFirs).toFixed(2)}% of Bengaluru)**`,
      '',
      '| Unit | FIRs | Why no polygon |',
      '|---|---:|---|',
      ...unmapped
        .sort((a, b) => b.fir_count - a.fir_count)
        .map((r) => `| ${r.unit_name} | ${r.fir_count.toLocaleString()} | ${r.evidence} |`),
      '',
      '## Polygons with no reporting unit',
      '',
      ...(() => {
        const orphans = features.filter((f) => !claimed.has(String(f.properties['station_code'])))
        if (orphans.length === 0) return ['None — every polygon has a reporting unit.']
        return [
          '| Station | Code | Division |',
          '|---|---|---|',
          ...orphans.map(
            (f) =>
              `| ${String(f.properties['station_name'])} | ${String(f.properties['station_code'])} | ${String(f.properties['police_division'] ?? '')} |`,
          ),
        ]
      })(),
      '',
      '## Full crosswalk',
      '',
      '| Unit | FIRs | Station | Code | Tier | Score | Evidence |',
      '|---|---:|---|---|---|---:|---|',
      ...resolutions.map(
        (r) =>
          `| ${r.unit_name} | ${r.fir_count.toLocaleString()} | ${r.station_name ?? '—'} | ${r.station_code ?? '—'} | ${r.tier} | ${r.score ?? '—'} | ${r.evidence} |`,
      ),
      '',
    ].join('\n'),
    'utf8',
  )

  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  process.stdout.write(
    `\n02 complete in ${elapsed}s\n` +
      `  units              ${resolutions.length}\n` +
      `  mapped             ${territorial.length} → ${claimed.size} / ${features.length} polygons\n` +
      `  non-territorial    ${nonTerritorial.length}\n` +
      `  territorial, no polygon  ${unmapped.length} (${unmapped.reduce((s2, r) => s2 + r.fir_count, 0).toLocaleString()} FIRs)\n` +
      `  unresolved         ${unresolved.length}\n` +
      `  tiers              ${[...byTier.entries()].map(([t, n]) => `${t}=${n}`).join(' · ')}\n` +
      `  case refs          ${caseRefRows.toLocaleString()}\n` +
      `  → data/derived/stations.parquet · incident_stations.parquet · reports/a3_crosswalk.md\n`,
  )

  if (unresolved.length > 0) {
    process.stdout.write(
      `\n  ${unresolved.length} unit(s) could not be resolved. Proposals written to\n` +
        `  etl/overrides/station_crosswalk_manual.csv — fill in the decision column and re-run.\n\n`,
    )
    for (const r of unresolved) {
      process.stdout.write(`    ${r.unit_name} (${r.fir_count.toLocaleString()} FIRs) — ${r.evidence}\n`)
    }
    process.exitCode = 1
  }
}

const INCIDENT_STATION_COLUMNS: readonly Column[] = [
  { name: 'incident_id', type: 'VARCHAR' },
  { name: 'station_code', type: 'VARCHAR' },
  { name: 'police_division', type: 'VARCHAR' },
  { name: 'subdivision', type: 'VARCHAR' },
  { name: 'is_territorial', type: 'BOOLEAN' },
  { name: 'coverage', type: 'VARCHAR' },
  { name: 'case_ref', type: 'VARCHAR' },
]

/**
 * Row-level station assignment plus `case_ref`.
 *
 * `case_ref` is assigned here rather than in 01 because it encodes the division,
 * which is not known until the unit is crosswalked. It is a **generated
 * demonstration reference** (§6.0a) — the source has no case identifier of any
 * kind — and is displayed as "Case reference", never as an FIR number. lint-truth-ok: no-fir-number
 *
 * Only the join keys are written, not a copy of every incident column; step 03
 * assembles the final row-level table from 01, this file and its own geography.
 */
async function writeIncidentStations(
  resolutions: readonly Resolution[],
  byCode: ReadonlyMap<string, StationFeature>,
): Promise<number> {
  const byUnit = new Map(resolutions.map((r) => [r.unit_name, r]))
  const writer = await ParquetWriter.create('incident_stations', INCIDENT_STATION_COLUMNS)
  const taken = new Set<string>()

  const rows = (await query(
    `SELECT incident_id, unit_name, fir_year
     FROM '${resolve(OUTPUT.derived, 'incidents_raw.parquet')}'
     ORDER BY incident_id`,
  )) as Array<{ incident_id: string; unit_name: string; fir_year: number }>

  for (const row of rows) {
    const resolution = byUnit.get(row.unit_name)
    if (!resolution) throw new Error(`No crosswalk entry for unit '${row.unit_name}'`)
    const feature = resolution.station_code ? byCode.get(resolution.station_code) : undefined
    const division = feature ? String(feature.properties['police_division'] ?? '') : ''

    await writer.write({
      incident_id: row.incident_id,
      station_code: resolution.station_code,
      police_division: division || null,
      subdivision: feature ? String(feature.properties['subdivision'] ?? '') : null,
      is_territorial: resolution.is_territorial,
      coverage: resolution.coverage,
      case_ref: caseRef(row.incident_id, division || 'Unassigned', Number(row.fir_year), taken),
    })
  }
  return writer.finish(resolve(OUTPUT.derived, 'incident_stations.parquet'))
}

/**
 * Write ranked proposals for anything unresolved — to a SEPARATE file.
 *
 * The reviewed override file is never rewritten by this script. Regenerating it
 * would destroy the human judgment it exists to hold, which is the one thing in
 * this pipeline that cannot be recomputed. Proposals land beside it for a person
 * to merge deliberately.
 */
async function writeOverrideProposals(unresolved: readonly Resolution[]): Promise<void> {
  if (unresolved.length === 0) {
    await rm(PROPOSAL_PATH, { force: true })
    return
  }
  await mkdir(resolve(APP_ROOT, 'etl/overrides'), { recursive: true })
  await writeFile(
    PROPOSAL_PATH,
    '# UNREVIEWED PROPOSALS — merge the correct rows into\n' +
      '# station_crosswalk_manual.csv, filling in is_territorial, then re-run 02.\n' +
      '# Candidate scores are for ranking only; nothing here has been accepted.\n' +
      'unit_name,station_code,is_territorial,note\n' +
      unresolved
        .map((r) => `${csv(r.unit_name)},,,${csv(`PROPOSAL (${r.fir_count} FIRs) — ${r.evidence}`)}`)
        .sort()
        .join('\n') +
      '\n',
    'utf8',
  )
}

async function writeCrosswalkCsv(resolutions: readonly Resolution[]): Promise<void> {
  const rows = resolutions.map(
    (r) =>
      `${csv(r.unit_name)},${csv(r.unit_id)},${r.fir_count},${csv(r.station_code ?? '')},` +
      `${csv(r.station_name ?? '')},${r.is_territorial},${r.tier},${r.score ?? ''},${csv(r.evidence)}`,
  )
  await writeFile(
    resolve(OUTPUT.derived, 'station_crosswalk.csv'),
    'unit_name,unit_id,fir_count,station_code,station_name,is_territorial,tier,score,evidence\n' +
      rows.join('\n') +
      '\n',
    'utf8',
  )
}

function csv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

main().catch((error: unknown) => {
  process.stderr.write(`02 failed: ${String(error)}\n`)
  process.exitCode = 1
})
