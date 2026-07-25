/**
 * A12 — deterministic Case Similarity fixture.
 *
 * Builds an inspectable candidate set for twelve corridor cases from the
 * graph-independent 64-dimensional MO vectors. Component similarities remain
 * separate so `kv-similar` can re-rank with user-adjustable published weights.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { DEMO_SPINE, OUTPUT } from './00_config.js'
import { GENERATION_VERSION, sha256File } from './lib/hash.js'
import { recordOutput } from './lib/manifest.js'
import { query } from './lib/parquet.js'

const INCIDENTS_PATH = resolve(OUTPUT.derived, 'incidents_time.parquet')
const SIGNATURES_PATH = resolve(OUTPUT.derived, 'mo_signatures.parquet')
const VECTORS_PATH = resolve(OUTPUT.nosql, 'mo_vectors.jsonl')
const OUTPUT_PATH = resolve(OUTPUT.scenarios, 'similarity_demo.json')
const REPORT_PATH = resolve(OUTPUT.reports, 'a12_case_similarity.md')

const WEIGHTS = Object.freeze({
  sections: 0.3,
  premise: 0.2,
  geography: 0.2,
  time: 0.15,
  victim: 0.1,
  weapon: 0.05,
})

interface ListValue {
  readonly items: readonly bigint[]
}

interface CandidateRow {
  readonly incident_id: string
  readonly vector: ListValue
  readonly registered_on: string
  readonly case_ref: string
  readonly unit_name: string
  readonly station_code: string
  readonly police_division: string
  readonly h3_r9: string
  readonly latitude: number
  readonly longitude: number
  readonly geo_origin: string
  readonly time_origin: string
  readonly hour_confidence: number
  readonly sections_json: string
  readonly premise_tokens_json: string
  readonly time_band: string | null
  readonly victim_profile_json: string
  readonly weapon_hints_json: string
}

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits))
}

function vector(row: CandidateRow): number[] {
  return row.vector.items.map(Number)
}

function cosine(left: readonly number[], right: readonly number[], start: number, end: number): number {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = start; index < end; index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  if (leftNorm === 0 && rightNorm === 0) return 1
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / Math.sqrt(leftNorm * rightNorm)
}

function distanceKm(left: CandidateRow, right: CandidateRow): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const lat1 = radians(left.latitude)
  const lat2 = radians(right.latitude)
  const deltaLat = lat2 - lat1
  const deltaLon = radians(right.longitude - left.longitude)
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function parseList(value: string): string[] {
  return JSON.parse(value) as string[]
}

function overlap(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right)
  return left.filter((value) => rightSet.has(value)).sort()
}

function componentScores(target: CandidateRow, candidate: CandidateRow) {
  const targetVector = vector(target)
  const candidateVector = vector(candidate)
  const kilometres = distanceKm(target, candidate)
  return {
    sections: cosine(targetVector, candidateVector, 0, 32),
    premise: cosine(targetVector, candidateVector, 32, 44),
    geography: Math.exp(-kilometres / 5),
    time: cosine(targetVector, candidateVector, 44, 50),
    victim: cosine(targetVector, candidateVector, 50, 56),
    weapon: cosine(targetVector, candidateVector, 56, 64),
    distance_km: kilometres,
  }
}

function weightedScore(components: ReturnType<typeof componentScores>): number {
  return (
    WEIGHTS.sections * components.sections +
    WEIGHTS.premise * components.premise +
    WEIGHTS.geography * components.geography +
    WEIGHTS.time * components.time +
    WEIGHTS.victim * components.victim +
    WEIGHTS.weapon * components.weapon
  )
}

function publicCase(row: CandidateRow) {
  return {
    incident_id: row.incident_id,
    case_ref: row.case_ref,
    registered_on: row.registered_on,
    unit_name: row.unit_name,
    station_code: row.station_code,
    police_division: row.police_division,
    h3_r9: row.h3_r9,
    geo_origin: row.geo_origin,
    time_origin: row.time_origin,
    hour_confidence: round(row.hour_confidence),
    sections: parseList(row.sections_json),
    premise_tokens: parseList(row.premise_tokens_json),
    time_band: row.time_band,
    victim_profile: parseList(row.victim_profile_json),
    weapon_hints: parseList(row.weapon_hints_json),
  }
}

async function main(): Promise<void> {
  const [incidentChecksum, signatureChecksum, vectorChecksum] = await Promise.all([
    sha256File(INCIDENTS_PATH),
    sha256File(SIGNATURES_PATH),
    sha256File(VECTORS_PATH),
  ])
  process.stdout.write('A12 · loading two-wheeler-theft MO candidate pool…\n')
  const candidates = (await query(
    `SELECT CAST(v.incident_id AS VARCHAR) AS incident_id, v.vector,
            strftime(i.registered_on, '%Y-%m-%d') AS registered_on,
            i.case_ref, i.unit_name, i.station_code, i.police_division,
            i.h3_r9, i.latitude, i.longitude, i.geo_origin, i.time_origin,
            i.hour_confidence, s.sections_json, s.premise_tokens_json,
            s.time_band, s.victim_profile_json, s.weapon_hints_json
       FROM read_json_auto('${VECTORS_PATH.replaceAll("'", "''")}', format='newline_delimited') v
       JOIN read_parquet('${INCIDENTS_PATH.replaceAll("'", "''")}') i
         ON CAST(v.incident_id AS VARCHAR) = i.incident_id
       JOIN read_parquet('${SIGNATURES_PATH.replaceAll("'", "''")}') s
         ON i.incident_id = s.incident_id
      WHERE i.within_complete_window
        AND i.crime_group = '${DEMO_SPINE.crimeGroup}'
        AND i.crime_head = '${DEMO_SPINE.crimeHead.replaceAll("'", "''")}'
      ORDER BY i.registered_on, i.incident_id`,
  )) as unknown as CandidateRow[]

  const corridorUnits = new Set(DEMO_SPINE.stations.map((station) => `${station} PS`))
  const targets: CandidateRow[] = []
  for (const station of [...corridorUnits]) {
    targets.push(
      ...candidates
        .filter(
          (row) =>
            row.unit_name === station &&
            row.registered_on.startsWith('2023-') &&
            row.geo_origin !== 'inferred',
        )
        .slice(-3),
    )
  }
  if (targets.length !== 12) throw new Error(`Expected 12 similarity targets, found ${targets.length}`)

  const cases = targets.map((target) => {
    const targetSections = parseList(target.sections_json)
    const targetPremises = parseList(target.premise_tokens_json)
    const scored = candidates
      .filter(
        (candidate) =>
          candidate.incident_id !== target.incident_id &&
          candidate.registered_on < target.registered_on,
      )
      .map((candidate) => {
        const components = componentScores(target, candidate)
        const sharedSections = overlap(targetSections, parseList(candidate.sections_json))
        const sharedPremiseTokens = overlap(
          targetPremises,
          parseList(candidate.premise_tokens_json),
        )
        return {
          ...publicCase(candidate),
          components: {
            sections: round(components.sections),
            premise: round(components.premise),
            geography: round(components.geography),
            time: round(components.time),
            victim: round(components.victim),
            weapon: round(components.weapon),
          },
          default_score: round(weightedScore(components)),
          distance_km: round(components.distance_km, 3),
          days_earlier: Math.round(
            (Date.parse(target.registered_on) - Date.parse(candidate.registered_on)) / 86_400_000,
          ),
          shared_sections: sharedSections,
          shared_premise_tokens: sharedPremiseTokens,
        }
      })
      .sort(
        (left, right) =>
          right.default_score - left.default_score ||
          left.incident_id.localeCompare(right.incident_id),
      )
      .slice(0, 100)
    return { target: publicCase(target), candidates: scored }
  })

  const fixture = {
    schema_version: 1,
    fixture_id: 'case-similarity-corridor-v1',
    scope: 'Twelve reported-coordinate corridor cases; graph-independent MO comparison',
    weights: WEIGHTS,
    vector_layout: {
      dimensions: 64,
      sections: [0, 32],
      premise: [32, 44],
      time: [44, 50],
      victim: [50, 56],
      weapon: [56, 64],
      geography: 'exp(-distance_km / 5), computed from H3-aggregate coordinates',
    },
    cases,
    provenance: {
      source_authority: 'third_party_mirror',
      transformation: 'derived',
      method: 'weighted_component_cosine_v1',
      source_checksum: incidentChecksum,
      signature_checksum: signatureChecksum,
      vector_checksum: vectorChecksum,
      generation_version: GENERATION_VERSION,
    },
  }
  await mkdir(OUTPUT.scenarios, { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
  await recordOutput(
    '12_similarity_fixture',
    OUTPUT_PATH,
    cases.length,
    [
      { path: INCIDENTS_PATH, sha256: incidentChecksum },
      { path: SIGNATURES_PATH, sha256: signatureChecksum },
      { path: VECTORS_PATH, sha256: vectorChecksum },
    ],
    { candidate_pool: candidates.length, candidates_per_case: 100 },
  )
  await mkdir(OUTPUT.reports, { recursive: true })
  await writeFile(
    REPORT_PATH,
    `# A12 Case Similarity\n\n` +
      `- Candidate pool: **${candidates.length.toLocaleString()}** complete-window two-wheeler-theft records\n` +
      `- Demonstration targets: **${cases.length}** reported-coordinate corridor cases\n` +
      `- Re-rankable candidates per target: **100**\n` +
      `- Graph dependency: **none**\n` +
      `- Vector layout: **64 dimensions, mo64_v1**\n\n` +
      `The published component weights remain separate in the fixture and may be adjusted by the user.\n`,
    'utf8',
  )
  process.stdout.write(
    `A12 · ${cases.length} targets · ${candidates.length.toLocaleString()} candidates · 100 retained each\n`,
  )
}

await main()
