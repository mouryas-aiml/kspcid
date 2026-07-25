/**
 * Typed shim over the frozen legacy choice function.
 *
 * BUILD_SPEC §6.1 requires reusing `scripts/lib.mjs` rather than reimplementing
 * it: the HMAC-SHA256 stateless choice function is already written and tested,
 * and reusing it is what makes every derived value regenerate bit-identically.
 *
 * Only the symbols below cross the app/ boundary. `occurrenceTimestamp` and
 * `parseSourceDate` are LA-donor legacy that assume a source with an occurrence
 * timestamp; the Karnataka FIR mirror has none (§6.0b), so they are deliberately
 * not surfaced into the KSPCID namespace.
 */
import { v5 as uuidv5 } from 'uuid'

// Frozen donor module: plain JS, resolved via allowJs. Types are inferred, then
// narrowed to the explicit contract below so a change over there fails here.
import * as legacy from '../../scripts/lib.mjs'

interface LegacyLib {
  sha256File: (path: string) => Promise<string>
  sha256Text: (value: string) => string
  stableUint64: (stage: string, stableKey: string, namespace?: string) => bigint
  stableIndex: (stage: string, stableKey: string, namespace: string, length: number) => number
  normalizeName: (value: unknown) => string
}

const lib = legacy as LegacyLib

/**
 * KSPCID's own generation version. Recorded on every derived row's Provenance
 * (§6.1) and mixed into every choice-function key below, so that a version bump
 * is a visible, deliberate change to derived values rather than a silent one.
 */
export const GENERATION_VERSION = 'kspcid-etl-1.0.0'

/**
 * Frozen UUIDv5 namespace for KSPCID identifiers.
 * Derived once as `uuidv5('kspcid.etl.v1', uuidv5.URL)` and pinned as a literal
 * so it can never drift. Deliberately distinct from the donor pipeline's
 * namespace — a KSPCID incident_id and a donor record id must never collide.
 */
export const KSPCID_UUID_NAMESPACE = '1e5b9bdd-e9cc-533d-a6be-7fe885379695'

/**
 * The legacy `stableUint64` bakes in the donor's own GENERATION_VERSION and
 * GENERATION_SEED as module constants. We cannot change those without forking
 * the tested implementation, so instead KSPCID's version is prefixed onto the
 * stage string. The donor constants become a fixed pepper; the KSPCID version
 * genuinely participates in the key.
 */
function scopedStage(stage: string): string {
  return `${GENERATION_VERSION}:${stage}`
}

/** SHA-256 of a file's bytes. Async — streams, so it handles the 573MB source. */
export const sha256File = (path: string): Promise<string> => lib.sha256File(path)

/** SHA-256 of a string. */
export const sha256Text = (value: string): string => lib.sha256Text(value)

/** Deterministic 64-bit draw for `(stage, key, namespace)`. */
export function stableUint64(stage: string, stableKey: string, namespace = ''): bigint {
  return lib.stableUint64(scopedStage(stage), stableKey, namespace)
}

/** Deterministic index into a stably-sorted candidate list of `length` items. */
export function stableIndex(
  stage: string,
  stableKey: string,
  namespace: string,
  length: number,
): number {
  return lib.stableIndex(scopedStage(stage), stableKey, namespace, length)
}

/**
 * Station-name normalization. Strips `police`, `station`, `ps` and `traffic`
 * tokens plus punctuation — exactly what tier 1 of the §6.4 crosswalk needs.
 */
export const normalizeName = (value: unknown): string => lib.normalizeName(value)

/**
 * The stable key for a source row: source file checksum + one-based row number.
 * Every deterministic decision about a row keys off this string, so a change to
 * the source file changes every derived value — which is the point.
 */
export function sourceRowKey(sourceChecksum: string, sourceRowNumber: number): string {
  return `${sourceChecksum}|${sourceRowNumber}`
}

/**
 * `incident_id` — the internal join key (§6.0a).
 *
 * The FIR mirror has no case identifier of any kind: 34 columns, none of them a
 * case key. `KGID` is the investigating officer's government ID and is 1:1 with
 * `IOName` — using it as a case key is a defect. So the join key is synthesised
 * deterministically from the row's position in a checksummed file.
 */
export function incidentId(sourceChecksum: string, sourceRowNumber: number): string {
  return uuidv5(sourceRowKey(sourceChecksum, sourceRowNumber), KSPCID_UUID_NAMESPACE)
}

/**
 * Division codes for the case reference. Initials alone collide
 * (North/North East, South/South East, West/Whitefield), so the ambiguous ones
 * take two characters. `E` and `W` match the §6.0a / §7.3 examples.
 */
export const DIVISION_CODE: Readonly<Record<string, string>> = Object.freeze({
  Central: 'C',
  East: 'E',
  North: 'N',
  'North East': 'NE',
  South: 'S',
  'South East': 'SE',
  West: 'W',
  Whitefield: 'WF',
  /**
   * Units with no jurisdiction polygon — city-wide investigative units and the
   * ten territorial stations the KSRSAC file does not cover. They have no
   * division to encode, and guessing one from the unit name would put a
   * fabricated jurisdiction into a user-visible identifier.
   */
  Unassigned: 'U',
})

const CASE_REF_SPACE = 1_000_000

/**
 * `case_ref` — a human-readable demonstration reference, e.g. `DEMO-BLR-E-2023-004182`.
 *
 * Displayed as "Case reference" (§6.0a) — never as an FIR number, lint-truth-ok: no-fir-number
 * because the source has none. Anything resembling `FIR 0142/2023` is a defect. The
 * `DEMO-` prefix keeps it visually distinguishable from a real reference, and it
 * carries `transformation: 'generated'`.
 *
 * The numeric segment is derived from the incident_id via the choice function —
 * NOT from a running counter. A counter would depend on row order and chunk
 * size, which breaks bit-identical regeneration (§14.6). Collisions inside a
 * (division, year) bucket resolve by deterministic re-probe.
 */
export function caseRef(
  incidentIdValue: string,
  division: string,
  firYear: number,
  taken: Set<string>,
): string {
  const code = DIVISION_CODE[division]
  if (!code) throw new Error(`No case-reference code for division: ${division}`)
  const prefix = `DEMO-BLR-${code}-${firYear}-`

  for (let probe = 0; probe < 64; probe++) {
    const draw = stableIndex('case_ref', incidentIdValue, String(probe), CASE_REF_SPACE)
    const ref = `${prefix}${String(draw).padStart(6, '0')}`
    if (!taken.has(ref)) {
      taken.add(ref)
      return ref
    }
  }
  throw new Error(`case_ref probe exhausted for ${incidentIdValue} in ${prefix}`)
}
