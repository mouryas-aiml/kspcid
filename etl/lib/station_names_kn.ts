/**
 * Kannada display labels for the 106 station jurisdictions (BUILD_SPEC §7.5 §1).
 *
 * The repository carries no Kannada station name in any form: neither
 * `jurisdictions.geojson` nor `stations.parquet` nor the FIR mirror has one.
 * The only Kannada in the tree is incidental OSM data — `bengaluru_osm_overpass.json`
 * holds 28,117 `name:kn` tags, 43 of them on `amenity=police` features.
 *
 * Two tiers, and nothing else:
 *
 *   1. `amenity=police` + `name:kn` — the feature names an actual police
 *      station, so the tag is the station's own Kannada name. `normalized`.
 *
 *   2. Any other feature whose normalized English name matches the station's —
 *      almost always the locality the station is named after. Its `name:kn` is
 *      the *locality* name, so it is composed with a constant station suffix to
 *      make a display label. That composition is a derivation, not an official
 *      name, and is tagged `derived` so the chip says so.
 *
 * There is deliberately no fuzzy matching. Levenshtein over Bengaluru place
 * names produces confident-looking wrong answers — `Kothanur` and `Kodihalli`
 * are two edits apart and are different places — and publishing a wrong Kannada
 * name on a police document is worse than publishing none. Anything unmatched
 * or ambiguous is written to a review CSV for a human, and renders in English
 * until someone approves it.
 */
import { readFile } from 'node:fs/promises'

import { METHOD, type MethodId, type Transformation } from './provenance.js'

/** A resolved Kannada label, or the reason there isn't one. */
export interface KannadaName {
  readonly station_code: string
  readonly station_name: string
  readonly name_kn: string
  readonly transformation: Extract<Transformation, 'normalized' | 'derived'>
  readonly method: MethodId
  readonly confidence: number
  readonly osm_source_name: string
}

export interface KannadaMatchResult {
  readonly names: ReadonlyMap<string, KannadaName>
  /** Every station with no approved label, with the reason. */
  readonly unresolved: readonly {
    readonly station_code: string
    readonly station_name: string
    readonly reason: 'no_match' | 'ambiguous'
  }[]
  readonly osm_features_with_kannada: number
}

/** Kannada for "police station". Appended to a locality label in tier 2. */
const STATION_SUFFIX_KN = 'ಪೊಲೀಸ್ ಠಾಣೆ'

/**
 * Generic Kannada unit words: the several spellings of "police" in use across
 * OSM, plus "ಠಾಣೆ"/"ಟಾಣೆ" (station).
 *
 * Some features tag `name:kn` with *only* these words and no place name — the
 * Kannada equivalent of a feature called plainly "Police Station". Composing
 * one of those with the suffix produced `ಆರಕ್ಷಕ ಠಾಣೆ ಪೊಲೀಸ್ ಠಾಣೆ`, literally
 * "police station police station", on R.T. Nagar. So a candidate must carry a
 * place name once the unit words are removed, and a value that already ends in
 * "ಠಾಣೆ" is a station name already and must not be suffixed again.
 */
const KN_UNIT_WORDS = /(ಆರಕ್ಷಕ|ಪೊಲೀಸ್|ಪೋಲೀಸ್|ಪೋಲಿಸ್|ಪೊಲಿಸ್|ಠಾಣೆ|ಟಾಣೆ|ಸಂಚಾರ)/g
const KN_STATION_WORD = /(ಠಾಣೆ|ಟಾಣೆ)/

/** The place-name residue once unit words are stripped. Empty means unusable. */
function kannadaPlaceResidue(value: string): string {
  return value.replace(KN_UNIT_WORDS, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Build the display label, or `null` when the tag carries no place name.
 * A value that already names a station is kept verbatim rather than suffixed.
 */
function composeLabel(nameKn: string): string | null {
  const trimmed = nameKn.trim()
  if (!kannadaPlaceResidue(trimmed)) return null
  return KN_STATION_WORD.test(trimmed) ? trimmed : `${trimmed} ${STATION_SUFFIX_KN}`
}

/**
 * Collapse an English place label to a comparison key.
 *
 * Station names in the FIR mirror and in OSM disagree on unit words and
 * spacing but agree on the place — `Jayanagar Police Station`, `Jayanagar PS`
 * and `Jayanagar` are one place. Unit words are therefore removed before
 * comparison, not treated as part of the name.
 *
 * "Traffic" is deliberately NOT removed. A traffic station is a different unit
 * from the territorial station of the same name, and the 106 jurisdictions here
 * are all territorial. Stripping it matched `Kamakshipalya Traffic Police
 * Station` onto `Kamakshipalya` and labelled a territorial station
 * `ಕಾಮಾಕ್ಷಿಪಾಳ್ಯ ಸಂಚಾರ ಪೊಲೀಸ್ ಠಾಣೆ` — the traffic station's name.
 */
export function normalizePlaceKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(police station|police|station|ps)\b/g, ' ')
    .replace(/[^a-z]/g, '')
}

interface OsmElement {
  readonly tags?: Readonly<Record<string, string>>
}

interface Candidate {
  readonly name_kn: string
  readonly source_name: string
}

export async function resolveKannadaNames(
  osmPath: string,
  stations: readonly { readonly station_code: string; readonly station_name: string }[],
): Promise<KannadaMatchResult> {
  const raw = JSON.parse(await readFile(osmPath, 'utf8')) as { elements?: readonly OsmElement[] }
  const elements = raw.elements ?? []

  // Tier 1 beats tier 2, so they are indexed separately rather than merged.
  const policeIndex = new Map<string, Candidate[]>()
  const localityIndex = new Map<string, Candidate[]>()
  let withKannada = 0

  for (const element of elements) {
    const tags = element.tags
    if (!tags) continue
    const nameKn = tags['name:kn']
    const name = tags['name']
    if (!nameKn || !name) continue
    withKannada += 1
    const key = normalizePlaceKey(name)
    if (!key) continue
    const index = tags['amenity'] === 'police' ? policeIndex : localityIndex
    const bucket = index.get(key)
    const candidate: Candidate = { name_kn: nameKn.trim(), source_name: name }
    if (bucket) bucket.push(candidate)
    else index.set(key, [candidate])
  }

  /**
   * A key is usable only when every feature under it agrees on the Kannada
   * spelling. Two different spellings mean we cannot tell which is the place
   * the station is named after, so the station goes to review instead.
   */
  const agreedValue = (bucket: readonly Candidate[] | undefined): Candidate | 'ambiguous' | null => {
    if (!bucket || bucket.length === 0) return null
    const first = bucket[0]!
    return bucket.every((entry) => entry.name_kn === first.name_kn) ? first : 'ambiguous'
  }

  const names = new Map<string, KannadaName>()
  const unresolved: { station_code: string; station_name: string; reason: 'no_match' | 'ambiguous' }[] =
    []

  for (const station of stations) {
    const key = normalizePlaceKey(station.station_name)
    const police = agreedValue(policeIndex.get(key))

    // A police feature names the station directly, so its tag is used as it
    // stands — but it still has to carry a place name, not just unit words.
    if (police && police !== 'ambiguous' && kannadaPlaceResidue(police.name_kn)) {
      names.set(station.station_code, {
        station_code: station.station_code,
        station_name: station.station_name,
        name_kn: police.name_kn.trim(),
        transformation: 'normalized',
        method: METHOD.station_name_kn_police_v1,
        confidence: 0.95,
        osm_source_name: police.source_name,
      })
      continue
    }

    const locality = agreedValue(localityIndex.get(key))
    const composed = locality && locality !== 'ambiguous' ? composeLabel(locality.name_kn) : null
    if (locality && locality !== 'ambiguous' && composed) {
      names.set(station.station_code, {
        station_code: station.station_code,
        station_name: station.station_name,
        // A locality label plus a constant suffix. Not an official name.
        name_kn: composed,
        transformation: 'derived',
        method: METHOD.station_name_kn_locality_v1,
        confidence: 0.7,
        osm_source_name: locality.source_name,
      })
      continue
    }

    unresolved.push({
      station_code: station.station_code,
      station_name: station.station_name,
      reason: police === 'ambiguous' || locality === 'ambiguous' ? 'ambiguous' : 'no_match',
    })
  }

  return { names, unresolved, osm_features_with_kannada: withKannada }
}

/**
 * The review file. Every station appears, resolved or not, so a reviewer can
 * correct a bad automatic match as easily as fill a blank one. Rows are only a
 * proposal — approving one means moving it into the override file by hand.
 */
export function renderReviewCsv(result: KannadaMatchResult, stations: readonly { readonly station_code: string; readonly station_name: string }[]): string {
  const header =
    '# Proposed Kannada display labels (BUILD_SPEC §7.5 §1). NOT authoritative.\n' +
    '# tier=police   : OSM amenity=police carried its own name:kn. Transformation "normalized".\n' +
    '# tier=locality : a locality name:kn composed with a constant station suffix. Transformation "derived".\n' +
    '# tier=review   : no agreed match. Renders in English until a human supplies a name.\n' +
    '#\n' +
    '# Nothing here is transliterated or invented. An empty name_kn is the correct\n' +
    '# outcome when the source is silent — do not fill one in by guessing.\n' +
    'station_code,station_name,tier,confidence,name_kn,osm_source_name\n'

  const escape = (value: string): string =>
    /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value

  const rows = stations.map((station) => {
    const match = result.names.get(station.station_code)
    if (!match) {
      const reason = result.unresolved.find((entry) => entry.station_code === station.station_code)
      return [station.station_code, escape(station.station_name), `review:${reason?.reason ?? 'no_match'}`, '', '', ''].join(',')
    }
    const tier = match.transformation === 'normalized' ? 'police' : 'locality'
    return [
      match.station_code,
      escape(match.station_name),
      tier,
      String(match.confidence),
      escape(match.name_kn),
      escape(match.osm_source_name),
    ].join(',')
  })

  return `${header}${rows.join('\n')}\n`
}
