/**
 * Data-truth linter (BUILD_SPEC §6.0, §12 P0, §14).
 *
 * A00 measured the source once. This keeps its conclusions true as the rest of
 * the build lands: it fails the build on the specific claims the spec forbids,
 * so seven §12 acceptance checkboxes become a command that either passes or
 * does not.
 *
 * Scope is `app/` only. The legacy LA-donor pipeline lives outside this
 * directory and is out of scope *structurally* — there is no allowlist for it,
 * because a list is a thing someone can widen.
 *
 * A genuine exception is declared inline and stays visible in review:
 *
 *   const label = 'Case reference'  // lint-truth-ok: no-fir-number — explaining the rule
 *
 *   npm run lint:truth
 */
import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

import { APP_ROOT } from './00_config.js'

interface Rule {
  id: string
  /** What is wrong, in the words the spec uses. */
  why: string
  spec: string
  pattern: RegExp
  /** Only these extensions; omit for all text files. */
  extensions?: readonly string[]
}

const RULES: readonly Rule[] = [
  {
    id: 'no-occurred-at',
    why: 'The source has no occurrence timestamp — only a registration date. Use `registered_on`, or `estimated_occurrence_hour` where the time model has run.',
    spec: '§6.0b, §12',
    pattern: /\boccurred[_-]?at\b|\boccurredAt\b/i,
  },
  {
    id: 'no-kgid-as-key',
    why: 'KGID is the investigating officer’s government ID, ~1:1 with IOName. It is never a case key — use `incident_id`.',
    spec: '§6.0a, §12',
    pattern: /\b(case[_-]?(id|key|ref)|incident[_-]?id)\b[^\n]{0,40}\bkgid\b|\bkgid\b[^\n]{0,20}\bas\b[^\n]{0,20}\b(case|incident|key)\b/i,
  },
  {
    id: 'no-fir-number',
    why: 'The file has no FIR number. Anything resembling `FIR 0142/2023` is a defect; the displayed label is “Case reference”.',
    spec: '§6.0a, §12',
    pattern: /\bFIR[\s_-]?(number|no\.?|num)\b/i,
  },
  {
    id: 'no-incident-count-copy',
    why: 'Rows are FIRs that were *registered*, not incidents that occurred. Write “FIRs registered this week”.',
    spec: '§6.0b',
    pattern: /\b(incidents|crimes)\s+(this|last|next|per)\s+(week|month|day|night)\b/i,
  },
  {
    id: 'no-occurrence-as-fact',
    why: 'An occurrence time is inferred, never recorded. Write “estimated occurrence 8–11pm (derived)”.',
    spec: '§6.0b',
    pattern: /\b(crimes?|incidents?|offences?)\s+occurred\b/i,
  },
  {
    id: 'no-registration-delay',
    why: 'Time to registration is not computable — there is no occurrence timestamp. Remove the feature rather than approximating it.',
    spec: '§6.0b, §12',
    pattern: /\b(time[\s_-]to[\s_-]registration|reporting[\s_-]delay|registration[\s_-]delay|report(ing)?[\s_-]lag)\b/i,
  },
  {
    id: 'no-victim-age-claim',
    why: 'Victim data is four counts only — male, female, boy, girl. There are no age bands and no senior-citizen field.',
    spec: '§6.0c, §12',
    pattern: /\bsenior[\s_-]citizen\b|\bvictim[\s_-]?age\b|\bage[\s_-](band|bracket|group)\b/i,
  },
  {
    id: 'no-beat-geometry',
    why: '1,129 beat names exist with no geometry. A beat may only be drawn as a hull of its own reported coordinates, tagged derived — never as official boundary.',
    spec: '§6.0, §12',
    pattern: /\bbeat[_-]?(polygon|geometry|boundar|shape|geojson)/i,
  },
  {
    id: 'no-single-provenance-enum',
    why: 'A single origin enum conflates who vouches for the data with what we did to it. Use the two-axis Provenance interface.',
    spec: '§6.1, §5.6',
    pattern: /['"]real['"]\s*\|\s*['"]official['"]|['"]modeled['"]\s*\|\s*['"]demo['"]/,
  },
  {
    id: 'no-official-ksp-for-fir',
    why: 'The FIR CSV is a third-party Kaggle mirror, not an official KSP export. Tag it `third_party_mirror`.',
    spec: '§6.2, §12',
    pattern: /\bfir\w*\s*[:=][^\n]{0,40}['"]official_ksp['"]|['"]official_ksp['"][^\n]{0,30}\bfir\b/i,
  },
  {
    id: 'no-crimes-prevented',
    why: 'That counterfactual cannot be established from this data. Score coverage, response, equity, reserve and efficiency — nothing else.',
    spec: '§8.5, §14.1',
    pattern: /\bcrimes?[\s_-]prevented\b|\bprevented[\s_-]crimes?\b|\bcrime[\s_-]prevention[\s_-]score\b/i,
  },
  {
    id: 'no-protected-characteristics',
    why: 'No caste, religion or ethnicity in any model, overlay or score. Risk attaches to places and times, never to populations.',
    spec: '§14.2',
    pattern: /\b(caste|religion|religious|ethnicity|ethnic)[_-]?(code|group|score|weight|feature|layer|filter)\b/i,
  },
  {
    id: 'no-mclp-solver-claim',
    why: 'The optimizer is a greedy + local-search heuristic, not an exact solver. Label it “MCLP-inspired heuristic”.',
    spec: '§8.6, §12',
    pattern: /\bMCLP\s+solver\b|\bexact\s+MCLP\b|\boptimal\s+MCLP\b/i,
  },
]

const SCAN_DIRS = ['etl', 'functions', 'client'] as const
const SKIP_DIRS = new Set(['node_modules', 'data', 'reports', '.staging', '.next', 'dist', 'build', '__fixtures__'])
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.css', '.html'])

interface Violation {
  file: string
  line: number
  rule: Rule
  text: string
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out // directory not created yet — later phases add functions/ and client/
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(full, out)
    } else if (TEXT_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
      out.push(full)
    }
  }
  return out
}

async function scan(files: readonly string[]): Promise<Violation[]> {
  const violations: Violation[] = []
  for (const file of files) {
    const content = await readFile(file, 'utf8')
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i]!
      for (const rule of RULES) {
        if (!rule.pattern.test(text)) continue
        // An inline suppression must name the rule, so exceptions stay reviewable.
        if (new RegExp(`lint-truth-ok:\\s*${rule.id}\\b`).test(text)) continue
        violations.push({ file, line: i + 1, rule, text: text.trim() })
      }
    }
  }
  return violations
}

/**
 * The rule catalogue necessarily contains every phrase it bans — its ids, its
 * patterns and its explanations all name them. Scanning itself would make the
 * linter permanently red for the sole reason that it documents its own rules.
 */
const SELF = resolve(APP_ROOT, 'etl/lint_data_truth.ts')

async function main(): Promise<void> {
  const files: string[] = []
  for (const dir of SCAN_DIRS) files.push(...(await walk(resolve(APP_ROOT, dir))))

  const violations = await scan(files.filter((f) => f !== SELF))

  // ── Self-test: prove every rule can actually fire ─────────────────────────
  // A linter that passes on a clean tree proves nothing. The fixtures carry one
  // deliberate instance of every banned pattern; any rule that fails to fire on
  // them is a dead regex and fails the run just as loudly as a real violation.
  const fixtureDir = resolve(APP_ROOT, 'etl/__fixtures__/violations')
  const fixtureFiles = await walk(fixtureDir)
  const fixtureHits = await scan(fixtureFiles)
  const fired = new Set(fixtureHits.map((v) => v.rule.id))
  const dead = RULES.filter((r) => !fired.has(r.id))

  const rel = (p: string): string => relative(APP_ROOT, p)

  process.stdout.write(
    `lint:truth — ${RULES.length} rules · ${files.length} files scanned · ` +
      `${fixtureFiles.length} fixtures\n\n`,
  )

  if (violations.length > 0) {
    process.stdout.write(`${violations.length} violation(s):\n\n`)
    for (const v of violations) {
      process.stdout.write(`  ${rel(v.file)}:${v.line}  [${v.rule.id}]  ${v.rule.spec}\n`)
      process.stdout.write(`    ${v.text}\n`)
      process.stdout.write(`    → ${v.rule.why}\n\n`)
    }
  }

  if (dead.length > 0) {
    process.stdout.write(`${dead.length} rule(s) never fired on the fixtures — dead regex:\n`)
    for (const rule of dead) process.stdout.write(`  · ${rule.id}\n`)
    process.stdout.write(
      `\n  Add a violating line to ${rel(fixtureDir)} for each, or fix the pattern.\n\n`,
    )
  }

  if (violations.length === 0 && dead.length === 0) {
    process.stdout.write(`✅ clean — all ${RULES.length} rules verified against fixtures\n`)
    return
  }
  process.exitCode = 1
}

main().catch((error: unknown) => {
  process.stderr.write(`lint:truth failed: ${String(error)}\n`)
  process.exitCode = 1
})
