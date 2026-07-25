/**
 * 04 — Estimated occurrence-hour model (BUILD_SPEC §6.4 step 04).
 *
 * This is the only KSPCID stage allowed to read the LA donor in `output/`.
 * It uses that synthetic set as a distribution donor only: no donor event is
 * emitted, joined to a Bengaluru FIR row, or displayed.
 *
 * The donor taxonomy is broader than the FIR mirror's 352 crime heads. Each
 * source crime head is therefore assigned to the least-specific supported donor
 * category using explicit keyword rules; unknowns fall back to `other_incident`.
 * The resulting profile is still materialized by
 * `crime_head × premise_class × weekday`, so the inference and its fallback
 * level are inspectable rather than hidden.
 *
 * Cyber and missing-person rows always receive a null hour. Their source does
 * not support a meaningful point occurrence time and the donor must not invent
 * one.
 *
 *   npm run etl:04
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { OUTPUT } from './00_config.js'
import { GENERATION_VERSION, sha256File, stableUint64 } from './lib/hash.js'
import { recordOutput } from './lib/manifest.js'
import { ParquetWriter, query, type Column } from './lib/parquet.js'

const INPUT_PATH = resolve(OUTPUT.derived, 'incidents.parquet')
const DONOR_PATH = resolve('output/bengaluru_synthetic_crime_2020_2024.parquet')
const OUTPUT_PATH = resolve(OUTPUT.derived, 'incidents_time.parquet')
const PROFILES_PATH = resolve(OUTPUT.derived, 'time_model_profiles.json')
const PRIOR_STRENGTH = 48

const BASE_COLUMNS: readonly Column[] = [
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

const COLUMNS: readonly Column[] = [
  ...BASE_COLUMNS,
  { name: 'estimated_occurrence_hour', type: 'INTEGER' },
  { name: 'hour_confidence', type: 'DOUBLE' },
  { name: 'time_origin', type: 'VARCHAR' },
  { name: 'time_method', type: 'VARCHAR' },
  { name: 'time_model_category', type: 'VARCHAR' },
  { name: 'time_model_level', type: 'VARCHAR' },
  { name: 'source_authority', type: 'VARCHAR' },
  { name: 'transformation', type: 'VARCHAR' },
  { name: 'source_checksum', type: 'VARCHAR' },
  { name: 'time_source_authority', type: 'VARCHAR' },
  { name: 'time_transformation', type: 'VARCHAR' },
  { name: 'time_source_checksum', type: 'VARCHAR' },
  { name: 'generation_version', type: 'VARCHAR' },
]

type DonorCategory =
  | 'property_crime'
  | 'violent_crime'
  | 'fraud_cyber_crime'
  | 'family_child_offence'
  | 'sexual_offence'
  | 'public_order'
  | 'weapons_offence'
  | 'drug_offence'
  | 'other_incident'

interface CountRow {
  readonly crime_category: DonorCategory
  readonly premise_category: string
  readonly weekday: number
  readonly hour: number
  readonly n: number | bigint
}

interface SourceTaxon {
  readonly crime_group: string
  readonly crime_head: string
}

interface Profile {
  readonly counts: readonly number[]
  readonly probabilities: readonly number[]
  readonly observations: number
  readonly level: 'category_premise_weekday' | 'category_weekday' | 'category' | 'marginal'
}

interface MaterializedProfile {
  readonly crime_group: string
  readonly crime_head: string
  readonly donor_category: DonorCategory | null
  readonly premise_class: string
  readonly weekday: number
  readonly observations: number
  readonly prior_strength: number
  readonly fallback_level: Profile['level'] | 'not_applicable'
  readonly probabilities: readonly number[] | null
}

function donorCategory(crimeGroup: string, crimeHead: string): DonorCategory | null {
  const text = `${crimeGroup} ${crimeHead}`.toUpperCase()
  if (/\b(CYBER|MISSING PERSON)\b/.test(text)) return null
  if (/\b(NARCOTIC|DRUG|NDPS)\b/.test(text)) return 'drug_offence'
  if (/\b(ARMS|WEAPON|EXPLOSIVE)\b/.test(text)) return 'weapons_offence'
  if (/\b(RAPE|MOLEST|POCSO|SEX|PORNOGRAPH|MODESTY)\b/.test(text)) {
    return 'sexual_offence'
  }
  if (/\b(CRUELTY|DOWRY|MARRIAGE|CHILD|INFANT|FAMILY)\b/.test(text)) {
    return 'family_child_offence'
  }
  if (/\b(ROBBERY|DACOITY|MURDER|HOMICIDE|HURT|ASSAULT|KIDNAP|CONFINEMENT)\b/.test(text)) {
    return 'violent_crime'
  }
  if (/\b(THEFT|BURGLARY|ARSON|MISCHIEF|STOLEN PROPERTY)\b/.test(text)) {
    return 'property_crime'
  }
  if (/\b(CHEAT|FRAUD|FORGER|COUNTERFEIT|BREACH OF TRUST|IMPERSONATION)\b/.test(text)) {
    return 'fraud_cyber_crime'
  }
  if (
    /\b(PUBLIC|POLICE ACT|CrPC|TRAFFIC|ACCIDENT|NEGLIGEN|RIOT|AFFRAY|TRESPASS|NUISANCE|COURT|ELECTION)\b/i.test(
      text,
    )
  ) {
    return 'public_order'
  }
  return 'other_incident'
}

function donorPremise(premiseClass: string): string {
  return premiseClass === 'intersection' ? 'outdoor' : premiseClass
}

function key(category: string, premise: string, weekday: number): string {
  return `${category}\u0000${premise}\u0000${weekday}`
}

function addCount(map: Map<string, number[]>, mapKey: string, hour: number, count: number): void {
  let hours = map.get(mapKey)
  if (!hours) {
    hours = Array.from({ length: 24 }, () => 0)
    map.set(mapKey, hours)
  }
  hours[hour] = (hours[hour] ?? 0) + count
}

function profile(
  countsByKey: ReadonlyMap<string, readonly number[]>,
  globalCounts: readonly number[],
  category: DonorCategory,
  premise: string,
  weekday: number,
): Profile {
  const candidates: ReadonlyArray<readonly [string, Profile['level']]> = [
    [key(category, premise, weekday), 'category_premise_weekday'],
    [key(category, '*', weekday), 'category_weekday'],
    [key(category, '*', -1), 'category'],
    [key('*', '*', -1), 'marginal'],
  ]
  const [selectedKey, level] =
    candidates.find(([candidate]) => {
      const counts = countsByKey.get(candidate)
      return counts !== undefined && counts.some((value) => value > 0)
    }) ?? candidates[candidates.length - 1]!
  const counts = countsByKey.get(selectedKey) ?? globalCounts
  const observations = counts.reduce((sum, value) => sum + value, 0)
  const globalTotal = globalCounts.reduce((sum, value) => sum + value, 0)
  const probabilities = counts.map(
    (count, hour) =>
      (count + PRIOR_STRENGTH * ((globalCounts[hour] ?? 0) / globalTotal)) /
      (observations + PRIOR_STRENGTH),
  )
  return { counts, probabilities, observations, level }
}

function unitDraw(incidentId: string, profileKey: string): number {
  const draw = stableUint64('time_model', incidentId, profileKey)
  return Number(draw >> 11n) / 9_007_199_254_740_992
}

function sampleHour(probabilities: readonly number[], draw: number): number {
  let cumulative = 0
  for (let hour = 0; hour < probabilities.length; hour++) {
    cumulative += probabilities[hour] ?? 0
    if (draw < cumulative) return hour
  }
  return 23
}

async function main(): Promise<void> {
  const started = Date.now()
  process.stdout.write('04 · fitting donor hour distributions…\n')
  const [inputChecksum, donorChecksum] = await Promise.all([
    sha256File(INPUT_PATH),
    sha256File(DONOR_PATH),
  ])

  // `occurred_at` is a donor-only field and may only be read in this stage. lint-truth-ok: no-occurred-at — donor field
  const donorCounts = (await query(
    `SELECT crime_category,
            premise_category,
            dayofweek(CAST(substr(occurred_at, 1, 10) AS DATE))::INTEGER weekday, -- lint-truth-ok: no-occurred-at — donor field
            CAST(substr(occurred_at, 12, 2) AS INTEGER) AS "hour", -- lint-truth-ok: no-occurred-at — donor field
            count(*)::BIGINT n
     FROM '${DONOR_PATH}'
     GROUP BY 1, 2, 3, 4
     ORDER BY 1, 2, 3, 4`,
  )) as unknown as CountRow[]

  const countsByKey = new Map<string, number[]>()
  const globalCounts = Array.from({ length: 24 }, () => 0)
  for (const row of donorCounts) {
    const count = Number(row.n)
    addCount(countsByKey, key(row.crime_category, row.premise_category, row.weekday), row.hour, count)
    addCount(countsByKey, key(row.crime_category, '*', row.weekday), row.hour, count)
    addCount(countsByKey, key(row.crime_category, '*', -1), row.hour, count)
    addCount(countsByKey, key('*', '*', -1), row.hour, count)
    globalCounts[row.hour] = (globalCounts[row.hour] ?? 0) + count
  }

  const taxa = (await query(
    `SELECT DISTINCT crime_group, crime_head
     FROM '${INPUT_PATH}'
     ORDER BY 1, 2`,
  )) as unknown as SourceTaxon[]
  const premiseClasses = [
    'residential',
    'commercial',
    'transit',
    'public_institutional',
    'intersection',
    'outdoor',
    'built_other',
  ] as const

  const materialized: MaterializedProfile[] = []
  const profileBySourceKey = new Map<string, Profile>()
  for (const taxon of taxa) {
    const category = donorCategory(taxon.crime_group, taxon.crime_head)
    for (const premiseClass of premiseClasses) {
      for (let weekday = 0; weekday < 7; weekday++) {
        if (category === null) {
          materialized.push({
            ...taxon,
            donor_category: null,
            premise_class: premiseClass,
            weekday,
            observations: 0,
            prior_strength: PRIOR_STRENGTH,
            fallback_level: 'not_applicable',
            probabilities: null,
          })
          continue
        }
        const fitted = profile(
          countsByKey,
          globalCounts,
          category,
          donorPremise(premiseClass),
          weekday,
        )
        const sourceKey = key(
          `${taxon.crime_group}\u0001${taxon.crime_head}`,
          premiseClass,
          weekday,
        )
        profileBySourceKey.set(sourceKey, fitted)
        materialized.push({
          ...taxon,
          donor_category: category,
          premise_class: premiseClass,
          weekday,
          observations: fitted.observations,
          prior_strength: PRIOR_STRENGTH,
          fallback_level: fitted.level,
          probabilities: fitted.probabilities.map((value) => Number(value.toFixed(12))),
        })
      }
    }
  }

  await mkdir(OUTPUT.derived, { recursive: true })
  await writeFile(
    PROFILES_PATH,
    `${JSON.stringify(
      {
        method: 'time_model_v1',
        generation_version: GENERATION_VERSION,
        donor_checksum: donorChecksum,
        prior: {
          type: 'dirichlet_smoothed_to_global_hour_marginal',
          strength: PRIOR_STRENGTH,
        },
        weekday_basis: 'registered_on',
        profiles: materialized,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  process.stdout.write('04 · applying deterministic hour draws…\n')
  const rows = (await query(
    `SELECT *, dayofweek(registered_on)::INTEGER registered_weekday
     FROM '${INPUT_PATH}'
     ORDER BY source_row_number`,
  )) as Array<Record<string, unknown>>
  const writer = await ParquetWriter.create('incidents_time', COLUMNS)
  let inferred = 0
  let excludedCyber = 0
  let excludedMissing = 0
  const hourCounts = Array.from({ length: 24 }, () => 0)

  for (const row of rows) {
    const crimeGroup = String(row['crime_group'])
    const crimeHead = String(row['crime_head'])
    const premiseClass = String(row['premise_class'])
    const weekday = Number(row['registered_weekday'])
    const category = donorCategory(crimeGroup, crimeHead)

    if (category === null) {
      if (/CYBER/i.test(crimeGroup)) excludedCyber++
      else excludedMissing++
      await writer.write({
        ...row,
        estimated_occurrence_hour: null,
        hour_confidence: null,
        time_origin: 'not_applicable',
        time_method: null,
        time_model_category: null,
        time_model_level: 'not_applicable',
        source_authority: 'third_party_mirror',
        transformation: 'normalized',
        source_checksum: inputChecksum,
        time_source_authority: 'third_party_mirror',
        time_transformation: 'inferred',
        time_source_checksum: donorChecksum,
        generation_version: GENERATION_VERSION,
      })
      continue
    }

    const sourceKey = key(`${crimeGroup}\u0001${crimeHead}`, premiseClass, weekday)
    const fitted = profileBySourceKey.get(sourceKey)
    if (!fitted) throw new Error(`No time profile for ${sourceKey}`)
    const draw = unitDraw(String(row['incident_id']), sourceKey)
    const hour = sampleHour(fitted.probabilities, draw)
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1
    inferred++

    await writer.write({
      ...row,
      estimated_occurrence_hour: hour,
      // This is the posterior mass assigned to the sampled hour, not a claim
      // that the estimate is correct with that probability.
      hour_confidence: fitted.probabilities[hour],
      time_origin: 'inferred',
      time_method: 'time_model_v1',
      time_model_category: category,
      time_model_level: fitted.level,
      source_authority: 'third_party_mirror',
      transformation: 'normalized',
      source_checksum: inputChecksum,
      time_source_authority: 'third_party_mirror',
      time_transformation: 'inferred',
      time_source_checksum: donorChecksum,
      generation_version: GENERATION_VERSION,
    })
  }

  const written = await writer.finish(OUTPUT_PATH)
  await recordOutput(
    '04_time_model',
    PROFILES_PATH,
    materialized.length,
    [
      { path: INPUT_PATH, sha256: inputChecksum },
      { path: DONOR_PATH, sha256: donorChecksum },
    ],
    {
      prior_strength: PRIOR_STRENGTH,
      weekday_basis: 'registered_on',
      taxonomy_fallback: 'other_incident',
    },
  )
  await recordOutput(
    '04_time_model',
    OUTPUT_PATH,
    written,
    [
      { path: INPUT_PATH, sha256: inputChecksum },
      { path: DONOR_PATH, sha256: donorChecksum },
      { path: PROFILES_PATH, sha256: await sha256File(PROFILES_PATH) },
    ],
    {
      inferred,
      null_cyber: excludedCyber,
      null_missing_person: excludedMissing,
      hour_counts: hourCounts,
    },
  )

  await mkdir(OUTPUT.reports, { recursive: true })
  await writeFile(
    resolve(OUTPUT.reports, 'a7_time_model.md'),
    [
      '# A7 / 04 — Time model',
      '',
      '**PASS** — deterministic distribution-donor inference implemented.',
      '',
      `- FIR rows written: **${written.toLocaleString()}**`,
      `- Hours inferred: **${inferred.toLocaleString()}**`,
      `- Cyber rows held at null: **${excludedCyber.toLocaleString()}**`,
      `- Missing-person rows held at null: **${excludedMissing.toLocaleString()}**`,
      `- Materialized crime-head × premise × weekday profiles: **${materialized.length.toLocaleString()}**`,
      `- Dirichlet prior strength: **${PRIOR_STRENGTH}**, smoothed toward the donor's global hour marginal`,
      '',
      '## Conservative taxonomy choice',
      '',
      'The donor does not share the FIR mirror’s crime-head taxonomy. Explicit keyword',
      'rules map only to broad donor categories; unsupported labels fall back to',
      '`other_incident`. The chosen donor category and fallback level are stored on',
      'every inferred row and in `time_model_profiles.json`.',
      '',
      'Weekday conditioning uses `registered_on`, the only source date available.',
      'That limitation is named in the profile metadata; no occurrence date was created.',
      '',
      '`hour_confidence` is the posterior probability mass of the sampled hour. It is',
      'not presented as an empirical accuracy estimate.',
      '',
    ].join('\n'),
    'utf8',
  )

  if (written !== 425_408 || excludedCyber !== 64_599 || excludedMissing !== 39_234) {
    throw new Error(
      `Time-model reconciliation failed: rows=${written}, cyber=${excludedCyber}, missing=${excludedMissing}`,
    )
  }
  process.stdout.write(
    `04 complete in ${((Date.now() - started) / 1000).toFixed(1)}s — ` +
      `${inferred.toLocaleString()} inferred · ` +
      `${(excludedCyber + excludedMissing).toLocaleString()} intentionally null\n`,
  )
}

main().catch((error: unknown) => {
  process.stderr.write(`04 failed: ${String(error)}\n`)
  process.exitCode = 1
})
