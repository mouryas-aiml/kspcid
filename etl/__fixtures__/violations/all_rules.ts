/**
 * DELIBERATE VIOLATIONS — do not fix, do not import, never ship.
 *
 * One instance of every rule in `lint_data_truth.ts`. The linter scans this
 * directory as a self-test: any rule that fails to fire here is a dead regex,
 * and the run fails just as loudly as a real violation would.
 *
 * This directory is in SKIP_DIRS, so it is never scanned as production code.
 *
 * When adding a rule, add its violation here in the same commit.
 */

// rule: no-occurred-at
export const occurred_at = '2023-08-12T21:14:00+05:30'

// rule: no-kgid-as-key
export const case_id = row.KGID

// rule: no-fir-number
export const label = 'FIR Number'

// rule: no-incident-count-copy
export const heading = 'incidents this week'

// rule: no-occurrence-as-fact
export const blurb = 'crimes occurred between 8 and 11pm'

// rule: no-registration-delay
export const metric = 'time to registration'

// rule: no-victim-age-claim
export const victimAge = 'senior citizen'

// rule: no-beat-geometry
export const beatPolygon = loadBeatGeometry()

// rule: no-single-provenance-enum
export type Origin = 'real' | 'official' | 'modeled' | 'demo'

// rule: no-official-ksp-for-fir
export const firProvenance = { source_authority: 'official_ksp' }

// rule: no-crimes-prevented
export const score = { crimes_prevented: 14 }

// rule: no-protected-characteristics
export const features = ['caste_group', 'religion_weight']

// rule: no-mclp-solver-claim
export const optimizerLabel = 'exact MCLP solver'
