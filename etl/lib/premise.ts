/**
 * Premise classification for the FIR `Place of Offence` free text
 * (BUILD_SPEC §6.3, §6.4 step 03).
 *
 * Used to bias inferred-coordinate resolution toward a road anchor of a
 * plausible kind: a house-breaking gets a residential road, a parking theft
 * gets a commercial anchor. It is a *bias*, never a filter — if a station has
 * no anchor of the matching class the choice falls back to the full pool, so no
 * incident is ever dropped for lack of a matching premise.
 *
 * `mappings/premise_mapping.csv` in the legacy tree is keyed on **LA premise
 * codes** and is not reusable here; this is Karnataka free text.
 *
 * 326,347 distinct `Place of Offence` strings exist. Full normalization of them
 * is explicitly deferred (§13, a Zia Text Analytics candidate); this classifier
 * only needs to pick an anchor class, so coarse and deterministic beats clever.
 *
 * Classes correspond exactly to `anchor_kind` values in
 * `reference/processed/anchors.json`.
 */
export type PremiseClass =
  | 'residential'
  | 'commercial'
  | 'transit'
  | 'public_institutional'
  | 'intersection'
  | 'outdoor'
  | 'built_other'

/**
 * Ordered — the first match wins, so the more specific patterns come first.
 * A market or a bus stand sitting on a main road should classify as commercial
 * or transit, not as the road that the address also mentions.
 */
const RULES: ReadonlyArray<readonly [RegExp, PremiseClass]> = [
  [/\b(bus\s*(stand|stop|depot)|railway|rly|metro|station|airport|terminal|depot)\b/i, 'transit'],
  [
    /\b(school|college|university|hospital|clinic|temple|church|mosque|masjid|dargah|math|govt|government|court|police|library|park|playground|stadium|anganwadi)\b/i,
    'public_institutional',
  ],
  [
    /\b(shop|store|market|mall|hotel|lodge|bar|restaurant|hotel|bank|atm|showroom|complex|office|godown|garage|workshop|petrol|bunk|factory|industri|commercial|parking|theatre|cinema|wine|bakery|medical)\b/i,
    'commercial',
  ],
  [
    /\b(house|home|residence|residential|flat|apartment|apartments|quarters|nilaya|building|layout|colony|badavane)\b/i,
    'residential',
  ],
  [/\b(junction|circle|signal|cross\s*road|crossing|underpass|flyover)\b/i, 'intersection'],
  [
    /\b(road|rd|street|main|cross|highway|nh|sh|ring\s*road|orr|lane|footpath|bridge|nala|lake|ground|field|open|vacant)\b/i,
    'outdoor',
  ],
]

/**
 * Classify a `Place of Offence` string.
 *
 * Defaults to `outdoor` (named road) — the largest anchor class and the least
 * specific claim available. Defaulting to a *specific* class would assert a
 * premise the text does not support.
 */
export function classifyPremise(place: unknown): PremiseClass {
  const text = String(place ?? '')
  for (const [pattern, cls] of RULES) {
    if (pattern.test(text)) return cls
  }
  return 'outdoor'
}
