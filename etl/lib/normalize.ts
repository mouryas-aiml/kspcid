/**
 * Source normalization for the Karnataka FIR mirror (BUILD_SPEC §6.4 step 01).
 *
 * Everything here is `transformation: 'normalized'` — cleaned, mapped,
 * deduplicated, no new information. Anything that adds information belongs in
 * a later step under `derived` or `inferred`.
 */

/**
 * Canonical case stages.
 *
 * §6.4 calls for "a canonical 11-value enum". The source actually carries 13
 * distinct terminal states across Bengaluru City, and none of them can be
 * dropped or silently merged:
 *
 *   - `Un Traced` (1,510) is distinct from `Undetected` (92,874) in the source.
 *     §7.4's Sankey draws them as one branch — that is a *presentation* merge;
 *     the data layer keeps the distinction it was given.
 *   - `BoundOver` (9,017) and `Other Disposal` (4,527) are real terminal states
 *     with 13,544 rows between them. Folding them into "Other" would break the
 *     exact `GROUP BY` reconciliation §7.4 demands.
 *
 * Recorded as a DRIFT against the spec's "11" in reports/a00_data_truth.md.
 * There is no `Registered` or `Chargesheeted` value: the source is a
 * terminal-state snapshot with no transition history (§6.0).
 */
export const CASE_STAGE = [
  'under_investigation',
  'pending_trial',
  'traced',
  'un_traced',
  'undetected',
  'convicted',
  'discharged_acquitted',
  'abated',
  'false_case',
  'compounded',
  'bound_over',
  'other_disposal',
  'transferred',
] as const

export type CaseStage = (typeof CASE_STAGE)[number]

const STAGE_MAP: Readonly<Record<string, CaseStage>> = Object.freeze({
  'under investigation': 'under_investigation',
  'pending trial': 'pending_trial',
  traced: 'traced',
  'un traced': 'un_traced',
  untraced: 'un_traced',
  undetected: 'undetected',
  convicted: 'convicted',
  'dis/acq': 'discharged_acquitted',
  abated: 'abated',
  'false case': 'false_case',
  compounded: 'compounded',
  boundover: 'bound_over',
  'other disposal': 'other_disposal',
})

export interface StageResult {
  stage: CaseStage
  /**
   * For transfers, the destination named in the source string — e.g.
   * `Transfered :UI( CCB Bengaluru City Police)` → `CCB Bengaluru City Police`.
   * The source misspells "Transferred"; we keep the information rather than
   * discarding it with the label.
   */
  transfer_target: string | null
}

/**
 * Map a raw `FIR_Stage` to the canonical enum. Throws on an unrecognised value
 * — §6.4 requires zero silent fallbacks, and a stage quietly bucketed as
 * "other" would corrupt the Justice Pipeline totals.
 */
export function normalizeStage(raw: unknown): StageResult {
  const value = String(raw ?? '').trim()

  // 44 distinct transfer strings, all of the form `Transfered :UI( <target>)`.
  const transfer = /^transfer+ed\s*:\s*UI\s*\((.*)\)\s*$/i.exec(value)
  if (transfer) {
    return { stage: 'transferred', transfer_target: (transfer[1] ?? '').trim() || null }
  }

  const mapped = STAGE_MAP[value.toLowerCase().replace(/\s+/g, ' ')]
  if (!mapped) throw new Error(`Unmapped FIR_Stage: ${JSON.stringify(value)}`)
  return { stage: mapped, transfer_target: null }
}

/**
 * Crime group / crime head normalization.
 *
 * **The leading space on `' CYBER CRIME'` is real** and present in the source
 * (§6.4). Trimming is not cosmetic here: without it, cyber rows split into two
 * groups and the 15.19% caseload share in §7.7 comes out wrong.
 *
 * Case is preserved after trimming — these are display labels, and the source
 * casing is meaningful (`THEFT` vs `Others`). Matching is done on the folded
 * form via `foldLabel`.
 */
export function normalizeLabel(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Case-folded key for comparison and grouping. Never displayed. */
export function foldLabel(raw: unknown): string {
  return normalizeLabel(raw).toLowerCase()
}

/**
 * Complaint mode. The source carries 10 variants; `& Organised` is a suffix on
 * the base mode rather than a mode of its own.
 *
 * `is_online` is true only for `Online` — 1,521 Bengaluru rows, 0.36%.
 * `Distress call over phone` is a phone call, not an online registration.
 * §7.7 builds a registration-mode finding on this field, so the share must not
 * be inflated by folding adjacent modes into it.
 */
export interface ComplaintMode {
  mode: string
  is_organised: boolean
  is_online: boolean
}

export function normalizeComplaintMode(raw: unknown): ComplaintMode {
  const value = normalizeLabel(raw)
  const organised = /\s*&\s*Organised$/i.test(value)
  const mode = value.replace(/\s*&\s*Organised$/i, '').trim()
  return { mode, is_organised: organised, is_online: mode.toLowerCase() === 'online' }
}

/**
 * Numeric coercion with an explicit failure channel.
 *
 * Returns `null` rather than 0 for unparseable input: a victim count that could
 * not be read is not a count of zero, and silently coercing it would understate
 * every victim total. Callers route nulls to `ingest_rejects.csv`.
 */
export function coerceCount(raw: unknown): number | null {
  const value = String(raw ?? '')
    .trim()
    // Same float-formatting artifact that affects KGID — `3.0` is the integer 3.
    // Tolerated here because the value is unambiguous; anything genuinely
    // fractional still fails below rather than being silently truncated.
    .replace(/\.0+$/, '')
  if (value === '') return 0
  if (!/^-?\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/**
 * KGID — the investigating officer's Karnataka Government ID.
 *
 * **Never a case key** (§6.0a). It is ~1:1 with `IOName`; anything treating it
 * as a case identifier is a defect, and `lint:truth` fails the build on it.
 *
 * 101,540 Bengaluru rows (23.9%) store it with a trailing `.0` — a float
 * formatting artifact from whatever produced the mirror. Left alone,
 * `1898733` and `1898733.0` count as two different officers and every
 * officer-level aggregate is inflated: raw distinct KGID is 6,046, but 5,216
 * after this normalization.
 */
export function normalizeKgid(raw: unknown): string | null {
  const value = String(raw ?? '').trim()
  if (value === '') return null
  const stripped = value.replace(/\.0+$/, '')
  return /^\d+$/.test(stripped) ? stripped : null
}

/**
 * Officer name with the parenthesised rank suffix removed —
 * `R S BIRADAR   (PI)` → `R S BIRADAR`. Rank is captured separately.
 *
 * §14.5 requires officer names to be aliased on every public-facing screen;
 * this normalizes the join key only, it does not authorise display.
 */
export function normalizeOfficerName(raw: unknown): { name: string; rank: string | null } {
  const value = normalizeLabel(raw)
  const match = /^(.*?)\s*\((PI|PSI|ASI|HC|PC|CPI|ACP|DCP|SI|CHC|WPC|WHC)\)\s*$/i.exec(value)
  if (!match) return { name: value, rank: null }
  return { name: (match[1] ?? '').trim(), rank: (match[2] ?? '').toUpperCase() }
}

/**
 * Registration date from `FIR_YEAR` / `FIR_MONTH` / `FIR_Day`.
 *
 * This is when the FIR was **registered**, not when the offence took place
 * (§6.0b). The source carries no occurrence timestamp, and no `occurred_at` lint-truth-ok: no-occurred-at
 * field exists anywhere in this codebase.
 * Returns an ISO date (no time component —
 * fabricating one would be exactly the error §6.0b forbids).
 */
export function registeredOn(year: unknown, month: unknown, day: unknown): string | null {
  const y = coerceCount(year)
  const m = coerceCount(month)
  const d = coerceCount(day)
  if (y === null || m === null || d === null) return null
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null

  // Reject impossible calendar dates (e.g. 31 February) rather than letting
  // Date roll them forward into the next month.
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** ISO week key `YYYY-Www`, the grouping §6.4 step 06 baselines on. */
export function isoWeek(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
