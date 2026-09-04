/** Compile the statewide district outlook used by `/state/` and Catalyst. */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import ExcelJS from 'exceljs'
import { area, centroid, cleanCoords, simplify } from '@turf/turf'
import { parse } from 'csv-parse/sync'

import { ANALYSIS_CUTOFF, APP_ROOT, INPUT, OUTPUT } from './00_config.js'
import { dispersion, negativeBinomialQuantile } from './lib/count_limits.js'
import { sha256File } from './lib/hash.js'
import { recordOutput } from './lib/manifest.js'

type Mapping = { source_district: string; administrative_district: string; classification: 'territorial' | 'special' }
type RawWeek = { source_district: string; police_unit: string; crime_group: string; week_start: string; registrations: bigint | number }
type Context = { population: number; urban: number; area_sq_km: number }
type SeriesPoint = { week: string; value: number }

const CROSSWALK = resolve(APP_ROOT, 'etl/overrides/state_district_crosswalk.csv')
const CENSUS = resolve(APP_ROOT, 'Data_Docs/official/census/pca_2011/DDW_PCA0000_2011_Indiastatedist.xlsx')
const GEOMETRY_SOURCE = resolve(APP_ROOT, 'Data_Docs/official/bharatmaps/karnataka_districts/districts-2017.geojson')
const GEOJSON_OUT = resolve(APP_ROOT, 'reference/processed/karnataka_districts.geojson')
const JSON_OUT = resolve(OUTPUT.scenarios, 'state_intelligence.json')
const CSV_OUT = resolve(OUTPUT.derived, 'state_district_outlook.csv')
const START = '2018-01-01'
const FIRST_PUBLISHED = '2019-01-07'
const LAST_PUBLISHED = '2023-12-25'
const ALL = 'All registered crime'

const GEOMETRY_NAMES: Record<string, string> = {
  Bagalkote: 'Bagalkote', Ballari: 'Ballari', Bangalore: 'Bengaluru Urban', Belagavi: 'Belagavi',
  'Bengaluru Rural': 'Bengaluru Rural', Bidar: 'Bidar', Chamarajanagara: 'Chamarajanagara',
  Chikkaballapura: 'Chikkaballapura', Chamagaluru: 'Chikkamagaluru', Chikkamagaluru: 'Chikkamagaluru', Chitradurga: 'Chitradurga',
  'Dakshina Kannada': 'Dakshina Kannada', Davanagere: 'Davanagere', Dharwad: 'Dharwad', Gadag: 'Gadag',
  Hassan: 'Hassan', Haveri: 'Haveri', Kalaburagi: 'Kalaburagi', Kodagu: 'Kodagu', Kolar: 'Kolar',
  Koppal: 'Koppal', Mandya: 'Mandya', Mysuru: 'Mysuru', Raichur: 'Raichur', Ramanagara: 'Ramanagara',
  Shivamogga: 'Shivamogga', Tumakuru: 'Tumakuru', Udupi: 'Udupi', 'Uttara Kannada': 'Uttara Kannada',
  Vijayanagar: 'Vijayanagara', Vijayapura: 'Vijayapura', Yadgir: 'Yadgir',
}

const CENSUS_NAMES: Record<string, string> = {
  Belgaum: 'Belagavi', 'Bagalkot': 'Bagalkote', Bijapur: 'Vijayapura', Bidar: 'Bidar', Raichur: 'Raichur',
  Koppal: 'Koppal', Gadag: 'Gadag', Dharwad: 'Dharwad', 'Uttara Kannada': 'Uttara Kannada', Haveri: 'Haveri',
  Bellary: 'Ballari', Chitradurga: 'Chitradurga', Davanagere: 'Davanagere', Shimoga: 'Shivamogga', Udupi: 'Udupi',
  Chikmagalur: 'Chikkamagaluru', Tumkur: 'Tumakuru', Bangalore: 'Bengaluru Urban', Mandya: 'Mandya', Hassan: 'Hassan',
  'Dakshina Kannada': 'Dakshina Kannada', Kodagu: 'Kodagu', Mysore: 'Mysuru', Chamarajanagar: 'Chamarajanagara',
  Gulbarga: 'Kalaburagi', Yadgir: 'Yadgir', Kolar: 'Kolar', Chikkaballapura: 'Chikkaballapura',
  'Bangalore Rural': 'Bengaluru Rural', Ramanagara: 'Ramanagara',
}

function mean(values: number[]): number { return values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1) }
function variance(values: number[]): number { const m = mean(values); return values.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(values.length - 1, 1) }
function round(value: number, digits = 1): number { const p = 10 ** digits; return Math.round(value * p) / p }
function isoWeekStart(date: Date): string { return date.toISOString().slice(0, 10) }
function addWeeks(week: string, count: number): string { const d = new Date(`${week}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7 * count); return isoWeekStart(d) }
function weekRange(start: string, end: string): string[] { const weeks: string[] = []; for (let w = start; w <= end; w = addWeeks(w, 1)) weeks.push(w); return weeks }

function percentile(values: Array<{ key: string; value: number }>): Map<string, number> {
  const sorted = [...values].sort((a, b) => a.value - b.value || a.key.localeCompare(b.key))
  const result = new Map<string, number>()
  sorted.forEach((item, index) => result.set(item.key, sorted.length === 1 ? 100 : round((index / (sorted.length - 1)) * 100, 4)))
  return result
}

function ranks(values: number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  const out = new Array<number>(values.length)
  for (let i = 0; i < order.length;) {
    let j = i + 1
    while (j < order.length && order[j]!.value === order[i]!.value) j++
    const rank = (i + j - 1) / 2 + 1
    for (let k = i; k < j; k++) out[order[k]!.index] = rank
    i = j
  }
  return out
}

function spearman(a: number[], b: number[]): number | null {
  if (a.length < 3 || a.length !== b.length) return null
  const ra = ranks(a), rb = ranks(b), ma = mean(ra), mb = mean(rb)
  const numerator = ra.reduce((s, x, i) => s + (x - ma) * (rb[i]! - mb), 0)
  const denominator = Math.sqrt(ra.reduce((s, x) => s + (x - ma) ** 2, 0) * rb.reduce((s, x) => s + (x - mb) ** 2, 0))
  return denominator ? numerator / denominator : null
}

function ewma(values: number[], alpha = 0.25): number { return values.slice(1).reduce((level, value) => alpha * value + (1 - alpha) * level, values[0] ?? 0) }

function featureInputs(values: number[]) {
  const window = values.slice(-52)
  const baseline = mean(window)
  const spread = Math.sqrt(Math.max(variance(window), baseline, 1e-9))
  const anomaly = Math.max(0, ...values.slice(-4).map((v) => (v - baseline) / spread))
  const r = dispersion(baseline, variance(window))
  const upper = negativeBinomialQuantile(baseline, r, 0.99)
  const persistence = values.slice(-13).filter((v) => v > upper).length
  const level = ewma(window)
  const forecast4w = 4 * level
  const baseline4w = 4 * baseline
  const upliftRaw = Math.max(-1, Math.min(2, (forecast4w - baseline4w) / Math.max(baseline4w, 1)))
  const forecastR = Number.isFinite(r) ? 4 * r : r
  return { baseline, anomaly, persistence, level, forecast4w, baseline4w, upliftRaw, r: forecastR,
    low: negativeBinomialQuantile(forecast4w, forecastR, 0.1), high: negativeBinomialQuantile(forecast4w, forecastR, 0.9) }
}

async function loadContexts(features: any[]): Promise<Map<string, Context>> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(CENSUS)
  const sheet = workbook.getWorksheet('Sheet1')!
  const census = new Map<string, { total?: number; urban?: number }>()
  sheet.eachRow((row) => {
    const v = row.values as any[]
    if (String(v[1]).trim() !== '29' || String(v[7]).trim() !== 'DISTRICT') return
    const district = CENSUS_NAMES[String(v[8]).trim()]
    if (!district) return
    const item = census.get(district) ?? {}
    if (v[9] === 'Total') item.total = Number(v[11])
    if (v[9] === 'Urban') item.urban = Number(v[11])
    census.set(district, item)
  })

  // Current Vijayanagara is reconstructed from the six official taluks. The
  // new district has 1,353,628 residents, 359,694 urban residents and includes
  // Harapanahalli (302,003 total; 47,039 urban) from legacy Davanagere.
  const oldBallari = census.get('Ballari')!
  const oldDavanagere = census.get('Davanagere')!
  census.set('Vijayanagara', { total: 1_353_628, urban: 359_694 })
  census.set('Ballari', { total: oldBallari.total! - (1_353_628 - 302_003), urban: oldBallari.urban! - (359_694 - 47_039) })
  census.set('Davanagere', { total: oldDavanagere.total! - 302_003, urban: oldDavanagere.urban! - 47_039 })

  const result = new Map<string, Context>()
  for (const feature of features) {
    const district = feature.properties.district_name as string
    const c = census.get(district)
    if (!c?.total || c.urban === undefined) throw new Error(`Missing Census context for ${district}`)
    const measuredArea = area(feature) / 1_000_000
    result.set(district, { population: c.total, urban: c.urban, area_sq_km: district === 'Vijayanagara' ? 5_644 : measuredArea })
  }
  return result
}

async function main() {
  await mkdir(OUTPUT.scenarios, { recursive: true }); await mkdir(OUTPUT.derived, { recursive: true }); await mkdir(resolve(APP_ROOT, 'reference/processed'), { recursive: true })
  const mappings = parse(await readFile(CROSSWALK, 'utf8'), { columns: true, skip_empty_lines: true }) as Mapping[]
  const mapping = new Map(mappings.map((m) => [m.source_district, m]))
  if (mapping.size !== 41) throw new Error(`Expected 41 source mappings, got ${mapping.size}`)

  const rawGeo = JSON.parse(await readFile(GEOMETRY_SOURCE, 'utf8')) as any
  const features = rawGeo.features.map((source: any, index: number) => {
    const district = GEOMETRY_NAMES[source.properties.dtname]
    if (!district) throw new Error(`Unmapped geometry: ${source.properties.dtname}`)
    const geometry = cleanCoords(simplify(source, { tolerance: 0.0025, highQuality: true }))
    return { ...geometry, id: `KA-${String(index + 1).padStart(2, '0')}`, properties: { district_id: `KA-${String(index + 1).padStart(2, '0')}`, district_name: district, source_name: source.properties.dtname, center: centroid(geometry).geometry.coordinates } }
  }).sort((a: any, b: any) => a.properties.district_name.localeCompare(b.properties.district_name))
  features.forEach((f: any, i: number) => { f.id = `KA-${String(i + 1).padStart(2, '0')}`; f.properties.district_id = f.id })
  if (features.length !== 31 || new Set(features.map((f: any) => f.properties.district_name)).size !== 31) throw new Error('Current district geometry must contain exactly 31 unique districts')
  const geometry = { type: 'FeatureCollection', features, metadata: { source: 'Survey of India Bharat Maps / Government of India', vintage: '2017 service, current Vijayanagara split', generated_at: new Date().toISOString() } }
  await writeFile(GEOJSON_OUT, `${JSON.stringify(geometry)}\n`)
  const contexts = await loadContexts(features)

  const db = await DuckDBInstance.create(':memory:'); const connection = await db.connect()
  const firPath = INPUT.firCsv.replaceAll("'", "''")
  const query = `
    SELECT trim(District_Name) AS source_district, trim(UnitName) AS police_unit,
      coalesce(nullif(trim(CrimeGroup_Name), ''), 'Other / uncategorized') AS crime_group,
      strftime(date_trunc('week', make_date(cast(FIR_YEAR as int), cast(FIR_MONTH as int), greatest(1, least(28, cast(FIR_Day as int))))), '%Y-%m-%d') AS week_start,
      count(*) AS registrations
    FROM read_csv_auto('${firPath}', header=true, all_varchar=true)
    WHERE cast(FIR_YEAR as int) BETWEEN 2018 AND 2023
    GROUP BY 1,2,3,4 ORDER BY 4,1,3,2`
  const reader = await connection.runAndReadAll(query)
  const rows = reader.getRowObjects() as unknown as RawWeek[]

  const weeks = weekRange(START, LAST_PUBLISHED)
  const publishedWeeks = weekRange(FIRST_PUBLISHED, LAST_PUBLISHED)
  const series = new Map<string, Map<string, number>>()
  const policeBreakdown = new Map<string, Map<string, number>>()
  const specialTotals = new Map<string, number>()
  const crimeTotals = new Map<string, number>()
  for (const row of rows) {
    const mapped = mapping.get(String(row.source_district))
    if (!mapped) throw new Error(`Unmapped FIR district ${row.source_district}`)
    const count = Number(row.registrations)
    if (mapped.classification === 'special') { specialTotals.set(mapped.administrative_district, (specialTotals.get(mapped.administrative_district) ?? 0) + count); continue }
    const district = mapped.administrative_district
    const unitMap = policeBreakdown.get(district) ?? new Map<string, number>(); unitMap.set(String(row.source_district), (unitMap.get(String(row.source_district)) ?? 0) + count); policeBreakdown.set(district, unitMap)
    for (const category of [ALL, String(row.crime_group)]) {
      const key = `${district}\u0000${category}`; const byWeek = series.get(key) ?? new Map<string, number>(); byWeek.set(String(row.week_start), (byWeek.get(String(row.week_start)) ?? 0) + count); series.set(key, byWeek)
    }
    crimeTotals.set(String(row.crime_group), (crimeTotals.get(String(row.crime_group)) ?? 0) + count)
  }

  const districts: string[] = features.map((feature: any) => feature.properties.district_name as string)
  const publishedGroups = [ALL, ...[...crimeTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 11).map(([g]) => g)]
  const snapshots: Record<string, any[]> = {}
  for (const crimeGroup of publishedGroups) {
    const raw: Array<{ district: string; values: number[]; features: ReturnType<typeof featureInputs> }> = []
    for (const district of districts) {
      const byWeek = series.get(`${district}\u0000${crimeGroup}`) ?? new Map<string, number>()
      const allValues = weeks.map((week) => byWeek.get(week) ?? 0)
      const endIndex = weeks.indexOf(LAST_PUBLISHED)
      const training = allValues.slice(0, endIndex + 1)
      const latest52 = training.slice(-52)
      if (latest52.length < 52 || mean(latest52) < 0.5) continue
      raw.push({ district, values: training, features: featureInputs(training) })
    }
    if (raw.length < 10) continue
    const anomalyP = percentile(raw.map((r) => ({ key: r.district, value: r.features.anomaly })))
    const upliftP = percentile(raw.map((r) => ({ key: r.district, value: r.features.upliftRaw })))
    const persistenceP = percentile(raw.map((r) => ({ key: r.district, value: r.features.persistence })))
    snapshots[crimeGroup] = raw.map((r) => {
      const score = round(0.4 * anomalyP.get(r.district)! + 0.35 * upliftP.get(r.district)! + 0.25 * persistenceP.get(r.district)!, 1)
      return { district: r.district, score, band: score >= 75 ? 'Priority' : score >= 50 ? 'Monitor' : 'Stable', components: { recent_anomaly: round(anomalyP.get(r.district)!, 1), forecast_uplift: round(upliftP.get(r.district)!, 1), persistence: round(persistenceP.get(r.district)!, 1) }, raw: r }
    })
  }

  const allSnapshot = snapshots[ALL]!
  const finalDistricts = districts.map((district) => {
    const context = contexts.get(district)!
    const scored = allSnapshot.find((d: any) => d.district === district)!
    const values = scored.raw.values as number[]; const f = scored.raw.features
    const categories = publishedGroups.slice(1).map((group) => ({ group, item: snapshots[group]?.find((d: any) => d.district === district) })).filter((x) => x.item).sort((a, b) => b.item.score - a.item.score).slice(0, 3).map((x) => ({ crime_group: x.group, score: x.item.score, band: x.item.band }))
    const outlooks = Object.fromEntries(publishedGroups.filter((group) => snapshots[group]).map((group) => {
      const groupScore = snapshots[group]!.find((d: any) => d.district === district)
      if (!groupScore) return [group, null]
      const groupValues = groupScore.raw.values as number[]
      const groupFeatures = groupScore.raw.features
      return [group, {
        history: publishedWeeks.slice(-12).map((week, i) => ({ week, value: groupValues[groupValues.length - 12 + i] })),
        forecast: [1, 2, 3, 4].map((h) => ({ week: addWeeks(LAST_PUBLISHED, h), expected: round(groupFeatures.level, 2) })),
        forecast_4w: { low: groupFeatures.low, expected: round(groupFeatures.forecast4w, 1), high: groupFeatures.high, baseline: round(groupFeatures.baseline4w, 1) },
        risk: { score: groupScore.score, band: groupScore.band, components: groupScore.components },
      }]
    }))
    return {
      district_id: features.find((x: any) => x.properties.district_name === district).properties.district_id,
      name: district,
      police_units: [...(policeBreakdown.get(district) ?? new Map()).entries()].map(([name, registrations]) => ({ name, registrations })).sort((a, b) => b.registrations - a.registrations),
      context: { population: context.population, area_sq_km: round(context.area_sq_km, 1), density_per_sq_km: round(context.population / context.area_sq_km, 1), urban_share_pct: round(context.urban / context.population * 100, 1) },
      fir_total_2019_2023: values.slice(52).reduce((a, b) => a + b, 0),
      fir_rate_per_lakh: round(values.slice(52).reduce((a, b) => a + b, 0) / context.population * 100_000, 1),
      history: publishedWeeks.slice(-12).map((week, i) => ({ week, value: values[values.length - 12 + i] })),
      forecast: [1, 2, 3, 4].map((h) => ({ week: addWeeks(LAST_PUBLISHED, h), expected: round(f.level, 2) })),
      forecast_4w: { low: f.low, expected: round(f.forecast4w, 1), high: f.high, baseline: round(f.baseline4w, 1) },
      risk: { score: scored.score, band: scored.band, components: scored.components },
      outlooks,
      top_emerging_categories: categories,
    }
  }).sort((a, b) => b.risk.score - a.risk.score || a.name.localeCompare(b.name))

  // Rolling-origin 2023 evaluation for the all-crime statewide score.
  const tests: Array<{ score: number; actual: number; expected: number; low: number; high: number }> = []
  const evalWeeks = publishedWeeks.filter((w) => w >= '2023-01-02' && addWeeks(w, 4) <= '2024-01-01')
  for (const anchor of evalWeeks) {
    const anchorIndex = weeks.indexOf(anchor)
    const eligible = districts.map((district) => {
      const byWeek = series.get(`${district}\u0000${ALL}`) ?? new Map<string, number>(); const values = weeks.slice(0, anchorIndex + 1).map((w) => byWeek.get(w) ?? 0)
      if (values.length < 52 || mean(values.slice(-52)) < 0.5) return null
      return { district, values, features: featureInputs(values) }
    }).filter(Boolean) as Array<{ district: string; values: number[]; features: ReturnType<typeof featureInputs> }>
    if (eligible.length < 10) continue
    const ap = percentile(eligible.map((r) => ({ key: r.district, value: r.features.anomaly }))), up = percentile(eligible.map((r) => ({ key: r.district, value: r.features.upliftRaw }))), pp = percentile(eligible.map((r) => ({ key: r.district, value: r.features.persistence })))
    for (const item of eligible) {
      const byWeek = series.get(`${item.district}\u0000${ALL}`) ?? new Map<string, number>()
      const actual = [1, 2, 3, 4].reduce((sum, h) => sum + (byWeek.get(addWeeks(anchor, h)) ?? 0), 0)
      tests.push({ score: 0.4 * ap.get(item.district)! + 0.35 * up.get(item.district)! + 0.25 * pp.get(item.district)!, actual, expected: item.features.forecast4w, low: item.features.low, high: item.features.high })
    }
  }
  const rho = spearman(tests.map((t) => t.score), tests.map((t) => t.actual))
  const ordered = [...tests].sort((a, b) => b.score - a.score), cutoff = Math.max(1, Math.ceil(ordered.length * 0.2))
  const backtest = { period: 'rolling-origin 2023', observations: tests.length, four_week_mae: round(mean(tests.map((t) => Math.abs(t.actual - t.expected))), 2), interval_10_90_coverage_pct: round(tests.filter((t) => t.actual >= t.low && t.actual <= t.high).length / tests.length * 100, 1), spearman_risk_to_next_4w: rho === null ? null : round(rho, 3), top_quintile_lift: round(mean(ordered.slice(0, cutoff).map((t) => t.actual)) / mean(ordered.slice(cutoff).map((t) => t.actual)), 2) }

  const payload = {
    schema_version: '1.0.0', snapshot_through: ANALYSIS_CUTOFF, available_periods: { model: ['2019-01-07', ANALYSIS_CUTOFF], source_reconciliation: ['2016-01-01', '2024-03-31'] },
    crime_groups: publishedGroups.filter((g) => snapshots[g]),
    state_summary: { districts: 31, special_units: 4, source_rows: 1_674_734, published_model: 'EWMA / negative-binomial four-week outlook', top_priority: finalDistricts.slice(0, 5).map((d) => d.name) },
    districts: finalDistricts,
    special_units: [...specialTotals.entries()].map(([name, registrations]) => ({ name, registrations })).sort((a, b) => b.registrations - a.registrations),
    backtest,
    provenance: { fir_source: 'Karnataka Police FIR Details mirror', census_source: 'Census of India 2011 Primary Census Abstract', geometry_source: 'Survey of India Bharat Maps', district_definition: '31 current Karnataka administrative districts', model_note: 'Historical operational outlook; not an incident prediction.', checksums: { fir: await sha256File(INPUT.firCsv), crosswalk: await sha256File(CROSSWALK), census: await sha256File(CENSUS), geometry: await sha256File(GEOMETRY_SOURCE) } },
  }
  await writeFile(JSON_OUT, `${JSON.stringify(payload)}\n`)
  const csvLines = ['district_id,district_name,risk_score,risk_band,forecast_low,forecast_expected,forecast_high,fir_rate_per_lakh,population,density_per_sq_km,urban_share_pct', ...finalDistricts.map((d) => [d.district_id, d.name, d.risk.score, d.risk.band, d.forecast_4w.low, d.forecast_4w.expected, d.forecast_4w.high, d.fir_rate_per_lakh, d.context.population, d.context.density_per_sq_km, d.context.urban_share_pct].join(','))]
  await writeFile(CSV_OUT, `${csvLines.join('\n')}\n`)
  const inputs = await Promise.all([INPUT.firCsv, CROSSWALK, CENSUS, GEOMETRY_SOURCE].map(async (path) => ({ path, sha256: await sha256File(path) })))
  await recordOutput('18_state_intelligence', JSON_OUT, finalDistricts.length, inputs, { special_units: 4, crime_groups: payload.crime_groups.length, backtest_observations: tests.length })
  await recordOutput('18_state_intelligence', GEOJSON_OUT, features.length, inputs.slice(2), { current_districts: 31 })
  await recordOutput('18_state_intelligence', CSV_OUT, finalDistricts.length, inputs)
  console.log(`State Intelligence: ${finalDistricts.length} districts · ${payload.crime_groups.length} groups · ${tests.length} backtest points`)
}

await main()
