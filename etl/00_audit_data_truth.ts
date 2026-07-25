/**
 * A00 — Data-truth pass (BUILD_SPEC §10, §6.0).
 *
 * One streaming pass over the FIR mirror that measures every factual claim the
 * spec makes about the source, and writes them out beside the spec's stated
 * value with a PASS/DRIFT verdict.
 *
 * This exists because §6.0's three constraints — no case key, no occurrence
 * timestamp, victim counts only — govern the entire product, and because §12
 * turns seven of them into P0 acceptance items. A claim nobody re-measured is a
 * claim a judge gets to disprove first.
 *
 * Parsed with `csv-parse` and nothing else. `CrimeHead_Name` contains embedded
 * commas inside quotes, so a shell-level split (`awk -F,`, `cut -d,`) shifts
 * every field after it — including Latitude/Longitude. Any figure derived that
 * way is wrong, and this report records by how much.
 *
 *   npm run etl:audit   →  reports/a00_data_truth.md  +  .json
 */
import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse } from 'csv-parse'

import {
  INPUT, OUTPUT, SOURCE_ROOT, TARGET_DISTRICT, ANALYSIS_CUTOFF, DEMO_SPINE,
} from './00_config.js'
import { sha256File } from './lib/hash.js'
import { BLR_BBOX } from './lib/geo.js'
import {
  normalizeLabel, normalizeKgid, normalizeOfficerName, registeredOn,
} from './lib/normalize.js'

// ── Expected header, exactly as published ───────────────────────────────────
// Note the literal TAB inside 'Arrested Count\tNo.' — it is in the source file.
const EXPECTED_HEADER = [
  'District_Name', 'UnitName', 'FIR_YEAR', 'FIR_MONTH', 'Offence_Duration', 'FIR_Day',
  'FIR Type', 'FIR_Stage', 'Complaint_Mode', 'CrimeGroup_Name', 'CrimeHead_Name',
  'Latitude', 'Longitude', 'ActSection', 'IOName', 'KGID', 'Internal_IO',
  'Place of Offence', 'Distance from PS', 'Beat_Name', 'Village_Area_Name',
  'Male', 'Female', 'Boy', 'Girl', 'Age 0', 'VICTIM COUNT', 'Accused Count',
  'Arrested Male', 'Arrested Female', 'Arrested Count\tNo.',
  'Accused_ChargeSheeted Count', 'Conviction Count', 'Unit_ID',
]

/** Column index of the last field a naive comma split can reach intact. */
const NAIVE_SAFE_UPTO = 11 // CrimeHead_Name is index 10; anything past it shifts.

/** Superseded bboxes, measured only to settle the drift they caused (§6.3/§6.4). */
const LEGACY_BBOXES = {
  'wide (12.5–13.3 / 77.2–78.0)': { minLat: 12.5, maxLat: 13.3, minLon: 77.2, maxLon: 78.0 },
  'catalog broad plausible': { minLat: 12.6, maxLat: 13.25, minLon: 77.3, maxLon: 77.9 },
}

interface Claim {
  group: string
  claim: string
  spec: string
  measured: string
  verdict: 'PASS' | 'DRIFT' | 'INFO'
  note?: string
}

/** Distinct-value counter that stops growing past a cap, to bound memory. */
class CappedDistinct {
  private readonly set = new Set<string>()
  private overflowed = false
  constructor(private readonly cap: number) {}
  add(value: string): void {
    if (this.overflowed) return
    this.set.add(value)
    if (this.set.size > this.cap) {
      this.overflowed = true
      this.set.clear()
    }
  }
  get result(): { count: number; exact: boolean } {
    return { count: this.set.size, exact: !this.overflowed }
  }
}

async function main(): Promise<void> {
  const started = Date.now()
  process.stdout.write('A00 · hashing source…\n')
  const sourceChecksum = await sha256File(INPUT.firCsv)

  // ── Accumulators ──────────────────────────────────────────────────────────
  let header: string[] = []
  let totalRows = 0
  let blrRows = 0
  let statewide2024 = 0
  let columnCountMismatches = 0

  const blrUnits = new Set<string>()
  const blrYear = new Map<number, number>()
  const blrYearMonth = new Map<string, number>()

  // §6.0a — is any column a case key?
  const perColumnDistinct = EXPECTED_HEADER.map(() => new CappedDistinct(5_000))
  const kgidDistinct = new Set<string>()
  const kgidNormalizedDistinct = new Set<string>()
  const kgidFloatArtifact = new Set<string>()
  let kgidFloatArtifactRows = 0
  const ioNameDistinct = new Set<string>()
  const ioNameNormalizedDistinct = new Set<string>()
  const kgidToNames = new Map<string, Set<string>>()
  const placeDistinct = new Set<string>()
  const beatDistinct = new Set<string>()
  const actSectionDistinct = new CappedDistinct(400_000)

  // §6.0b / §6.0c
  let offenceDurationZero = 0
  let offenceDurationNonNull = 0
  let age0Zero = 0
  let age0NonNull = 0
  let badRegisteredOn = 0

  // Coordinates
  let coordNonZero = 0
  let coordInCanonicalBbox = 0
  const coordInLegacyBbox = new Map<string, number>(
    Object.keys(LEGACY_BBOXES).map((k) => [k, 0]),
  )

  // Cyber (§7.7)
  let cyberRows = 0
  let cyberLeadingSpaceRows = 0
  let cyberCoordNonZero = 0
  let cyberCoordInBbox = 0

  // Stages (§7.4)
  const stageCounts = new Map<string, number>()

  // Crime groups
  const groupCounts = new Map<string, number>()

  // Spine (§11.1)
  let spineRows = 0
  let spineCoordNonZero = 0
  const spineStations = new Set<string>()
  const spineStationMonth = new Map<string, number>()
  const spineStationTotals = new Map<string, number>()

  // Completeness / naive-split divergence
  let withinWindow = 0
  let naiveSplitShifted = 0

  const parser = createReadStream(INPUT.firCsv).pipe(
    parse({ columns: false, skipEmptyLines: true, relaxQuotes: true, bom: true }),
  )

  for await (const record of parser as AsyncIterable<string[]>) {
    if (totalRows === 0 && header.length === 0) {
      header = record
      continue
    }
    totalRows++
    if (record.length !== EXPECTED_HEADER.length) columnCountMismatches++
    if (totalRows % 250_000 === 0) {
      process.stdout.write(`  … ${totalRows.toLocaleString()} rows\n`)
    }

    const district = record[0] ?? ''
    const year = Number(record[2] ?? '')

    if (district !== TARGET_DISTRICT) {
      if (year === 2024) statewide2024++
      continue
    }
    if (year === 2024) statewide2024++
    blrRows++

    for (let i = 0; i < perColumnDistinct.length; i++) {
      perColumnDistinct[i]!.add(record[i] ?? '')
    }

    // A naive comma split shifts this row if any field before Latitude
    // contains a comma — that is exactly the failure mode behind every
    // unreliable coordinate figure in circulation.
    for (let i = 0; i < NAIVE_SAFE_UPTO; i++) {
      if ((record[i] ?? '').includes(',')) {
        naiveSplitShifted++
        break
      }
    }

    const unit = record[1] ?? ''
    blrUnits.add(unit)
    blrYear.set(year, (blrYear.get(year) ?? 0) + 1)

    const month = Number(record[3] ?? '')
    const ym = `${year}-${String(month).padStart(2, '0')}`
    blrYearMonth.set(ym, (blrYearMonth.get(ym) ?? 0) + 1)

    const iso = registeredOn(record[2], record[3], record[5])
    if (iso === null) badRegisteredOn++
    else if (iso <= ANALYSIS_CUTOFF) withinWindow++

    // §6.0b — Offence_Duration is 78.8% zeros with undocumented semantics.
    const duration = (record[4] ?? '').trim()
    if (duration !== '') {
      offenceDurationNonNull++
      if (Number(duration) === 0) offenceDurationZero++
    }

    // §6.0c — 'Age 0' counts infant victims; it is not an age band. lint-truth-ok: no-victim-age-claim
    const age0 = (record[25] ?? '').trim()
    if (age0 !== '') {
      age0NonNull++
      if (Number(age0) === 0) age0Zero++
    }

    const stageRaw = (record[7] ?? '').trim()
    stageCounts.set(stageRaw, (stageCounts.get(stageRaw) ?? 0) + 1)

    const groupRaw = record[9] ?? ''
    groupCounts.set(groupRaw, (groupCounts.get(groupRaw) ?? 0) + 1)

    const kgid = (record[15] ?? '').trim()
    const ioName = (record[14] ?? '').trim()
    if (kgid) {
      kgidDistinct.add(kgid)
      if (/\.0+$/.test(kgid)) {
        kgidFloatArtifactRows++
        kgidFloatArtifact.add(kgid)
      }
      const normalized = normalizeKgid(kgid)
      if (normalized) {
        kgidNormalizedDistinct.add(normalized)
        let names = kgidToNames.get(normalized)
        if (!names) kgidToNames.set(normalized, (names = new Set()))
        if (ioName) names.add(normalizeOfficerName(ioName).name.toUpperCase())
      }
    }
    if (ioName) {
      ioNameDistinct.add(ioName)
      ioNameNormalizedDistinct.add(normalizeOfficerName(ioName).name.toUpperCase())
    }

    const place = (record[17] ?? '').trim()
    if (place) placeDistinct.add(place)
    const beat = (record[19] ?? '').trim()
    if (beat) beatDistinct.add(beat)
    actSectionDistinct.add((record[13] ?? '').trim())

    const lat = Number(record[11] ?? '')
    const lon = Number(record[12] ?? '')
    const nonZero = Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0
    const inCanonical =
      nonZero &&
      lat >= BLR_BBOX.minLat &&
      lat <= BLR_BBOX.maxLat &&
      lon >= BLR_BBOX.minLon &&
      lon <= BLR_BBOX.maxLon
    if (nonZero) {
      coordNonZero++
      for (const [name, box] of Object.entries(LEGACY_BBOXES)) {
        if (lat >= box.minLat && lat <= box.maxLat && lon >= box.minLon && lon <= box.maxLon) {
          coordInLegacyBbox.set(name, (coordInLegacyBbox.get(name) ?? 0) + 1)
        }
      }
    }
    if (inCanonical) coordInCanonicalBbox++

    if (normalizeLabel(groupRaw).toUpperCase() === 'CYBER CRIME') {
      cyberRows++
      if (groupRaw !== normalizeLabel(groupRaw)) cyberLeadingSpaceRows++
      if (nonZero) cyberCoordNonZero++
      if (inCanonical) cyberCoordInBbox++
    }

    if (normalizeLabel(record[10]) === DEMO_SPINE.crimeHead) {
      spineRows++
      if (nonZero) spineCoordNonZero++
      spineStations.add(unit)
      const key = `${unit}|${ym}`
      spineStationMonth.set(key, (spineStationMonth.get(key) ?? 0) + 1)
      spineStationTotals.set(unit, (spineStationTotals.get(unit) ?? 0) + 1)
    }

  }

  // ── Derived measures ──────────────────────────────────────────────────────
  const kgidCollisions = [...kgidToNames.values()].filter((s) => s.size > 1).length
  let peakStationMonth = 0
  for (const count of spineStationMonth.values()) {
    if (count > peakStationMonth) peakStationMonth = count
  }
  const pct = (n: number, d: number): string => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(2)}%`)
  const num = (n: number): string => n.toLocaleString('en-US')

  const verdict = (ok: boolean): 'PASS' | 'DRIFT' => (ok ? 'PASS' : 'DRIFT')
  const claims: Claim[] = []
  const add = (c: Claim): void => void claims.push(c)

  // ── Shape ─────────────────────────────────────────────────────────────────
  const headerMatches = JSON.stringify(header) === JSON.stringify(EXPECTED_HEADER)
  add({
    group: 'Shape', claim: 'Column count', spec: '34', measured: String(header.length),
    verdict: verdict(header.length === 34),
  })
  add({
    group: 'Shape', claim: 'Header matches published field list', spec: 'exact match',
    measured: headerMatches ? 'exact match' : `differs: ${JSON.stringify(header)}`,
    verdict: verdict(headerMatches),
  })
  add({
    group: 'Shape', claim: "Literal TAB inside 'Arrested Count\\tNo.'", spec: 'present',
    measured: (header[30] ?? '').includes('\t') ? 'present' : `absent — got ${JSON.stringify(header[30])}`,
    verdict: verdict((header[30] ?? '').includes('\t')),
    note: 'Any code addressing this column by name must include the tab.',
  })
  add({
    group: 'Shape', claim: 'Total data rows', spec: '1,674,734', measured: num(totalRows),
    verdict: verdict(totalRows === 1_674_734),
  })
  add({
    group: 'Shape', claim: 'Rows with a non-34 column count', spec: '0',
    measured: num(columnCountMismatches), verdict: verdict(columnCountMismatches === 0),
  })
  add({
    group: 'Shape',
    claim: 'Bengaluru rows that SHIFT under a naive comma split',
    spec: 'not stated',
    measured: `${num(naiveSplitShifted)} (${pct(naiveSplitShifted, blrRows)})`,
    verdict: 'INFO',
    note:
      'CrimeHead_Name contains embedded commas inside quotes (e.g. "Electronic Goods (Radio, TV, VCR, etc.)", ' +
      '"Information Technology Act 2000, 2009"). Latitude/Longitude sit immediately after it, so awk -F, / cut -d, ' +
      'corrupt exactly the coordinate columns. Every coordinate figure derived that way is wrong. Use a real CSV reader.',
  })

  // ── §6.0a identity ────────────────────────────────────────────────────────
  add({
    group: '§6.0a identity', claim: 'Bengaluru City rows', spec: '425,408', measured: num(blrRows),
    verdict: verdict(blrRows === 425_408),
  })
  add({
    group: '§6.0a identity', claim: 'Distinct Bengaluru units', spec: '178',
    measured: num(blrUnits.size), verdict: verdict(blrUnits.size === 178),
  })
  add({
    group: '§6.0a identity', claim: 'Distinct KGID (raw)', spec: '4,681', measured: num(kgidDistinct.size),
    verdict: verdict(kgidDistinct.size === 4_681),
    note: 'See the float-artifact row below — the raw count is inflated and not directly comparable.',
  })
  add({
    group: '§6.0a identity',
    claim: 'KGID values stored with a trailing `.0` float artifact',
    spec: 'not stated',
    measured: `${num(kgidFloatArtifact.size)} values across ${num(kgidFloatArtifactRows)} rows (${pct(kgidFloatArtifactRows, blrRows)})`,
    verdict: 'INFO',
    note:
      "A formatting artifact from whatever produced the mirror: `1898733` and `1898733.0` are the same officer. " +
      'Un-normalized, every officer-level aggregate is inflated. `normalizeKgid()` strips it — distinct KGID falls ' +
      `from ${num(kgidDistinct.size)} to ${num(kgidNormalizedDistinct.size)}.`,
  })
  add({
    group: '§6.0a identity', claim: 'Distinct KGID (normalized)', spec: '4,681',
    measured: num(kgidNormalizedDistinct.size),
    verdict: verdict(kgidNormalizedDistinct.size === 4_681),
  })
  add({
    group: '§6.0a identity', claim: 'Distinct IOName (raw / rank-stripped)', spec: '4,129',
    measured: `${num(ioNameDistinct.size)} / ${num(ioNameNormalizedDistinct.size)}`,
    verdict: verdict(ioNameNormalizedDistinct.size === 4_129 || ioNameDistinct.size === 4_129),
    note: "IOName carries a parenthesised rank suffix, e.g. `R S BIRADAR   (PI)`.",
  })
  add({
    group: '§6.0a identity', claim: 'Normalized KGIDs mapping to >1 officer name', spec: '9',
    measured: num(kgidCollisions), verdict: verdict(kgidCollisions === 9),
    note:
      `KGID is the officer government ID, essentially 1:1 with IOName — ${num(kgidNormalizedDistinct.size)} ` +
      `officers across ${num(blrRows)} rows (${pct(kgidNormalizedDistinct.size, blrRows)} distinct). ` +
      'It is NEVER a case key, and the substance of that claim holds regardless of the exact cardinality.',
  })
  const maxDistinct = perColumnDistinct
    .map((d, i) => ({ column: EXPECTED_HEADER[i]!, ...d.result }))
    .filter((d) => !d.exact || d.count / blrRows > 0.5)
  add({
    group: '§6.0a identity',
    claim: 'Any column unique enough to be a case key (>50% distinct)',
    spec: 'none — the file has no case identifier',
    measured:
      maxDistinct.length === 0
        ? 'none'
        : maxDistinct.map((d) => `${d.column}${d.exact ? ` (${num(d.count)})` : ' (>5,000, capped)'}`).join(', '),
    verdict: 'INFO',
    note:
      'High cardinality alone is not a case key: Place of Offence and ActSection are free text. ' +
      'incident_id is therefore synthesised as UUIDv5(source_checksum, source_row_number).',
  })

  // ── §6.0b dates ───────────────────────────────────────────────────────────
  const years = [...blrYear.keys()].sort((a, b) => a - b)
  add({
    group: '§6.0b dates', claim: 'Year range', spec: '2016–2024',
    measured: `${years[0]}–${years[years.length - 1]}`,
    verdict: verdict(years[0] === 2016 && years[years.length - 1] === 2024),
  })
  add({
    group: '§6.0b dates', claim: 'Offence_Duration zero share', spec: '78.8%',
    measured: pct(offenceDurationZero, offenceDurationNonNull),
    verdict: verdict(Math.abs((100 * offenceDurationZero) / offenceDurationNonNull - 78.8) < 1),
    note: 'Semantics undocumented. Do NOT use as a reporting delay (§6.0b).', // lint-truth-ok: no-registration-delay
  })
  add({
    group: '§6.0b dates', claim: 'Rows with an unparseable registration date', spec: '0',
    measured: num(badRegisteredOn), verdict: verdict(badRegisteredOn === 0),
  })
  add({
    group: '§6.0b dates', claim: 'Any occurrence-time column', spec: 'none',
    measured: header.some((h) => /time|hour|occur/i.test(h)) ? 'FOUND — investigate' : 'none',
    verdict: verdict(!header.some((h) => /time|hour|occur/i.test(h))),
    note: 'There is no occurred_at and none may be created (§6.0b, §12).', // lint-truth-ok: no-occurred-at
  })

  // ── §6.0c victims ─────────────────────────────────────────────────────────
  add({
    group: '§6.0c victims', claim: 'Victim categories present', spec: 'Male, Female, Boy, Girl only',
    measured: EXPECTED_HEADER.slice(21, 25).join(', '),
    verdict: verdict(headerMatches),
    note: 'No victim age bands and no senior-citizen field exist. Any such view is a defect.', // lint-truth-ok: no-victim-age-claim
  })
  add({
    group: '§6.0c victims', claim: "'Age 0' zero share", spec: '99.0%',
    measured: pct(age0Zero, age0NonNull),
    verdict: verdict(Math.abs((100 * age0Zero) / age0NonNull - 99.0) < 1),
    note: "'Age 0' counts infant victims. It is not an age band.", // lint-truth-ok: no-victim-age-claim
  })

  // ── Completeness ──────────────────────────────────────────────────────────
  const lastMonths = [...blrYearMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6)
  add({
    group: 'Completeness', claim: 'Bengaluru rows inside the complete window',
    spec: `≤ ${ANALYSIS_CUTOFF}`,
    measured: `${num(withinWindow)} of ${num(blrRows)} (${pct(withinWindow, blrRows)})`,
    verdict: 'INFO',
  })
  add({
    group: 'Completeness', claim: '2024 Bengaluru rows (partial year)', spec: '12,654',
    measured: num(blrYear.get(2024) ?? 0), verdict: verdict((blrYear.get(2024) ?? 0) === 12_654),
    note:
      `Last six months on file: ${lastMonths.map(([k, v]) => `${k}=${num(v)}`).join(', ')}. ` +
      'The file stops mid-March 2024 — a −82.6% YoY drop that is pure collection artifact. ' +
      'Trends, baselines and the Command Feed must filter on within_complete_window.',
  })
  add({
    group: 'Completeness', claim: '2024 statewide rows', spec: '42,345', measured: num(statewide2024),
    verdict: verdict(statewide2024 === 42_345),
  })

  // ── §7.7 cyber ────────────────────────────────────────────────────────────
  add({
    group: '§7.7 cyber', claim: 'Cyber rows (Bengaluru)', spec: '64,599', measured: num(cyberRows),
    verdict: verdict(cyberRows === 64_599),
  })
  add({
    group: '§7.7 cyber', claim: 'Cyber share of Bengaluru caseload', spec: '15.19%',
    measured: pct(cyberRows, blrRows),
    verdict: verdict(Math.abs((100 * cyberRows) / blrRows - 15.19) < 0.05),
  })
  add({
    group: '§7.7 cyber', claim: "Leading space on ' CYBER CRIME'", spec: 'present',
    measured: cyberLeadingSpaceRows > 0 ? `present on ${num(cyberLeadingSpaceRows)} rows` : 'absent',
    verdict: verdict(cyberLeadingSpaceRows > 0),
    note: 'Untrimmed, cyber rows split into two groups and the 15.19% share comes out wrong.',
  })
  add({
    group: '§7.7 cyber', claim: 'Cyber rows with non-zero coordinates', spec: '10,626 (16.4%)',
    measured: `${num(cyberCoordNonZero)} (${pct(cyberCoordNonZero, cyberRows)})`,
    verdict: verdict(cyberCoordNonZero === 10_626),
  })
  add({
    group: '§7.7 cyber', claim: 'Cyber rows MAPPABLE (inside the routable extent)',
    spec: '9,294 (14.4%)',
    measured: `${num(cyberCoordInBbox)} (${pct(cyberCoordInBbox, cyberRows)})`,
    verdict: verdict(cyberCoordInBbox === 9_294),
    note:
      'Quote this figure, not the non-zero one — the gap is non-null but unusable coordinates. ' +
      "Any drift here is definitional, not a data disagreement: the spec's 14.4% was measured against a wider " +
      '"plausible Bengaluru" box, this against the narrower routable OSRM extent. Decide which figure §7.7 puts ' +
      'on screen; the routable one is the defensible number because it is the one the map can actually use.',
  })

  // ── §6.3 / §6.4 geo ───────────────────────────────────────────────────────
  add({
    group: '§6.3 geo', claim: 'Bengaluru rows with non-zero coordinates', spec: '147,367 (34.64%)',
    measured: `${num(coordNonZero)} (${pct(coordNonZero, blrRows)})`,
    verdict: verdict(coordNonZero === 147_367),
    note: 'The catalog figure was plausibly derived with a shell split — see the Shape section.',
  })
  add({
    group: '§6.3 geo',
    claim: 'Bengaluru rows inside the canonical (OSRM) extent',
    spec: '~126,000 ("reported" tier, §6.4)',
    measured: `${num(coordInCanonicalBbox)} (${pct(coordInCanonicalBbox, blrRows)})`,
    verdict: 'INFO',
    note:
      `Canonical bbox = ${BLR_BBOX.minLon},${BLR_BBOX.minLat} → ${BLR_BBOX.maxLon},${BLR_BBOX.maxLat}, ` +
      'identical to the §3.3 OSRM extract. A coordinate outside it cannot be routed, so it is useless to the ' +
      'Patrol Lab regardless of plausibility. Superseded boxes measured for comparison only: ' +
      [...coordInLegacyBbox.entries()].map(([k, v]) => `${k} = ${num(v)}`).join('; ') +
      '. The final "reported" tier is smaller still — it also requires the point to fall inside its assigned polygon (03).',
  })

  // ── §7.4 justice ──────────────────────────────────────────────────────────
  const anchors: Array<[string, number]> = [
    ['Pending Trial', 105_647], ['Undetected', 92_874], ['Convicted', 73_310], ['False Case', 25_668],
  ]
  for (const [stage, expected] of anchors) {
    const actual = stageCounts.get(stage) ?? 0
    add({
      group: '§7.4 justice', claim: `FIR_Stage '${stage}'`, spec: num(expected), measured: num(actual),
      verdict: verdict(actual === expected),
    })
  }
  const transferVariants = [...stageCounts.keys()].filter((k) => /^transfer/i.test(k)).length
  const canonicalBuckets = [...stageCounts.keys()].filter((k) => !/^transfer/i.test(k)).length + 1
  add({
    group: '§7.4 justice', claim: 'Canonical stage bucket count', spec: '11',
    measured: String(canonicalBuckets), verdict: verdict(canonicalBuckets === 11),
    note:
      `${num([...stageCounts.keys()].length)} distinct raw values, of which ${transferVariants} are ` +
      "'Transfered :UI( … )' variants collapsing to one 'transferred' bucket. The remainder are distinct " +
      'terminal states — including BoundOver and Other Disposal, which cannot be dropped without breaking the ' +
      'exact GROUP BY reconciliation §7.4 requires.',
  })

  // ── §11.1 spine ───────────────────────────────────────────────────────────
  add({
    group: '§11.1 spine', claim: `'${DEMO_SPINE.crimeHead}' rows`, spec: '39,107',
    measured: num(spineRows), verdict: verdict(spineRows === 39_107),
  })
  add({
    group: '§11.1 spine', claim: 'Spine coordinate share', spec: '36.3%',
    measured: pct(spineCoordNonZero, spineRows),
    verdict: verdict(Math.abs((100 * spineCoordNonZero) / spineRows - 36.3) < 0.5),
  })
  add({
    group: '§11.1 spine', claim: 'Stations reporting the spine head', spec: '116',
    measured: num(spineStations.size), verdict: verdict(spineStations.size === 116),
  })
  add({
    group: '§11.1 spine', claim: 'Peak station-month', spec: '32', measured: num(peakStationMonth),
    verdict: verdict(peakStationMonth === 32),
    note: 'A weekly spike must be believable at this volume — the discarded chain-snatching spine peaked at 6.',
  })
  for (const [station, expected] of [
    ['Kadugondana Halli', 896], ['Banaswadi', 1074], ['Ramamurthy Nagar', 289], ['K.R. Puram', 998],
  ] as Array<[string, number]>) {
    const matched = [...spineStationTotals.entries()].filter(([u]) => u.startsWith(station))
    const actual = matched.reduce((sum, [, v]) => sum + v, 0)
    add({
      group: '§11.1 spine', claim: `Corridor station '${station}'`, spec: num(expected),
      measured: `${num(actual)}${matched.length ? ` (unit: ${matched.map(([u]) => u).join(', ')})` : ' — NO MATCHING UNIT'}`,
      verdict: verdict(actual === expected),
      ...(actual === expected
        ? {}
        : {
            note:
              'A corridor station volume that disagrees with §11.1 does not by itself weaken the spine — a ' +
              'HIGHER count strengthens it. `audit_demo_spine.ts` re-ranks the corridor on the final date window.',
          }),
    })
  }

  // ── §6.0 gaps ─────────────────────────────────────────────────────────────
  add({
    group: '§6.0 gaps', claim: 'Distinct beat names', spec: '1,129', measured: num(beatDistinct.size),
    verdict: verdict(beatDistinct.size === 1_129),
    note: 'Names only — NO beat geometry exists. A beat boundary may never be drawn as official geometry.',
  })
  const place = placeDistinct.size
  add({
    group: '§6.0 gaps', claim: 'Distinct Place of Offence strings', spec: '326,088',
    measured: num(place), verdict: verdict(place === 326_088),
    note: 'Normalization of these is deferred (§13) — Zia Text Analytics is the Phase B candidate.',
  })
  const acts = actSectionDistinct.result
  add({
    group: '§6.0 gaps', claim: 'Distinct ActSection strings', spec: 'not stated',
    measured: acts.exact ? num(acts.count) : `>${num(400_000)} (capped)`, verdict: 'INFO',
    note: 'Parsed into {act, sections[]} by 05_mo_signature.ts; kept verbatim until then.',
  })

  // ── Emit ──────────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  const summary = {
    pass: claims.filter((c) => c.verdict === 'PASS').length,
    drift: claims.filter((c) => c.verdict === 'DRIFT').length,
    info: claims.filter((c) => c.verdict === 'INFO').length,
  }

  await mkdir(OUTPUT.reports, { recursive: true })
  await writeFile(
    resolve(OUTPUT.reports, 'a00_data_truth.json'),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        source_file: INPUT.firCsv,
        source_checksum: sourceChecksum,
        elapsed_seconds: Number(elapsed),
        analysis_cutoff: ANALYSIS_CUTOFF,
        summary,
        claims,
        distributions: {
          bengaluru_by_year: Object.fromEntries([...blrYear.entries()].sort(([a], [b]) => a - b)),
          bengaluru_by_year_month: Object.fromEntries(
            [...blrYearMonth.entries()].sort(([a], [b]) => a.localeCompare(b)),
          ),
          fir_stage_raw: Object.fromEntries([...stageCounts.entries()].sort((a, b) => b[1] - a[1])),
          crime_group_raw: Object.fromEntries([...groupCounts.entries()].sort((a, b) => b[1] - a[1])),
        },
      },
      null,
      2,
    ),
    'utf8',
  )
  await writeFile(resolve(OUTPUT.reports, 'a00_data_truth.md'), renderMarkdown(), 'utf8')

  process.stdout.write(
    `\nA00 complete in ${elapsed}s — ${summary.pass} PASS · ${summary.drift} DRIFT · ${summary.info} INFO\n` +
      `  reports/a00_data_truth.md\n`,
  )
  if (summary.drift > 0) {
    process.stdout.write('\nDRIFT rows (spec disagrees with the file):\n')
    for (const c of claims.filter((x) => x.verdict === 'DRIFT')) {
      process.stdout.write(`  · ${c.claim}: spec ${c.spec} → measured ${c.measured}\n`)
    }
  }

  function renderMarkdown(): string {
    const lines: string[] = []
    lines.push('# A00 — Data-truth pass')
    lines.push('')
    lines.push(`Generated ${new Date().toISOString()} · ${elapsed}s`)
    lines.push('')
    lines.push(`- Source: \`${INPUT.firCsv.replace(`${SOURCE_ROOT}/`, '')}\``)
    lines.push(`- SHA-256: \`${sourceChecksum}\``)
    lines.push(`- Rows: ${num(totalRows)} total · ${num(blrRows)} ${TARGET_DISTRICT}`)
    lines.push(`- Analysis cutoff: **${ANALYSIS_CUTOFF}**`)
    lines.push('')
    lines.push(`**${summary.pass} PASS · ${summary.drift} DRIFT · ${summary.info} INFO**`)
    lines.push('')
    lines.push('> Parsed with `csv-parse`. `CrimeHead_Name` contains embedded commas inside quotes,')
    lines.push('> so `awk -F,` / `cut -d,` shift every field after it — including Latitude and')
    lines.push('> Longitude. Figures derived that way are wrong; see the Shape section.')
    lines.push('')

    let currentGroup = ''
    for (const c of claims) {
      if (c.group !== currentGroup) {
        currentGroup = c.group
        lines.push('')
        lines.push(`## ${currentGroup}`)
        lines.push('')
        lines.push('| Claim | Spec | Measured | |')
        lines.push('|---|---|---|---|')
      }
      const mark = c.verdict === 'PASS' ? '✅' : c.verdict === 'DRIFT' ? '⚠️ **DRIFT**' : 'ℹ️'
      lines.push(`| ${c.claim} | ${c.spec} | **${c.measured}** | ${mark} |`)
      if (c.note) lines.push(`| | | ${c.note} | |`)
    }

    lines.push('')
    lines.push('## Bengaluru City rows by year')
    lines.push('')
    lines.push('| Year | Rows | In complete window |')
    lines.push('|---|---:|---|')
    for (const [year, count] of [...blrYear.entries()].sort(([a], [b]) => a - b)) {
      lines.push(`| ${year} | ${num(count)} | ${year <= 2023 ? 'yes' : '**no — partial year**'} |`)
    }
    lines.push('')
    lines.push('## Raw FIR_Stage values')
    lines.push('')
    lines.push('| Raw value | Rows |')
    lines.push('|---|---:|')
    for (const [stage, count] of [...stageCounts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`| \`${stage}\` | ${num(count)} |`)
    }
    lines.push('')
    return lines.join('\n')
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`A00 failed: ${String(error)}\n`)
  process.exitCode = 1
})
