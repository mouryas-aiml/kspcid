/**
 * 05 — Modus-operandi signatures (BUILD_SPEC §6.4 step 05).
 *
 * Parses repeated `ACT NAME U/s: section,…` groups, tokenizes the source place
 * text, and emits an explainable 64-dimensional feature vector.
 *
 * The specification simultaneously asks for a 64-dimensional vector and
 * one-hot encoding of the top 200 sections. A literal one-hot layout would
 * require at least 200 dimensions before premise/time/victim/weapon features.
 * The conservative resolution is stable feature hashing: all top-200 section
 * signals are retained in a documented 32-slot section block. Collision
 * membership is emitted in `mo_vocabulary.json`.
 *
 * Data Store shape: `mo_signatures.parquet` (explanations and document ids).
 * NoSQL shape: `data/nosql/mo_vectors.jsonl` (one vector document per line).
 *
 *   npm run etl:05
 */
import { createWriteStream } from 'node:fs'
import { once } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { OUTPUT } from './00_config.js'
import { GENERATION_VERSION, sha256File, stableIndex } from './lib/hash.js'
import { recordOutput } from './lib/manifest.js'
import { ParquetWriter, query, type Column } from './lib/parquet.js'

const INPUT_PATH = resolve(OUTPUT.derived, 'incidents_time.parquet')
const SIGNATURES_PATH = resolve(OUTPUT.derived, 'mo_signatures.parquet')
const VOCABULARY_PATH = resolve(OUTPUT.derived, 'mo_vocabulary.json')
const VECTORS_PATH = resolve(OUTPUT.nosql, 'mo_vectors.jsonl')

const SECTION_START = 0
const SECTION_DIMENSIONS = 32
const PREMISE_START = 32
const PREMISE_DIMENSIONS = 12
const TIME_START = 44
const VICTIM_START = 50
const WEAPON_START = 56
const VECTOR_DIMENSIONS = 64

const COLUMNS: readonly Column[] = [
  { name: 'incident_id', type: 'VARCHAR' },
  { name: 'case_ref', type: 'VARCHAR' },
  { name: 'acts_json', type: 'VARCHAR' },
  { name: 'sections_json', type: 'VARCHAR' },
  { name: 'top_sections_json', type: 'VARCHAR' },
  { name: 'premise_tokens_json', type: 'VARCHAR' },
  { name: 'time_band', type: 'VARCHAR' },
  { name: 'victim_profile_json', type: 'VARCHAR' },
  { name: 'weapon_hints_json', type: 'VARCHAR' },
  { name: 'vector_document_id', type: 'VARCHAR' },
  { name: 'vector_dimensions', type: 'INTEGER' },
  { name: 'source_authority', type: 'VARCHAR' },
  { name: 'transformation', type: 'VARCHAR' },
  { name: 'method', type: 'VARCHAR' },
  { name: 'source_checksum', type: 'VARCHAR' },
  { name: 'generation_version', type: 'VARCHAR' },
]

interface ParsedAct {
  readonly act: string
  readonly sections: readonly string[]
}

interface CountedSection {
  readonly token: string
  readonly count: number
}

interface VectorDocument {
  readonly id: string
  readonly incident_id: string
  readonly dimensions: 64
  readonly layout: 'mo64_v1'
  readonly vector: readonly number[]
  readonly source_authority: 'third_party_mirror'
  readonly transformation: 'derived'
  readonly method: 'mo_signature_v1'
  readonly source_checksum: string
  readonly generation_version: string
}

function normalizeAct(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toUpperCase()
}

function parseSections(value: string): string[] {
  return value
    .split(',')
    .map((section) => section.replace(/\s+/g, '').toUpperCase())
    .filter((section) => /^[0-9A-Z][0-9A-Z().&/-]{0,31}$/.test(section))
}

export function parseActSections(value: unknown): ParsedAct[] {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const markers = [...text.matchAll(/\s+U\/s:\s*/gi)]
  if (markers.length === 0) return []

  const parsed: ParsedAct[] = []
  let actStart = 0
  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index]!
    const markerStart = marker.index
    const markerEnd = markerStart + marker[0].length
    const nextStart = markers[index + 1]?.index ?? text.length
    let sectionAndNextAct = text.slice(markerEnd, nextStart).trim()
    let nextActStart = nextStart

    if (index + 1 < markers.length) {
      const splitAt = sectionAndNextAct.search(
        /\s+(?=[A-Z][A-Z0-9\s,&.'()/-]{2,}(?:ACT|CODE|PROCEDURE)\b)/,
      )
      if (splitAt >= 0) {
        const nextAct = sectionAndNextAct.slice(splitAt).trim()
        sectionAndNextAct = sectionAndNextAct.slice(0, splitAt).trim()
        nextActStart = nextStart - nextAct.length
      }
    }

    const act = normalizeAct(text.slice(actStart, markerStart))
    const sections = parseSections(sectionAndNextAct)
    if (act && sections.length > 0) parsed.push({ act, sections })
    actStart = nextActStart
  }
  return parsed
}

function sectionTokens(acts: readonly ParsedAct[]): string[] {
  return [
    ...new Set(
      acts.flatMap(({ act, sections }) => sections.map((section) => `${act}::${section}`)),
    ),
  ].sort()
}

const PLACE_STOP_WORDS = new Set([
  'AND',
  'AT',
  'BY',
  'FRONT',
  'IN',
  'NEAR',
  'NO',
  'OF',
  'OPP',
  'OPPOSITE',
  'ROAD',
  'THE',
])

function premiseTokens(value: unknown): string[] {
  return [
    ...new Set(
      String(value ?? '')
        .toUpperCase()
        .replace(/[^A-Z\s]/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length >= 3 && !PLACE_STOP_WORDS.has(token)),
    ),
  ]
    .sort()
    .slice(0, 24)
}

const TIME_BANDS = [
  'late_night',
  'early_morning',
  'morning',
  'afternoon',
  'evening',
  'night',
] as const

function timeBand(hour: unknown): (typeof TIME_BANDS)[number] | null {
  if (hour === null || hour === undefined) return null
  const parsed = Number(hour)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) return null
  return TIME_BANDS[Math.floor(parsed / 4)] ?? null
}

const VICTIM_FEATURES = ['male', 'female', 'boy', 'girl', 'multiple', 'none'] as const

function victimProfile(row: Readonly<Record<string, unknown>>): string[] {
  const values = [
    Number(row['victim_male']),
    Number(row['victim_female']),
    Number(row['victim_boy']),
    Number(row['victim_girl']),
  ]
  const labels = VICTIM_FEATURES.slice(0, 4).filter((_, index) => (values[index] ?? 0) > 0)
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total > 1) labels.push('multiple')
  if (total === 0) labels.push('none')
  return labels
}

const WEAPON_FEATURES = [
  'firearm',
  'blade',
  'blunt',
  'fire_or_chemical',
  'vehicle',
  'digital',
  'restraint',
  'other_weapon',
] as const

function weaponHints(row: Readonly<Record<string, unknown>>): string[] {
  const text =
    `${row['crime_group']} ${row['crime_head']} ${row['act_section']} ${row['place_of_offence']}`.toUpperCase()
  const hints: string[] = []
  if (/\b(GUN|PISTOL|REVOLVER|FIREARM|RIFLE|ARMS ACT)\b/.test(text)) hints.push('firearm')
  if (/\b(KNIFE|BLADE|SWORD|MACHETE|DAGGER)\b/.test(text)) hints.push('blade')
  if (/\b(ROD|CLUB|STONE|STICK|BLUNT)\b/.test(text)) hints.push('blunt')
  if (/\b(ACID|CHEMICAL|ARSON|FIRE|BURN)\b/.test(text)) hints.push('fire_or_chemical')
  if (/\b(VEHICLE|AUTOMOBILE|MOTOR|CAR|BIKE|SCOOTER|TWO WHEELER)\b/.test(text)) {
    hints.push('vehicle')
  }
  if (/\b(CYBER|INFORMATION TECHNOLOGY|ONLINE|PHONE|ACCOUNT)\b/.test(text)) {
    hints.push('digital')
  }
  if (/\b(CONFINEMENT|RESTRAINT|KIDNAP|ABDUCTION)\b/.test(text)) hints.push('restraint')
  if (hints.length === 0 && /\b(WEAPON|DANGEROUS MEANS)\b/.test(text)) hints.push('other_weapon')
  return [...new Set(hints)].sort()
}

function buildVector(
  sections: readonly string[],
  topSections: ReadonlySet<string>,
  placeTokens: readonly string[],
  band: string | null,
  victims: readonly string[],
  weapons: readonly string[],
): number[] {
  const vector = Array.from({ length: VECTOR_DIMENSIONS }, () => 0)
  for (const section of sections) {
    if (!topSections.has(section)) continue
    vector[
      SECTION_START +
        stableIndex('mo_section_feature', section, 'mo64_v1', SECTION_DIMENSIONS)
    ] = 1
  }
  for (const token of placeTokens) {
    vector[
      PREMISE_START +
        stableIndex('mo_premise_feature', token, 'mo64_v1', PREMISE_DIMENSIONS)
    ] = 1
  }
  const timeIndex = band === null ? -1 : TIME_BANDS.indexOf(band as (typeof TIME_BANDS)[number])
  if (timeIndex >= 0) vector[TIME_START + timeIndex] = 1
  for (const victim of victims) {
    const index = VICTIM_FEATURES.indexOf(victim as (typeof VICTIM_FEATURES)[number])
    if (index >= 0) vector[VICTIM_START + index] = 1
  }
  for (const weapon of weapons) {
    const index = WEAPON_FEATURES.indexOf(weapon as (typeof WEAPON_FEATURES)[number])
    if (index >= 0) vector[WEAPON_START + index] = 1
  }
  return vector
}

class JsonlWriter {
  readonly #stream
  #buffer: string[] = []
  #rows = 0

  constructor(path: string) {
    this.#stream = createWriteStream(path, { encoding: 'utf8' })
  }

  async write(value: VectorDocument): Promise<void> {
    this.#buffer.push(`${JSON.stringify(value)}\n`)
    this.#rows++
    if (this.#buffer.length >= 2_048) await this.flush()
  }

  async flush(): Promise<void> {
    if (this.#buffer.length === 0) return
    const chunk = this.#buffer.join('')
    this.#buffer = []
    if (!this.#stream.write(chunk)) await once(this.#stream, 'drain')
  }

  async finish(): Promise<number> {
    await this.flush()
    this.#stream.end()
    await once(this.#stream, 'finish')
    return this.#rows
  }
}

function assertParser(): void {
  const parsed = parseActSections(
    'IPC 1860 U/s: 420,419 INFORMATION TECHNOLOGY ACT 2008 U/s: 66(C),66(D)',
  )
  if (
    parsed.length !== 2 ||
    parsed[0]?.act !== 'IPC 1860' ||
    parsed[1]?.sections.join(',') !== '66(C),66(D)'
  ) {
    throw new Error(`Act/section parser self-test failed: ${JSON.stringify(parsed)}`)
  }
}

async function main(): Promise<void> {
  const started = Date.now()
  assertParser()
  const inputChecksum = await sha256File(INPUT_PATH)
  const rows = (await query(
    `SELECT * FROM '${INPUT_PATH}' ORDER BY source_row_number`,
  )) as Array<Record<string, unknown>>

  process.stdout.write('05 · counting act/section vocabulary…\n')
  const sectionCounts = new Map<string, number>()
  for (const row of rows) {
    for (const token of sectionTokens(parseActSections(row['act_section']))) {
      sectionCounts.set(token, (sectionCounts.get(token) ?? 0) + 1)
    }
  }
  const vocabulary: CountedSection[] = [...sectionCounts.entries()]
    .map(([token, count]) => ({ token, count }))
    .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token))
    .slice(0, 200)
  const topSections = new Set(vocabulary.map(({ token }) => token))
  const sectionSlots = Object.fromEntries(
    vocabulary.map(({ token }) => [
      token,
      SECTION_START +
        stableIndex('mo_section_feature', token, 'mo64_v1', SECTION_DIMENSIONS),
    ]),
  )

  await mkdir(OUTPUT.derived, { recursive: true })
  await mkdir(OUTPUT.nosql, { recursive: true })
  await writeFile(
    VOCABULARY_PATH,
    `${JSON.stringify(
      {
        layout: 'mo64_v1',
        dimensions: VECTOR_DIMENSIONS,
        generation_version: GENERATION_VERSION,
        blocks: {
          sections: { start: SECTION_START, dimensions: SECTION_DIMENSIONS, encoding: 'stable_feature_hash' },
          premise_tokens: { start: PREMISE_START, dimensions: PREMISE_DIMENSIONS, encoding: 'stable_feature_hash' },
          time_band: { start: TIME_START, labels: TIME_BANDS },
          victim_profile: { start: VICTIM_START, labels: VICTIM_FEATURES },
          weapon_hints: { start: WEAPON_START, labels: WEAPON_FEATURES },
        },
        top_sections: vocabulary.map(({ token, count }) => ({
          token,
          count,
          slot: sectionSlots[token],
        })),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  process.stdout.write('05 · writing signatures and NoSQL vector documents…\n')
  const signatures = await ParquetWriter.create('mo_signatures', COLUMNS)
  const vectors = new JsonlWriter(VECTORS_PATH)
  let withSections = 0
  let withWeapons = 0
  let processed = 0

  for (const row of rows) {
    const acts = parseActSections(row['act_section'])
    const sections = sectionTokens(acts)
    const selectedSections = sections.filter((section) => topSections.has(section))
    const placeTokens = premiseTokens(row['place_of_offence'])
    const band = timeBand(row['estimated_occurrence_hour'])
    const victims = victimProfile(row)
    const weapons = weaponHints(row)
    const vector = buildVector(
      sections,
      topSections,
      placeTokens,
      band,
      victims,
      weapons,
    )
    const incidentId = String(row['incident_id'])
    const documentId = `mo:${incidentId}`
    if (sections.length > 0) withSections++
    if (weapons.length > 0) withWeapons++

    await signatures.write({
      incident_id: incidentId,
      case_ref: row['case_ref'],
      acts_json: JSON.stringify(acts),
      sections_json: JSON.stringify(sections),
      top_sections_json: JSON.stringify(selectedSections),
      premise_tokens_json: JSON.stringify(placeTokens),
      time_band: band,
      victim_profile_json: JSON.stringify(victims),
      weapon_hints_json: JSON.stringify(weapons),
      vector_document_id: documentId,
      vector_dimensions: VECTOR_DIMENSIONS,
      source_authority: 'third_party_mirror',
      transformation: 'derived',
      method: 'mo_signature_v1',
      source_checksum: inputChecksum,
      generation_version: GENERATION_VERSION,
    })
    await vectors.write({
      id: documentId,
      incident_id: incidentId,
      dimensions: 64,
      layout: 'mo64_v1',
      vector,
      source_authority: 'third_party_mirror',
      transformation: 'derived',
      method: 'mo_signature_v1',
      source_checksum: inputChecksum,
      generation_version: GENERATION_VERSION,
    })
    processed++
    if (processed % 100_000 === 0) {
      process.stdout.write(`  … ${processed.toLocaleString()} signatures\n`)
    }
  }

  const signatureRows = await signatures.finish(SIGNATURES_PATH)
  const vectorRows = await vectors.finish()
  await recordOutput(
    '05_mo_signature',
    VOCABULARY_PATH,
    vocabulary.length,
    [{ path: INPUT_PATH, sha256: inputChecksum }],
    {
      dimensions: VECTOR_DIMENSIONS,
      section_vocabulary: vocabulary.length,
      section_encoding: 'stable_feature_hash',
    },
  )
  await recordOutput(
    '05_mo_signature',
    SIGNATURES_PATH,
    signatureRows,
    [
      { path: INPUT_PATH, sha256: inputChecksum },
      { path: VOCABULARY_PATH, sha256: await sha256File(VOCABULARY_PATH) },
    ],
    { with_sections: withSections, with_weapon_hints: withWeapons },
  )
  await recordOutput(
    '05_mo_signature',
    VECTORS_PATH,
    vectorRows,
    [
      { path: INPUT_PATH, sha256: inputChecksum },
      { path: VOCABULARY_PATH, sha256: await sha256File(VOCABULARY_PATH) },
    ],
    { collection: 'mo_vectors', dimensions: VECTOR_DIMENSIONS, layout: 'mo64_v1' },
  )

  await mkdir(OUTPUT.reports, { recursive: true })
  await writeFile(
    resolve(OUTPUT.reports, 'a7_mo_signature.md'),
    [
      '# A7 / 05 — MO signatures',
      '',
      '**DRIFT** — the source wording asks for both a 64-dimensional vector and',
      'one-hot top-200 sections, which cannot coexist literally. All 200 signals',
      'are retained through deterministic feature hashing into 32 documented slots.',
      '',
      `- Signature rows: **${signatureRows.toLocaleString()}**`,
      `- NoSQL vector documents: **${vectorRows.toLocaleString()}**`,
      `- Rows with parsed act/section signals: **${withSections.toLocaleString()}**`,
      `- Rows with text-supported weapon hints: **${withWeapons.toLocaleString()}**`,
      '- Vector layout: `mo64_v1`',
      '',
      'The vocabulary artifact records every top section, frequency, and hash slot.',
      'Weapon features are text-derived hints, not recorded weapon facts.',
      '',
    ].join('\n'),
    'utf8',
  )

  if (signatureRows !== 425_408 || vectorRows !== 425_408) {
    throw new Error(
      `MO row reconciliation failed: signatures=${signatureRows}, vectors=${vectorRows}`,
    )
  }
  process.stdout.write(
    `05 complete in ${((Date.now() - started) / 1000).toFixed(1)}s — ` +
      `${signatureRows.toLocaleString()} signatures · ${vocabulary.length} top sections\n`,
  )
}

main().catch((error: unknown) => {
  process.stderr.write(`05 failed: ${String(error)}\n`)
  process.exitCode = 1
})
