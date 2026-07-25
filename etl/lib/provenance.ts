/**
 * The two-axis provenance model (BUILD_SPEC §6.1).
 *
 * A single origin enum conflates *who vouches for the data* with *what we did
 * to it*. Splitting them is what lets the UI distinguish a third-party mirror
 * from an official source, and a normalized value from an inferred one.
 *
 * Never reintroduce a single `real | official | modeled | demo` enum (§5.6).
 */
import { GENERATION_VERSION } from './hash.js'

export { GENERATION_VERSION }

/** Who vouches for the data. Sets the chip colour. */
export type SourceAuthority =
  | 'official_ksp' // KSP monthly reviews, OpenCity KSP tables
  | 'official_open_data' // KSRSAC / OpenCity jurisdictions, station KML
  | 'third_party_mirror' // the Kaggle Karnataka FIR CSV
  | 'open_reference' // OpenStreetMap
  | 'generated_demo' // entities, rosters, scenarios

/** What we did to it. Sets the chip label. */
export type Transformation =
  | 'verbatim' // unchanged from source
  | 'normalized' // cleaned, mapped, deduplicated — no new information
  | 'derived' // computed from source values
  | 'inferred' // estimated where the source is silent
  | 'generated' // created; no source counterpart

export interface Provenance {
  source_authority: SourceAuthority
  transformation: Transformation
  /** 0..1, only where the method actually produces one. */
  confidence?: number
  /** Stable method id from METHOD below. */
  method?: MethodId
  source_checksum: string
  generation_version: string
}

/**
 * Stable method identifiers. These appear in the ProvenanceChip hover popover,
 * which §5.6 calls the highest-credibility element in the product — an id here
 * must correspond to a real, documented derivation in a named ETL step.
 */
export const METHOD = {
  /** 02 — 178 FIR unit names reconciled to 106 jurisdiction polygons. */
  crosswalk_v1: 'crosswalk_v1',
  /** 03 — coordinate resolved to a road anchor inside the assigned station. */
  geo_anchor_v1: 'geo_anchor_v1',
  /** 03 — reported coordinate kept but reassigned to an adjacent polygon. */
  geo_boundary_correction_v1: 'geo_boundary_correction_v1',
  /** 02 — generated demonstration case reference. */
  case_ref_v1: 'case_ref_v1',
  /** 04 — hour-of-day sampled from the fitted crime-head × premise × weekday distribution. */
  time_model_v1: 'time_model_v1',
} as const

export type MethodId = (typeof METHOD)[keyof typeof METHOD]

/**
 * Build a Provenance record. `generation_version` is always KSPCID's own, and
 * `source_checksum` is always the checksum of the file the value came from — so
 * every derived value is traceable to an exact input (§14.6).
 */
export function provenance(
  source_authority: SourceAuthority,
  transformation: Transformation,
  source_checksum: string,
  extra: { confidence?: number; method?: MethodId } = {},
): Provenance {
  const record: Provenance = {
    source_authority,
    transformation,
    source_checksum,
    generation_version: GENERATION_VERSION,
  }
  if (extra.confidence !== undefined) record.confidence = extra.confidence
  if (extra.method !== undefined) record.method = extra.method

  // §14.3/§14.6: an inferred or generated value without a method id cannot be
  // explained in the chip popover, which makes it indefensible under questioning.
  if ((transformation === 'inferred' || transformation === 'generated') && !record.method) {
    throw new Error(`Provenance '${transformation}' requires a method id`)
  }
  return record
}

/**
 * The FIR mirror is a third-party Kaggle upload, NOT an official KSP portal
 * export (§6.2). Presenting it as an official government release is the single
 * easiest claim for a judge to check and disprove.
 */
export function firMirror(
  transformation: Transformation,
  source_checksum: string,
  extra: { confidence?: number; method?: MethodId } = {},
): Provenance {
  return provenance('third_party_mirror', transformation, source_checksum, extra)
}
