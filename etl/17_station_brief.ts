/**
 * A17 — M5 Station Intelligence Brief (BUILD_SPEC §7.5).
 *
 * One printable A4 page per territorial station: the document a station already
 * writes by hand. §7.5 calls it the adoption feature, and until now it was the
 * only Phase A module never built.
 *
 * Everything here is read out of artifacts that already exist — no new model,
 * no new source. The nine sections are assembled from `weekly_baselines.parquet`
 * (deltas and control limits), `incidents_time.parquet` (beats, ageing, victims,
 * IO aliases) and `stations.parquet` (division, name).
 *
 * Two constraints run through the whole file:
 *
 *   Dates. The source ends 2023-12-31 and the product is shown years later, so
 *   nothing may say "this week" or "current". Every figure is labelled against
 *   the snapshot week, and the fixture carries that date explicitly.
 *
 *   Language. §6.0b — rows are FIRs *registered*, not incidents that occurred.
 *   `lint:truth` enforces this on the copy emitted here, not just on prose.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { APP_ROOT, OUTPUT, SOURCE_ROOT } from './00_config.js'
import { dispersion, negativeBinomialQuantile } from './lib/count_limits.js'
import { GENERATION_VERSION, sha256File, stableUint64 } from './lib/hash.js'
import { recordOutput } from './lib/manifest.js'
import { query } from './lib/parquet.js'
import { METHOD, firMirror, provenance, type Provenance } from './lib/provenance.js'
import { renderReviewCsv, resolveKannadaNames } from './lib/station_names_kn.js'

const BASELINE_PATH = resolve(OUTPUT.derived, 'weekly_baselines.parquet')
const INCIDENT_PATH = resolve(OUTPUT.derived, 'incidents_time.parquet')
const STATIONS_PATH = resolve(OUTPUT.derived, 'stations.parquet')
/** 28,117 `name:kn` tags, 43 of them on `amenity=police` features. */
const OSM_PATH = resolve(SOURCE_ROOT, 'reference/raw/bengaluru_osm_overpass.json')
const FEED_PATH = resolve(OUTPUT.scenarios, 'command_feed.json')
const OUTPUT_PATH = resolve(OUTPUT.scenarios, 'station_brief.json')
const REVIEW_PATH = resolve(APP_ROOT, 'etl/overrides/station_names_kn_review.csv')
const REPORT_PATH = resolve(OUTPUT.reports, 'a17_station_brief.md')

/**
 * The last complete ISO week in the baseline grid: Mon 2023-12-25 through
 * Sun 2023-12-31. Everything on the page is stated against this week.
 */
const SNAPSHOT_WEEK_START = '2023-12-25'
const SNAPSHOT_WEEK_END = '2023-12-31'
const ANALYSIS_CUTOFF = '2023-12-31'

/** §7.5 item 5 — "open" is the four stages where a case is still moving. */
const OPEN_STAGES = ['pending_trial', 'under_investigation', 'undetected', 'un_traced'] as const

const THREE_THINGS = 3
const OLDEST_CASES = 5
const PEER_COUNT = 5
const HISTORY_WEEKS = 13

/**
 * At station × crime-head × week grain most cells hold 0–3 FIRs, so a bare
 * ranking by absolute change surfaces 0→2 blips ahead of a real movement from
 * 2→3. A headline item must therefore clear a volume floor on one side or the
 * other. Where a station has fewer than three such rows the remainder is filled
 * from what exists — a quiet week is reported as a quiet week, not padded.
 */
const MIN_HEADLINE_VOLUME = 3

/**
 * The control band on the fastest-rising card is only meaningful for a series
 * with history behind it. Same reasoning as the Command Feed eligibility gate
 * in `16_command_feed.ts`: a long-dormant series has an expectation at or near
 * zero, so every non-zero week "exceeds" it and the band says nothing.
 */
const MIN_BAND_EXPECTED = 0.5
const MIN_BAND_OBSERVATIONS = 26

/**
 * Next-week demand outlook.
 *
 * An EWMA is a one-step-ahead forecast by construction: the value after
 * observing week t is the prediction for t+1, and it uses nothing after t. So
 * the forecast here is honest in a way a forecast built on `expected_count`
 * would not be — that column multiplies in `seasonality_index`, which
 * `06_baselines.ts` fits across the *whole* series and therefore leaks future
 * weeks into past expectations. Seasonality is deliberately not applied.
 *
 * The series is built at station level (all crime heads summed per week) and
 * the EWMA and dispersion are fitted on that series directly. Summing the
 * per-crime-head limits instead would be wrong: a quantile of a sum is not the
 * sum of quantiles.
 *
 * Reported as Low / Expected / High, never a single number
 * (ULTIMATE_CAPABILITY_LIST §"Uncertainty display"). It forecasts registration
 * workload, not crime, and not who will commit one.
 */
const FORECAST_ALPHA = 0.25
const FORECAST_WEEKS = 52
const FORECAST_LOW_QUANTILE = 0.1
const FORECAST_HIGH_QUANTILE = 0.9
const NEXT_WEEK_START = '2024-01-01'

/**
 * Sanctioned strength does not exist in any source available here, and the
 * whole resource-allocation question is meaningless without it. It is
 * therefore generated — deterministically, from jurisdiction area and
 * historical caseload so the figures are plausible, with a stable per-station
 * variance so some stations are genuinely mismatched to their workload. That
 * mismatch is the point: a roster that already matched demand would demo
 * nothing.
 *
 * Every value derived from it carries `generated_demo` provenance and the UI
 * says so. It must never be presented as a real KSP establishment figure.
 */
const STRENGTH_MIN = 28
const STRENGTH_MAX = 150

const sql = (path: string): string => `read_parquet('${path.replaceAll("'", "''")}')`

function round(value: number, digits = 2): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

const num = (value: unknown): number => (typeof value === 'bigint' ? Number(value) : Number(value ?? 0))

interface StationRow extends Record<string, unknown> {
  readonly station_code: string
  readonly station_name: string
  readonly police_division: string
  readonly area_sq_km: number
}

interface DeltaRow extends Record<string, unknown> {
  readonly station_code: string
  readonly crime_head: string
  readonly fir_count: number
  readonly previous_count: number
  readonly delta: number
  readonly expected_count: number
  readonly ucl_99: number
  readonly z_score: number
  readonly window_observations: number
  readonly history: { readonly items: readonly number[] }
}

interface BeatRow extends Record<string, unknown> {
  readonly station_code: string
  readonly beat_name: string
  readonly fir_count: number
}

interface OldestRow extends Record<string, unknown> {
  readonly station_code: string
  readonly case_ref: string
  readonly crime_head: string
  readonly days_open: number
  readonly io_alias: string | null
}

interface VictimRow extends Record<string, unknown> {
  readonly station_code: string
  readonly male: number
  readonly female: number
  readonly boy: number
  readonly girl: number
  readonly previous_male: number
  readonly previous_female: number
  readonly previous_boy: number
  readonly previous_girl: number
}

interface WorkloadRow extends Record<string, unknown> {
  readonly station_code: string
  readonly open_records: number
  readonly distinct_io_aliases: number
  readonly records_without_io: number
}

interface MedianRow extends Record<string, unknown> {
  readonly station_code: string
  readonly median_weekly_registrations: number
}

async function main(): Promise<void> {
  const [baselineChecksum, incidentChecksum, stationsChecksum, osmChecksum] = await Promise.all([
    sha256File(BASELINE_PATH),
    sha256File(INCIDENT_PATH),
    sha256File(STATIONS_PATH),
    sha256File(OSM_PATH),
  ])

  const stations = (await query(
    `SELECT station_code, station_name, police_division, area_sq_km
     FROM ${sql(STATIONS_PATH)}
     WHERE is_territorial AND coverage = 'mapped' AND station_code IS NOT NULL
     ORDER BY station_code`,
  )) as StationRow[]

  // §7.5 item 2 — ranked by ABSOLUTE week-over-week change, never percentage.
  // 84% of the baseline grid is zero-filled, so a percentage denominator is
  // zero far more often than not and the ranking becomes noise.
  const deltas = (await query(
    `WITH series AS (
       SELECT station_code, crime_head,
              strftime(week_start, '%Y-%m-%d') AS week_start,
              fir_count, expected_count, ucl_99, z_score, window_observations,
              lag(fir_count) OVER (
                PARTITION BY station_code, crime_head ORDER BY week_start
              ) AS previous_count,
              list(fir_count) OVER (
                PARTITION BY station_code, crime_head ORDER BY week_start
                ROWS BETWEEN ${HISTORY_WEEKS - 1} PRECEDING AND CURRENT ROW
              ) AS history
       FROM ${sql(BASELINE_PATH)}
       WHERE station_code IS NOT NULL
     )
     SELECT station_code, crime_head, fir_count,
            coalesce(previous_count, 0) AS previous_count,
            fir_count - coalesce(previous_count, 0) AS delta,
            expected_count, ucl_99, z_score, window_observations, history
     FROM series
     WHERE week_start = '${SNAPSHOT_WEEK_START}'
       AND (fir_count > 0 OR coalesce(previous_count, 0) > 0)`,
  )) as DeltaRow[]

  // §7.5 item 4 — beat NAME and count only. No shape is emitted: the source has
  // 1,129 beat names and no geometry at all. lint-truth-ok: no-beat-geometry — names the rule it complies with.
  const beats = (await query(
    `SELECT station_code, beat_name, count(*) AS fir_count
     FROM ${sql(INCIDENT_PATH)}
     WHERE within_complete_window AND station_code IS NOT NULL
       AND beat_name IS NOT NULL AND beat_name <> ''
       AND registered_on > DATE '${ANALYSIS_CUTOFF}' - INTERVAL 90 DAY
     GROUP BY station_code, beat_name
     QUALIFY row_number() OVER (
       PARTITION BY station_code ORDER BY count(*) DESC, beat_name
     ) = 1`,
  )) as BeatRow[]

  const oldest = (await query(
    `SELECT station_code, case_ref, crime_head,
            date_diff('day', registered_on, DATE '${ANALYSIS_CUTOFF}') AS days_open,
            io_alias
     FROM ${sql(INCIDENT_PATH)}
     WHERE within_complete_window AND station_code IS NOT NULL
       AND stage IN (${OPEN_STAGES.map((stage) => `'${stage}'`).join(',')})
     QUALIFY row_number() OVER (
       PARTITION BY station_code
       ORDER BY registered_on ASC, case_ref ASC
     ) <= ${OLDEST_CASES}`,
  )) as OldestRow[]

  // §7.5 item 6 — the four categories the source actually carries. `victim_count`
  // is NOT their sum (it totals 161 across all 425,408 rows) and `victim_infant`
  // is dropped at step 03. No age banding of any kind is emitted.
  // lint-truth-ok: no-victim-age-claim — names the rule it complies with.
  const victims = (await query(
    `WITH weekly AS (
       SELECT station_code, iso_week,
              sum(victim_male) AS male, sum(victim_female) AS female,
              sum(victim_boy) AS boy, sum(victim_girl) AS girl
       FROM ${sql(INCIDENT_PATH)}
       WHERE within_complete_window AND station_code IS NOT NULL
       GROUP BY station_code, iso_week
     ),
     ordered AS (
       SELECT *,
              lag(male) OVER w AS previous_male, lag(female) OVER w AS previous_female,
              lag(boy) OVER w AS previous_boy, lag(girl) OVER w AS previous_girl
       FROM weekly
       WINDOW w AS (PARTITION BY station_code ORDER BY iso_week)
     )
     SELECT station_code, male, female, boy, girl,
            coalesce(previous_male, 0) AS previous_male,
            coalesce(previous_female, 0) AS previous_female,
            coalesce(previous_boy, 0) AS previous_boy,
            coalesce(previous_girl, 0) AS previous_girl
     FROM ordered
     QUALIFY row_number() OVER (PARTITION BY station_code ORDER BY iso_week DESC) = 1`,
  )) as VictimRow[]

  // §5b — a workload proxy. An `io_alias` proves an alias appears on a record;
  // it is not evidence of posting, availability, or sanctioned strength (which
  // does not exist anywhere in this data). All four numbers travel together so
  // the ratio can never be read on its own.
  const workload = (await query(
    `SELECT station_code,
            count(*) AS open_records,
            count(DISTINCT io_alias) AS distinct_io_aliases,
            count(*) FILTER (WHERE io_alias IS NULL OR io_alias = '') AS records_without_io
     FROM ${sql(INCIDENT_PATH)}
     WHERE within_complete_window AND station_code IS NOT NULL
       AND stage IN (${OPEN_STAGES.map((stage) => `'${stage}'`).join(',')})
     GROUP BY station_code`,
  )) as WorkloadRow[]

  // §7.5 item 7 — peers are same-division stations of comparable size. There is
  // no population denominator in this data, so this is a count of registrations,
  // never a "rate". Compared against peers, never against the city mean.
  const medians = (await query(
    `WITH weekly AS (
       SELECT station_code, week_start, sum(fir_count) AS registrations
       FROM ${sql(BASELINE_PATH)}
       WHERE station_code IS NOT NULL
         AND week_start > DATE '${SNAPSHOT_WEEK_START}' - INTERVAL 52 WEEK
         AND week_start <= DATE '${SNAPSHOT_WEEK_START}'
       GROUP BY station_code, week_start
     )
     SELECT station_code, median(registrations) AS median_weekly_registrations
     FROM weekly GROUP BY station_code`,
  )) as MedianRow[]

  // Station-level weekly totals for the forecast. Fitted on this series
  // directly rather than assembled from the per-crime-head limits.
  const weeklyTotals = (await query(
    `SELECT station_code, strftime(week_start, '%Y-%m-%d') AS week_start,
            sum(fir_count) AS registrations
     FROM ${sql(BASELINE_PATH)}
     WHERE station_code IS NOT NULL
       AND week_start > DATE '${SNAPSHOT_WEEK_START}' - INTERVAL ${FORECAST_WEEKS} WEEK
       AND week_start <= DATE '${SNAPSHOT_WEEK_START}'
     GROUP BY station_code, week_start
     ORDER BY station_code, week_start`,
  )) as Array<Record<string, unknown>>

  const seriesByStation = new Map<string, number[]>()
  for (const row of weeklyTotals) {
    const code = String(row['station_code'])
    seriesByStation.set(code, [...(seriesByStation.get(code) ?? []), num(row['registrations'])])
  }

  /** One-step-ahead outlook from a causal EWMA. No seasonal factor. */
  function forecastFor(series: readonly number[]) {
    if (series.length < 8) return null
    let ewma = series[0]!
    for (const value of series.slice(1)) ewma = FORECAST_ALPHA * value + (1 - FORECAST_ALPHA) * ewma
    const mean = series.reduce((total, value) => total + value, 0) / series.length
    const variance =
      series.reduce((total, value) => total + (value - mean) ** 2, 0) / Math.max(1, series.length - 1)
    const r = dispersion(mean, variance)
    return {
      method: 'ewma_alpha_0_25_no_seasonality_v1',
      next_week_start: NEXT_WEEK_START,
      low: negativeBinomialQuantile(ewma, r, FORECAST_LOW_QUANTILE),
      expected: round(ewma, 1),
      high: negativeBinomialQuantile(ewma, r, FORECAST_HIGH_QUANTILE),
      basis_weeks: series.length,
      recent_weeks: series.slice(-12),
    }
  }

  /**
   * Generated establishment figure. Scaled by caseload and area so it is
   * plausible, then moved by a stable per-station factor so the roster does
   * not simply track demand.
   */
  function sanctionedStrength(code: string, weeklyMedian: number, areaSqKm: number): number {
    const demand = weeklyMedian * 3.2 + areaSqKm * 1.4 + 24
    // 0.72–1.28, stable for a station across runs.
    const jitter = 0.72 + (Number(stableUint64('station_strength', code) % 57n) / 56) * 0.56
    return Math.round(Math.min(STRENGTH_MAX, Math.max(STRENGTH_MIN, demand * jitter)))
  }

  const kannada = await resolveKannadaNames(OSM_PATH, stations)

  /**
   * The overview headline. Counting exceedances in a single quiet week yields
   * zero once the eligibility gate is applied, which is honest but tells a
   * commander nothing. The ranked alerts already carry the gate, so the useful
   * and consistent figure is how many stations raised one — over the alert
   * window, which is stated alongside it rather than implied to be the week.
   */
  const feed = JSON.parse(await readFile(FEED_PATH, 'utf8')) as {
    detector: { candidate_window: string }
    alerts: readonly { id: string; station_name: string; week_start: string }[]
  }
  const alertStations = new Set(feed.alerts.map((alert) => alert.station_name))
  const alertWeeks = [...feed.alerts.map((alert) => alert.week_start)].sort()

  // ---- index the query results by station ----------------------------------
  const deltasByStation = new Map<string, DeltaRow[]>()
  for (const row of deltas) {
    const bucket = deltasByStation.get(row.station_code)
    if (bucket) bucket.push(row)
    else deltasByStation.set(row.station_code, [row])
  }
  const oldestByStation = new Map<string, OldestRow[]>()
  for (const row of oldest) {
    const bucket = oldestByStation.get(row.station_code)
    if (bucket) bucket.push(row)
    else oldestByStation.set(row.station_code, [row])
  }
  const beatByStation = new Map(beats.map((row) => [row.station_code, row]))
  const victimByStation = new Map(victims.map((row) => [row.station_code, row]))
  const workloadByStation = new Map(workload.map((row) => [row.station_code, row]))
  const medianByStation = new Map(medians.map((row) => [row.station_code, num(row.median_weekly_registrations)]))

  const baselineProv: Provenance = firMirror('derived', baselineChecksum, {
    method: METHOD.station_brief_v1,
  })
  const incidentProv: Provenance = firMirror('derived', incidentChecksum, {
    method: METHOD.station_brief_v1,
  })

  const direction = (delta: number): 'up' | 'down' | 'flat' =>
    delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'

  let aboveBand = 0

  const briefs = stations.map((station) => {
    const stationDeltas = deltasByStation.get(station.station_code) ?? []

    // Deterministic ordering: magnitude, then volume, then name — so the page
    // is byte-identical across runs (§14.6).
    const ranked = [...stationDeltas].sort(
      (left, right) =>
        Math.abs(num(right.delta)) - Math.abs(num(left.delta)) ||
        num(right.fir_count) - num(left.fir_count) ||
        left.crime_head.localeCompare(right.crime_head),
    )

    const significant = ranked.filter(
      (row) => Math.max(num(row.fir_count), num(row.previous_count)) >= MIN_HEADLINE_VOLUME,
    )
    const headline = significant.length >= THREE_THINGS ? significant : [...significant, ...ranked.filter((row) => !significant.includes(row))]

    const threeThings = headline.slice(0, THREE_THINGS).map((row) => ({
      crime_head: row.crime_head,
      registered: num(row.fir_count),
      previous_registered: num(row.previous_count),
      delta: num(row.delta),
      direction: direction(num(row.delta)),
      /** False where the row fell back below the volume floor. */
      above_volume_floor: Math.max(num(row.fir_count), num(row.previous_count)) >= MIN_HEADLINE_VOLUME,
    }))

    // §7.5 item 3 — the fastest RISING head, and only if it actually rose.
    // A series with a real expectation is preferred so the control band means
    // something; a station with no such series still gets its top riser.
    const risers = ranked.filter((row) => num(row.delta) > 0)
    const banded = risers.filter(
      (row) =>
        num(row.expected_count) >= MIN_BAND_EXPECTED &&
        num(row.window_observations) >= MIN_BAND_OBSERVATIONS,
    )
    const rising = banded[0] ?? risers[0] ?? null

    // An exceedance only counts where the series can support an expectation.
    // Counting every breach regardless re-introduced exactly the cold-start
    // artifact the Command Feed gate removes: all five stations this flagged
    // had an expected count between 0.024 and 0.262, so any non-zero week
    // "exceeded" a limit of 1.
    const exceeded = ranked.filter(
      (row) =>
        num(row.ucl_99) > 0 &&
        num(row.fir_count) > num(row.ucl_99) &&
        num(row.expected_count) >= MIN_BAND_EXPECTED &&
        num(row.window_observations) >= MIN_BAND_OBSERVATIONS,
    ).length
    if (exceeded > 0) aboveBand += 1

    const victim = victimByStation.get(station.station_code)
    const work = workloadByStation.get(station.station_code)
    const median = medianByStation.get(station.station_code) ?? 0

    const peers = stations
      .filter(
        (other) =>
          other.station_code !== station.station_code &&
          other.police_division === station.police_division,
      )
      .map((other) => ({
        station_code: other.station_code,
        station_name: other.station_name,
        median_weekly_registrations: round(medianByStation.get(other.station_code) ?? 0, 1),
        difference: Math.abs((medianByStation.get(other.station_code) ?? 0) - median),
      }))
      .sort(
        (left, right) =>
          left.difference - right.difference ||
          left.station_code.localeCompare(right.station_code),
      )
      .slice(0, PEER_COUNT)
      .map(({ difference: _difference, ...peer }) => peer)

    const knName = kannada.names.get(station.station_code)

    return {
      station_code: station.station_code,
      station_name: station.station_name,
      station_name_kn: knName?.name_kn ?? null,
      station_name_kn_provenance: knName
        ? provenance('open_reference', knName.transformation, osmChecksum, {
            method: knName.method,
            confidence: knName.confidence,
          })
        : null,
      police_division: station.police_division,
      area_sq_km: round(num(station.area_sq_km), 3),

      three_things: threeThings,

      fastest_rising: rising
        ? {
            crime_head: rising.crime_head,
            registered: num(rising.fir_count),
            previous_registered: num(rising.previous_count),
            expected_count: round(num(rising.expected_count), 1),
            ucl_99: num(rising.ucl_99),
            window_observations: num(rising.window_observations),
            /**
             * Whether the control band is worth drawing. False means the series
             * lacks the history to support an expectation, and the card should
             * show the counts without the band rather than imply a limit.
             */
            band_reliable:
              num(rising.expected_count) >= MIN_BAND_EXPECTED &&
              num(rising.window_observations) >= MIN_BAND_OBSERVATIONS,
            history_13_weeks: [...rising.history.items].map(num),
          }
        : null,

      worst_affected_beat: (() => {
        const beat = beatByStation.get(station.station_code)
        return beat ? { beat_name: beat.beat_name, registered: num(beat.fir_count) } : null
      })(),

      oldest_open_cases: (oldestByStation.get(station.station_code) ?? [])
        .sort((left, right) => num(right.days_open) - num(left.days_open) || left.case_ref.localeCompare(right.case_ref))
        .map((row) => ({
          case_ref: row.case_ref,
          crime_head: row.crime_head,
          days_open: num(row.days_open),
          io_alias: row.io_alias ?? null,
        })),

      workload: work
        ? {
            open_records: num(work.open_records),
            distinct_io_aliases: num(work.distinct_io_aliases),
            records_without_io: num(work.records_without_io),
            snapshot_cutoff: ANALYSIS_CUTOFF,
          }
        : null,

      victims: victim
        ? {
            male: num(victim.male),
            female: num(victim.female),
            boy: num(victim.boy),
            girl: num(victim.girl),
            direction: {
              male: direction(num(victim.male) - num(victim.previous_male)),
              female: direction(num(victim.female) - num(victim.previous_female)),
              boy: direction(num(victim.boy) - num(victim.previous_boy)),
              girl: direction(num(victim.girl) - num(victim.previous_girl)),
            },
          }
        : null,

      peers: {
        basis: 'same_division_nearest_median_weekly_registrations',
        median_weekly_registrations: round(median, 1),
        stations: peers,
      },

      /** Registration workload, not crime. Low / Expected / High, never one number. */
      forecast: forecastFor(seriesByStation.get(station.station_code) ?? []),

      staffing: (() => {
        const strength = sanctionedStrength(station.station_code, median, num(station.area_sq_km))
        const open = work ? num(work.open_records) : 0
        return {
          sanctioned_strength: strength,
          open_records: open,
          open_per_officer: round(open / Math.max(1, strength), 1),
          // The establishment figure is invented; the caseload is not. The
          // ratio is therefore part real and part generated, and is labelled
          // by the weaker of the two.
          provenance: provenance('generated_demo', 'generated', stationsChecksum, {
            method: METHOD.station_strength_v1,
          }),
        }
      })(),
    }
  })

  // Citywide outlook, fitted on the citywide weekly series — not a sum of the
  // per-station intervals, for the same reason the per-station forecast is not
  // a sum of per-crime-head intervals.
  const cityWeeks = new Map<string, number>()
  for (const row of weeklyTotals) {
    const week = String(row['week_start'])
    cityWeeks.set(week, (cityWeeks.get(week) ?? 0) + num(row['registrations']))
  }
  const cityForecast = forecastFor([...cityWeeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value))

  // Where the roster and the caseload disagree most. The establishment figure
  // is generated, so this ranks a demo scenario — but the caseload in it is
  // real, and the shape of the question is the one a DCP actually asks.
  const loads = briefs
    .filter((brief) => brief.staffing.open_records > 0)
    .map((brief) => ({
      station_code: brief.station_code,
      station_name: brief.station_name,
      police_division: brief.police_division,
      open_records: brief.staffing.open_records,
      sanctioned_strength: brief.staffing.sanctioned_strength,
      open_per_officer: brief.staffing.open_per_officer,
    }))
  const byLoad = [...loads].sort(
    (left, right) =>
      right.open_per_officer - left.open_per_officer ||
      left.station_code.localeCompare(right.station_code),
  )
  const cityOpen = loads.reduce((total, entry) => total + entry.open_records, 0)
  const cityStrength = loads.reduce((total, entry) => total + entry.sanctioned_strength, 0)

  const fixture = {
    schema_version: 1,
    fixture_id: 'station-brief-v1',
    // Stated everywhere on the page. The source ends here; the demo runs later.
    snapshot_week_start: SNAPSHOT_WEEK_START,
    snapshot_week_end: SNAPSHOT_WEEK_END,
    snapshot_label: 'Week ending 31 December 2023',
    analysis_cutoff: ANALYSIS_CUTOFF,
    open_stages: OPEN_STAGES,
    overview: {
      snapshot_week: SNAPSHOT_WEEK_START,
      stations_evaluated: stations.length,
      /** Gated, so this is 0 in a quiet week rather than a cold-start artifact. */
      stations_above_expected_band: aboveBand,
      /** The headline: stations that raised a ranked alert in the alert window. */
      stations_with_alert: alertStations.size,
      alert_window_start: alertWeeks[0] ?? null,
      alert_window_end: alertWeeks.at(-1) ?? null,
      // Home reads these rather than recomputing: no Parquet is a public client
      // artifact, and summing per-station UCLs would not be a valid citywide
      // limit — a quantile of a sum is not the sum of quantiles.
      top_alert_ids: feed.alerts.slice(0, 3).map((alert) => alert.id),
      provenance: baselineProv,
    },

    /** Citywide next-week outlook. Registration workload, not crime. */
    outlook: cityForecast
      ? {
          ...cityForecast,
          provenance: firMirror('derived', baselineChecksum, {
            method: METHOD.demand_outlook_v1,
          }),
        }
      : null,

    /** The resourcing picture. Establishment figures are generated. */
    staffing: {
      city_open_records: cityOpen,
      city_sanctioned_strength: cityStrength,
      city_open_per_officer: round(cityOpen / Math.max(1, cityStrength), 1),
      most_loaded: byLoad.slice(0, 5),
      most_headroom: byLoad.slice(-5).reverse(),
      provenance: provenance('generated_demo', 'generated', stationsChecksum, {
        method: METHOD.station_strength_v1,
      }),
    },
    kannada_coverage: {
      resolved: kannada.names.size,
      total: stations.length,
      unresolved: kannada.unresolved.length,
      note: 'Unresolved stations render in English. Nothing is transliterated.',
    },
    provenance: {
      baselines: baselineProv,
      incidents: incidentProv,
    },
    stations: briefs,
  }

  await mkdir(OUTPUT.scenarios, { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
  await writeFile(REVIEW_PATH, renderReviewCsv(kannada, stations), 'utf8')

  await recordOutput(
    '17_station_brief',
    OUTPUT_PATH,
    briefs.length,
    [
      { path: BASELINE_PATH, sha256: baselineChecksum },
      { path: INCIDENT_PATH, sha256: incidentChecksum },
      { path: STATIONS_PATH, sha256: stationsChecksum },
      { path: OSM_PATH, sha256: osmChecksum },
    ],
    {
      snapshot_week: SNAPSHOT_WEEK_START,
      stations_above_expected_band: aboveBand,
      kannada_resolved: kannada.names.size,
    },
  )

  await mkdir(OUTPUT.reports, { recursive: true })
  await writeFile(
    REPORT_PATH,
    `# A17 Station Intelligence Brief\n\n` +
      `- Stations: **${briefs.length}**\n` +
      `- Snapshot week: **${SNAPSHOT_WEEK_START} → ${SNAPSHOT_WEEK_END}**\n` +
      `- Stations above their expected band: **${aboveBand} of ${stations.length}**\n` +
      `- Kannada labels resolved: **${kannada.names.size} of ${stations.length}** ` +
      `(${kannada.unresolved.length} render in English)\n` +
      `- Stations with a worst-affected beat: **${beats.length}**\n` +
      `- Stations with at least one open case: **${oldestByStation.size}**\n\n` +
      `## Dates\n\n` +
      `The source ends ${ANALYSIS_CUTOFF} and the product is presented later, so no figure is described as\n` +
      `current. Every section is stated against the snapshot week and the fixture carries that date.\n\n` +
      `## Workload\n\n` +
      `Sanctioned strength does not exist in this data. The workload tile reports open records, distinct\n` +
      `non-null IO aliases, records with no alias, and the cutoff — together, never as a bare ratio. An alias\n` +
      `appearing on a record is not evidence of posting or availability.\n\n` +
      `## Peers\n\n` +
      `Five same-division stations with the nearest trailing-52-week median weekly FIR registrations. There is\n` +
      `no population denominator in this source, so this is a count and never a rate, and stations are never\n` +
      `compared against the city mean (§7.5).\n\n` +
      `## Kannada\n\n` +
      `${kannada.names.size} of ${stations.length} labels resolved from OpenStreetMap \`name:kn\` by exact\n` +
      `normalized match — 19 from \`amenity=police\` features and the rest composed from a locality label,\n` +
      `which is tagged \`derived\` rather than presented as an official name. No fuzzy matching: unmatched and\n` +
      `ambiguous stations are written to \`etl/overrides/station_names_kn_review.csv\` for human approval and\n` +
      `render in English until then.\n`,
    'utf8',
  )

  process.stdout.write(
    `A17 · ${briefs.length} station briefs · ${aboveBand} above band · ` +
      `${kannada.names.size}/${stations.length} Kannada labels\n`,
  )
}

await main()
