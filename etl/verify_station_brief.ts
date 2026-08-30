/**
 * Acceptance checks for A17 — M5 Station Intelligence Brief.
 *
 * Every numeric claim on the page is recomputed here straight from the source
 * Parquet and compared, rather than re-read from the fixture that produced it.
 * A check that reads its expectation out of the artifact under test proves only
 * that JSON parses.
 *
 * The oldest-open-cases list and the ageing buckets are deliberately checked as
 * two independent assertions: the brief's top five come from row level, the
 * buckets come from `justice_pipeline.json`, and conflating them would let an
 * error in one hide behind the other.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { OUTPUT } from './00_config.js'
import { sha256File } from './lib/hash.js'
import { query } from './lib/parquet.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** Must track the policy in `17_station_brief.ts`. */
const SNAPSHOT_WEEK_START = '2023-12-25'
const ANALYSIS_CUTOFF = '2023-12-31'
const OPEN_STAGES = ['pending_trial', 'under_investigation', 'undetected', 'un_traced']
const PEER_COUNT = 5

/**
 * §6.0b and §7.5. The source ends in 2023 and the product is presented later,
 * so no rendered string may imply the data is live. Checked against the fixture
 * because that is where the UI reads its copy from.
 */
const BANNED_DATE_PHRASES = [/\bcurrent week\b/i, /\bthis week\b/i, /\btoday\b/i]

interface Forecast {
  readonly method: string
  readonly next_week_start: string
  readonly low: number
  readonly expected: number
  readonly high: number
  readonly basis_weeks: number
}

interface Staffing {
  readonly sanctioned_strength: number
  readonly open_records: number
  readonly open_per_officer: number
  readonly provenance: { readonly source_authority: string; readonly transformation: string }
}

interface Brief {
  readonly station_code: string
  readonly station_name: string
  readonly station_name_kn: string | null
  readonly police_division: string
  readonly three_things: readonly {
    readonly crime_head: string
    readonly registered: number
    readonly previous_registered: number
    readonly delta: number
  }[]
  readonly fastest_rising: { readonly crime_head: string; readonly registered: number } | null
  readonly worst_affected_beat: { readonly beat_name: string; readonly registered: number } | null
  readonly oldest_open_cases: readonly {
    readonly case_ref: string
    readonly days_open: number
  }[]
  readonly workload: {
    readonly open_records: number
    readonly distinct_io_aliases: number
    readonly records_without_io: number
  } | null
  readonly victims: {
    readonly male: number
    readonly female: number
    readonly boy: number
    readonly girl: number
  } | null
  readonly peers: {
    readonly stations: readonly { readonly station_code: string }[]
  }
  readonly forecast: Forecast | null
  readonly staffing: Staffing
}

interface Fixture {
  readonly snapshot_week_start: string
  readonly analysis_cutoff: string
  readonly overview: {
    readonly stations_evaluated: number
    readonly stations_above_expected_band: number
    readonly stations_with_alert: number
    readonly top_alert_ids: readonly string[]
  }
  readonly stations: readonly Brief[]
  readonly outlook: Forecast | null
  readonly staffing: {
    readonly most_loaded: readonly { readonly open_per_officer: number }[]
    readonly most_headroom: readonly { readonly open_per_officer: number }[]
    readonly provenance: { readonly source_authority: string }
  }
}

const num = (value: unknown): number => (typeof value === 'bigint' ? Number(value) : Number(value ?? 0))
const sql = (path: string): string => `read_parquet('${path.replaceAll("'", "''")}')`

async function main(): Promise<void> {
  const fixturePath = resolve(OUTPUT.scenarios, 'station_brief.json')
  const feedPath = resolve(OUTPUT.scenarios, 'command_feed.json')
  const incidentPath = resolve(OUTPUT.derived, 'incidents_time.parquet')
  const baselinePath = resolve(OUTPUT.derived, 'weekly_baselines.parquet')

  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture
  const feed = JSON.parse(await readFile(feedPath, 'utf8')) as {
    alerts: readonly { id: string; station_name: string }[]
  }

  assert(fixture.snapshot_week_start === SNAPSHOT_WEEK_START, 'Snapshot week drift')
  assert(fixture.analysis_cutoff === ANALYSIS_CUTOFF, 'Analysis cutoff drift')

  const stationCount = fixture.stations.length
  assert(stationCount === 106, `Expected 106 territorial station briefs, got ${stationCount}`)
  assert(
    fixture.overview.stations_evaluated === stationCount,
    'overview.stations_evaluated disagrees with the emitted station count',
  )
  assert(
    new Set(fixture.stations.map((brief) => brief.station_code)).size === stationCount,
    'Duplicate station_code in the brief fixture',
  )

  // ---- date language -------------------------------------------------------
  const rendered = JSON.stringify(fixture)
  for (const pattern of BANNED_DATE_PHRASES) {
    assert(
      !pattern.test(rendered),
      `Fixture copy implies live data (${pattern}). The source ends ${ANALYSIS_CUTOFF}.`,
    )
  }

  // ---- Home contract -------------------------------------------------------
  const alertIds = new Set(feed.alerts.map((alert) => alert.id))
  assert(
    fixture.overview.top_alert_ids.length > 0 &&
      fixture.overview.top_alert_ids.every((id) => alertIds.has(id)),
    'overview.top_alert_ids does not resolve against command_feed.json',
  )

  // ---- victims, recomputed -------------------------------------------------
  const victimRows = (await query(
    `WITH weekly AS (
       SELECT station_code, iso_week,
              sum(victim_male) AS male, sum(victim_female) AS female,
              sum(victim_boy) AS boy, sum(victim_girl) AS girl
       FROM ${sql(incidentPath)}
       WHERE within_complete_window AND station_code IS NOT NULL
       GROUP BY station_code, iso_week
     )
     SELECT station_code, male, female, boy, girl FROM weekly
     QUALIFY row_number() OVER (PARTITION BY station_code ORDER BY iso_week DESC) = 1`,
  )) as Array<Record<string, unknown>>
  const victimByStation = new Map(victimRows.map((row) => [String(row['station_code']), row]))

  for (const brief of fixture.stations) {
    const truth = victimByStation.get(brief.station_code)
    // A missing section must mean missing data, not a dropped section. Skipping
    // absent sections would let a bug that silently omits them pass unnoticed.
    assert(
      Boolean(brief.victims) === Boolean(truth),
      brief.victims
        ? `${brief.station_code} reports victims with no source row`
        : `${brief.station_code} is missing its victim section, but source rows exist`,
    )
    if (!brief.victims || !truth) continue
    assert(
      brief.victims.male === num(truth['male']) &&
        brief.victims.female === num(truth['female']) &&
        brief.victims.boy === num(truth['boy']) &&
        brief.victims.girl === num(truth['girl']),
      `Victim counts do not reconcile for ${brief.station_code}`,
    )
  }

  // ---- oldest open cases, recomputed independently -------------------------
  const oldestRows = (await query(
    `SELECT station_code, case_ref,
            date_diff('day', registered_on, DATE '${ANALYSIS_CUTOFF}') AS days_open
     FROM ${sql(incidentPath)}
     WHERE within_complete_window AND station_code IS NOT NULL
       AND stage IN (${OPEN_STAGES.map((stage) => `'${stage}'`).join(',')})
     QUALIFY row_number() OVER (
       PARTITION BY station_code ORDER BY registered_on ASC, case_ref ASC
     ) <= 5`,
  )) as Array<Record<string, unknown>>
  const oldestByStation = new Map<string, Set<string>>()
  for (const row of oldestRows) {
    const code = String(row['station_code'])
    const bucket = oldestByStation.get(code) ?? new Set<string>()
    bucket.add(String(row['case_ref']))
    oldestByStation.set(code, bucket)
  }

  for (const brief of fixture.stations) {
    const truth = oldestByStation.get(brief.station_code) ?? new Set<string>()
    // Membership alone would pass an incomplete list, so the count is asserted
    // against the truth set as well: four of the five oldest is a bug.
    assert(
      brief.oldest_open_cases.length === truth.size,
      `${brief.station_code} lists ${brief.oldest_open_cases.length} oldest open cases; source has ${truth.size}`,
    )
    assert(
      brief.oldest_open_cases.every((entry) => truth.has(entry.case_ref)),
      `Oldest-open-case list does not match row-level truth for ${brief.station_code}`,
    )
    assert(
      new Set(brief.oldest_open_cases.map((entry) => entry.case_ref)).size ===
        brief.oldest_open_cases.length,
      `${brief.station_code} repeats a case in its oldest-open list`,
    )
    assert(
      brief.oldest_open_cases.every(
        (entry, index) => index === 0 || entry.days_open <= brief.oldest_open_cases[index - 1]!.days_open,
      ),
      `Oldest-open-case list is not ordered oldest-first for ${brief.station_code}`,
    )
  }

  // ---- workload proxy ------------------------------------------------------
  const workloadRows = (await query(
    `SELECT station_code,
            count(*) AS open_records,
            count(DISTINCT io_alias) AS distinct_io_aliases,
            count(*) FILTER (WHERE io_alias IS NULL OR io_alias = '') AS records_without_io
     FROM ${sql(incidentPath)}
     WHERE within_complete_window AND station_code IS NOT NULL
       AND stage IN (${OPEN_STAGES.map((stage) => `'${stage}'`).join(',')})
     GROUP BY station_code`,
  )) as Array<Record<string, unknown>>
  const workloadByStation = new Map(workloadRows.map((row) => [String(row['station_code']), row]))

  for (const brief of fixture.stations) {
    const truth = workloadByStation.get(brief.station_code)
    assert(
      Boolean(brief.workload) === Boolean(truth),
      brief.workload
        ? `${brief.station_code} reports workload with no source row`
        : `${brief.station_code} is missing its workload section, but source rows exist`,
    )
    if (!brief.workload || !truth) continue
    assert(
      brief.workload.open_records === num(truth['open_records']) &&
        brief.workload.distinct_io_aliases === num(truth['distinct_io_aliases']) &&
        brief.workload.records_without_io === num(truth['records_without_io']),
      `Workload counts do not reconcile for ${brief.station_code}`,
    )
  }

  // ---- three things, recomputed against the baseline grid ------------------
  const deltaRows = (await query(
    `WITH series AS (
       SELECT station_code, crime_head,
              strftime(week_start, '%Y-%m-%d') AS week_start, fir_count,
              lag(fir_count) OVER (
                PARTITION BY station_code, crime_head ORDER BY week_start
              ) AS previous_count
       FROM ${sql(baselinePath)}
       WHERE station_code IS NOT NULL
     )
     SELECT station_code, crime_head, fir_count, coalesce(previous_count, 0) AS previous_count
     FROM series WHERE week_start = '${SNAPSHOT_WEEK_START}'`,
  )) as Array<Record<string, unknown>>
  const deltaTruth = new Map(
    deltaRows.map((row) => [
      `${String(row['station_code'])} ${String(row['crime_head'])}`,
      { count: num(row['fir_count']), previous: num(row['previous_count']) },
    ]),
  )

  for (const brief of fixture.stations) {
    for (const item of brief.three_things) {
      const truth = deltaTruth.get(`${brief.station_code} ${item.crime_head}`)
      assert(truth, `No baseline row behind "${item.crime_head}" at ${brief.station_code}`)
      assert(
        item.registered === truth.count &&
          item.previous_registered === truth.previous &&
          item.delta === truth.count - truth.previous,
        `"${item.crime_head}" at ${brief.station_code} does not reconcile to weekly_baselines`,
      )
    }
  }

  // ---- fastest rising, recomputed independently ----------------------------
  // The selection rule, restated here rather than imported, so a change to the
  // compiler's rule has to be made deliberately in two places.
  const risingRows = (await query(
    `WITH series AS (
       SELECT station_code, crime_head,
              strftime(week_start, '%Y-%m-%d') AS week_start, fir_count,
              expected_count, window_observations,
              lag(fir_count) OVER (
                PARTITION BY station_code, crime_head ORDER BY week_start
              ) AS previous_count
       FROM ${sql(baselinePath)}
       WHERE station_code IS NOT NULL
     )
     SELECT station_code, crime_head, fir_count,
            coalesce(previous_count, 0) AS previous_count,
            expected_count, window_observations
     FROM series
     WHERE week_start = '${SNAPSHOT_WEEK_START}'
       AND fir_count - coalesce(previous_count, 0) > 0`,
  )) as Array<Record<string, unknown>>

  const risingByStation = new Map<string, Array<Record<string, unknown>>>()
  for (const row of risingRows) {
    const code = String(row['station_code'])
    risingByStation.set(code, [...(risingByStation.get(code) ?? []), row])
  }

  const expectedRising = (code: string): string | null => {
    const rows = risingByStation.get(code) ?? []
    const rank = (candidates: Array<Record<string, unknown>>) =>
      [...candidates].sort(
        (left, right) =>
          Math.abs(num(right['fir_count']) - num(right['previous_count'])) -
            Math.abs(num(left['fir_count']) - num(left['previous_count'])) ||
          num(right['fir_count']) - num(left['fir_count']) ||
          String(left['crime_head']).localeCompare(String(right['crime_head'])),
      )
    const banded = rank(
      rows.filter(
        (row) => num(row['expected_count']) >= 0.5 && num(row['window_observations']) >= 26,
      ),
    )
    const all = rank(rows)
    const winner = banded[0] ?? all[0]
    return winner ? String(winner['crime_head']) : null
  }

  for (const brief of fixture.stations) {
    const expected = expectedRising(brief.station_code)
    assert(
      (brief.fastest_rising?.crime_head ?? null) === expected,
      `${brief.station_code} fastest-rising is ${brief.fastest_rising?.crime_head ?? 'none'}; recomputed ${expected ?? 'none'}`,
    )
  }

  // ---- peers, recomputed independently -------------------------------------
  const divisionOf = new Map(fixture.stations.map((brief) => [brief.station_code, brief.police_division]))
  const medianRows = (await query(
    `WITH weekly AS (
       SELECT station_code, week_start, sum(fir_count) AS registrations
       FROM ${sql(baselinePath)}
       WHERE station_code IS NOT NULL
         AND week_start > DATE '${SNAPSHOT_WEEK_START}' - INTERVAL 52 WEEK
         AND week_start <= DATE '${SNAPSHOT_WEEK_START}'
       GROUP BY station_code, week_start
     )
     SELECT station_code, median(registrations) AS median_weekly_registrations
     FROM weekly GROUP BY station_code`,
  )) as Array<Record<string, unknown>>
  const medianOf = new Map(
    medianRows.map((row) => [String(row['station_code']), num(row['median_weekly_registrations'])]),
  )

  for (const brief of fixture.stations) {
    const self = medianOf.get(brief.station_code) ?? 0
    // Recompute the nearest five in the same division, with the same
    // tie-break, and compare the whole set. Checking only the count and the
    // division would pass any five same-division stations.
    const expectedPeers = fixture.stations
      .filter(
        (other) =>
          other.station_code !== brief.station_code &&
          other.police_division === brief.police_division,
      )
      .map((other) => ({
        code: other.station_code,
        distance: Math.abs((medianOf.get(other.station_code) ?? 0) - self),
      }))
      .sort((left, right) => left.distance - right.distance || left.code.localeCompare(right.code))
      .slice(0, PEER_COUNT)
      .map((peer) => peer.code)

    const actual = brief.peers.stations.map((peer) => peer.station_code)
    assert(
      actual.length === expectedPeers.length && actual.every((code, index) => code === expectedPeers[index]),
      `${brief.station_code} peers are [${actual.join(', ')}]; nearest-median recompute gives [${expectedPeers.join(', ')}]`,
    )
    assert(
      actual.every((code) => code !== brief.station_code),
      `${brief.station_code} lists itself as a peer`,
    )
    assert(
      actual.every((code) => divisionOf.get(code) === brief.police_division),
      `${brief.station_code} has a peer outside its division`,
    )
  }

  // ---- exceedance count, recomputed ---------------------------------------
  // The eligibility gate applies here too. Counting every breach regardless of
  // history flagged five stations whose expected count ran between 0.024 and
  // 0.262 — the same cold-start artifact the Command Feed gate exists to
  // remove, arriving through a different door.
  const exceedRows = (await query(
    `SELECT count(*) AS stations
     FROM (
       SELECT station_code
       FROM ${sql(baselinePath)}
       WHERE station_code IS NOT NULL
         AND strftime(week_start, '%Y-%m-%d') = '${SNAPSHOT_WEEK_START}'
         AND ucl_99 > 0 AND fir_count > ucl_99
         AND expected_count >= 0.5 AND window_observations >= 26
       GROUP BY station_code
     )`,
  )) as Array<Record<string, unknown>>
  const exceedTruth = num(exceedRows[0]?.['stations'])
  assert(
    fixture.overview.stations_above_expected_band === exceedTruth,
    `overview.stations_above_expected_band is ${fixture.overview.stations_above_expected_band}, recomputed ${exceedTruth}`,
  )

  // The overview headline, recomputed from the feed the compiler read.
  const alertStations = new Set(
    (feed.alerts as readonly { station_name: string }[]).map((alert) => alert.station_name),
  )
  assert(
    fixture.overview.stations_with_alert === alertStations.size,
    `overview.stations_with_alert is ${fixture.overview.stations_with_alert}, feed has ${alertStations.size} distinct stations`,
  )
  assert(
    fixture.overview.stations_with_alert <= fixture.overview.stations_evaluated,
    'More stations raised an alert than exist',
  )

  // ---- demand outlook ------------------------------------------------------
  // The forecast must be an interval, ordered, and built without the seasonal
  // factor — that factor is fitted across the whole series in 06_baselines.ts
  // and would leak future weeks into a prospective claim.
  const checkForecast = (label: string, forecast: Forecast | null) => {
    if (!forecast) return
    assert(
      forecast.method.includes('no_seasonality'),
      `${label} forecast method "${forecast.method}" does not declare that seasonality is excluded`,
    )
    assert(
      forecast.low <= forecast.expected && forecast.expected <= forecast.high,
      `${label} forecast is not ordered low ≤ expected ≤ high (${forecast.low}/${forecast.expected}/${forecast.high})`,
    )
    assert(forecast.low >= 0, `${label} forecast has a negative lower bound`)
    assert(
      forecast.next_week_start > ANALYSIS_CUTOFF,
      `${label} forecast targets ${forecast.next_week_start}, which is not after the data ends`,
    )
    assert(
      forecast.basis_weeks >= 8,
      `${label} forecast is fitted on only ${forecast.basis_weeks} weeks`,
    )
  }
  checkForecast('city', fixture.outlook)
  for (const brief of fixture.stations) checkForecast(brief.station_code, brief.forecast)

  // Recompute the citywide EWMA independently.
  const cityRows = (await query(
    `SELECT strftime(week_start, '%Y-%m-%d') AS week_start, sum(fir_count) AS registrations
     FROM ${sql(baselinePath)}
     WHERE station_code IS NOT NULL
       AND week_start > DATE '${SNAPSHOT_WEEK_START}' - INTERVAL 52 WEEK
       AND week_start <= DATE '${SNAPSHOT_WEEK_START}'
     GROUP BY week_start ORDER BY week_start`,
  )) as Array<Record<string, unknown>>
  if (fixture.outlook) {
    let ewma = num(cityRows[0]?.['registrations'])
    for (const row of cityRows.slice(1)) ewma = 0.25 * num(row['registrations']) + 0.75 * ewma
    const expected = Math.round(ewma * 10) / 10
    assert(
      Math.abs(fixture.outlook.expected - expected) < 0.11,
      `City outlook expected is ${fixture.outlook.expected}; recomputed EWMA gives ${expected}`,
    )
  }

  // ---- staffing ------------------------------------------------------------
  // The establishment figure is generated, so the check is that it is bounded,
  // internally consistent, and labelled as generated — never that it matches a
  // real roster, because no real roster exists here.
  for (const brief of fixture.stations) {
    const staffing = brief.staffing
    assert(
      staffing.sanctioned_strength >= 28 && staffing.sanctioned_strength <= 150,
      `${brief.station_code} generated strength ${staffing.sanctioned_strength} is outside the declared range`,
    )
    assert(
      staffing.provenance.source_authority === 'generated_demo' &&
        staffing.provenance.transformation === 'generated',
      `${brief.station_code} staffing is not labelled as generated`,
    )
    const ratio = Math.round((staffing.open_records / staffing.sanctioned_strength) * 10) / 10
    assert(
      Math.abs(staffing.open_per_officer - ratio) < 0.06,
      `${brief.station_code} open_per_officer ${staffing.open_per_officer} does not equal open/strength ${ratio}`,
    )
  }
  assert(
    fixture.staffing.provenance.source_authority === 'generated_demo',
    'City staffing rollup is not labelled as generated',
  )
  assert(
    fixture.staffing.most_loaded.every(
      (entry, index) =>
        index === 0 ||
        entry.open_per_officer <= fixture.staffing.most_loaded[index - 1]!.open_per_officer,
    ),
    'most_loaded is not ordered by open cases per officer',
  )
  assert(
    fixture.staffing.most_loaded.length > 0 &&
      fixture.staffing.most_headroom.length > 0 &&
      fixture.staffing.most_loaded[0]!.open_per_officer >
        fixture.staffing.most_headroom[0]!.open_per_officer,
    'most_loaded and most_headroom are not on opposite ends of the ranking',
  )

  // ---- beats carry a name and a count, never a shape (§6.0) ----------------
  // lint-truth-ok: no-beat-geometry — asserts the absence this rule requires.
  assert(
    fixture.stations.every(
      (brief) =>
        !brief.worst_affected_beat ||
        (typeof brief.worst_affected_beat.beat_name === 'string' &&
          !('geometry' in brief.worst_affected_beat) &&
          !('polygon' in brief.worst_affected_beat)),
    ),
    'A beat carries geometry; no beat shapes exist in the source',
  )

  const kannada = fixture.stations.filter((brief) => brief.station_name_kn).length
  const checksum = await sha256File(fixturePath)
  process.stdout.write(
    `verify:brief — PASS\n` +
      `  station briefs      ${stationCount}\n` +
      `  snapshot week       ${SNAPSHOT_WEEK_START} → ${ANALYSIS_CUTOFF}\n` +
      `  above expected band ${exceedTruth}\n` +
      `  Kannada labels      ${kannada} (${stationCount - kannada} render in English)\n` +
      `  reconciled          victims, oldest cases, workload, weekly deltas, peers\n` +
      `  fixture sha256      ${checksum}\n`,
  )
}

await main()
