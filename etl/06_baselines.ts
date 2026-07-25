/**
 * 06 — Weekly station × crime-head baselines (BUILD_SPEC §6.4 step 06).
 *
 * The input filter `within_complete_window = true` is applied in the aggregate
 * query itself. The 12,654 partial-window 2024 rows therefore cannot enter a
 * count, seasonal factor, EWMA, dispersion estimate, or control limit.
 *
 * Each observed station/unit × crime-head pair gets a dense zero-filled weekly
 * series from the ISO week containing 2016-01-01 (2015-12-28) through
 * 2023-12-25. The row for week t is scored only
 * against weeks < t:
 *   - rolling 52-week history
 *   - EWMA alpha = 0.25
 *   - ISO-week seasonality over the complete series
 *   - exact 99th-percentile negative-binomial UCL when overdispersed
 *   - Poisson limit when variance does not exceed the mean
 *
 *   npm run etl:06
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { OUTPUT } from './00_config.js'
import { GENERATION_VERSION, sha256File } from './lib/hash.js'
import { recordOutput } from './lib/manifest.js'
import { ParquetWriter, query, type Column } from './lib/parquet.js'

const INPUT_PATH = resolve(OUTPUT.derived, 'incidents_time.parquet')
const OUTPUT_PATH = resolve(OUTPUT.derived, 'weekly_baselines.parquet')
const ALPHA = 0.25
const WINDOW = 52
const UCL_QUANTILE = 0.99
const WEEK_MS = 7 * 24 * 60 * 60 * 1_000
const FIRST_WEEK_MS = Date.UTC(2015, 11, 28)
const LAST_WEEK_MS = Date.UTC(2023, 11, 25)
const TOTAL_WEEKS = Math.round((LAST_WEEK_MS - FIRST_WEEK_MS) / WEEK_MS) + 1

const COLUMNS: readonly Column[] = [
  { name: 'station_key', type: 'VARCHAR' },
  { name: 'station_code', type: 'VARCHAR' },
  { name: 'unit_name', type: 'VARCHAR' },
  { name: 'crime_head', type: 'VARCHAR' },
  { name: 'week_start', type: 'DATE' },
  { name: 'iso_week', type: 'VARCHAR' },
  { name: 'fir_count', type: 'INTEGER' },
  { name: 'ewma', type: 'DOUBLE' },
  { name: 'expected_count', type: 'DOUBLE' },
  { name: 'mean_52', type: 'DOUBLE' },
  { name: 'variance_52', type: 'DOUBLE' },
  { name: 'dispersion_r', type: 'DOUBLE' },
  { name: 'ucl_99', type: 'INTEGER' },
  { name: 'z_score', type: 'DOUBLE' },
  { name: 'seasonality_index', type: 'DOUBLE' },
  { name: 'window_observations', type: 'INTEGER' },
  { name: 'source_authority', type: 'VARCHAR' },
  { name: 'transformation', type: 'VARCHAR' },
  { name: 'method', type: 'VARCHAR' },
  { name: 'source_checksum', type: 'VARCHAR' },
  { name: 'generation_version', type: 'VARCHAR' },
]

interface AggregateRow {
  readonly station_key: string
  readonly station_code: string | null
  readonly unit_name: string
  readonly crime_head: string
  readonly week_start: string
  readonly n: number | bigint
}

interface Series {
  readonly stationKey: string
  readonly stationCode: string | null
  readonly unitName: string
  readonly crimeHead: string
  readonly counts: Uint32Array
}

interface IsoWeek {
  readonly label: string
  readonly number: number
}

function isoWeek(epochMs: number): IsoWeek {
  const date = new Date(epochMs)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const isoYear = date.getUTCFullYear()
  const yearStart = Date.UTC(isoYear, 0, 1)
  const number = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7)
  return { label: `${isoYear}-W${String(number).padStart(2, '0')}`, number }
}

function dateText(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}

function poissonQuantile(mean: number, quantile: number): number {
  if (mean <= 0) return 0
  let probability = Math.exp(-mean)
  let cumulative = probability
  let k = 0
  while (cumulative < quantile && k < 10_000) {
    k++
    probability *= mean / k
    cumulative += probability
  }
  return k
}

function negativeBinomialQuantile(mean: number, r: number, quantile: number): number {
  if (mean <= 0) return 0
  if (!Number.isFinite(r) || r > 1_000_000) return poissonQuantile(mean, quantile)
  const success = r / (r + mean)
  const failure = 1 - success
  let probability = Math.pow(success, r)
  let cumulative = probability
  let k = 0
  while (cumulative < quantile && k < 10_000) {
    probability *= ((k + r) / (k + 1)) * failure
    k++
    cumulative += probability
  }
  return k
}

function weekIndex(weekStart: string): number {
  const parsed = Date.parse(`${weekStart}T00:00:00Z`)
  return Math.round((parsed - FIRST_WEEK_MS) / WEEK_MS)
}

async function main(): Promise<void> {
  const started = Date.now()
  const inputChecksum = await sha256File(INPUT_PATH)
  process.stdout.write('06 · aggregating complete-window FIR registrations…\n')

  const aggregates = (await query(
    `SELECT coalesce(station_code, 'UNIT:' || unit_name) station_key,
            station_code,
            unit_name,
            crime_head,
            strftime(date_trunc('week', registered_on), '%Y-%m-%d') week_start,
            count(*)::BIGINT n
     FROM '${INPUT_PATH}'
     WHERE within_complete_window = true
     GROUP BY 1, 2, 3, 4, 5
     ORDER BY 1, 4, 5`,
  )) as unknown as AggregateRow[]

  const seriesByKey = new Map<string, Series>()
  let completeWindowRows = 0
  for (const row of aggregates) {
    const seriesKey = `${row.station_key}\u0000${row.crime_head}`
    let series = seriesByKey.get(seriesKey)
    if (!series) {
      series = {
        stationKey: row.station_key,
        stationCode: row.station_code,
        unitName: row.unit_name,
        crimeHead: row.crime_head,
        counts: new Uint32Array(TOTAL_WEEKS),
      }
      seriesByKey.set(seriesKey, series)
    }
    const index = weekIndex(row.week_start)
    if (index < 0 || index >= TOTAL_WEEKS) {
      throw new Error(`Complete-window week outside model bounds: ${row.week_start}`)
    }
    const count = Number(row.n)
    series.counts[index] = count
    completeWindowRows += count
  }

  const weeks = Array.from({ length: TOTAL_WEEKS }, (_, index) => {
    const epochMs = FIRST_WEEK_MS + index * WEEK_MS
    return { epochMs, date: dateText(epochMs), ...isoWeek(epochMs) }
  })
  const writer = await ParquetWriter.create('weekly_baselines', COLUMNS)
  let written = 0
  let alertCandidates = 0
  let pairNumber = 0

  process.stdout.write(
    `06 · fitting ${seriesByKey.size.toLocaleString()} dense weekly series ` +
      `(${(seriesByKey.size * TOTAL_WEEKS).toLocaleString()} rows)…\n`,
  )

  for (const series of seriesByKey.values()) {
    const byIsoWeek = new Map<number, { sum: number; n: number }>()
    let seriesTotal = 0
    for (let index = 0; index < TOTAL_WEEKS; index++) {
      const count = series.counts[index] ?? 0
      const weekNumber = weeks[index]!.number
      const bucket = byIsoWeek.get(weekNumber) ?? { sum: 0, n: 0 }
      bucket.sum += count
      bucket.n++
      byIsoWeek.set(weekNumber, bucket)
      seriesTotal += count
    }
    const overallMean = seriesTotal / TOTAL_WEEKS
    const seasonal = new Map<number, number>()
    for (const [weekNumber, bucket] of byIsoWeek) {
      seasonal.set(
        weekNumber,
        overallMean > 0 ? bucket.sum / bucket.n / overallMean : 1,
      )
    }

    const rolling: number[] = []
    let sum = 0
    let sumSquares = 0
    let ewma = 0
    let hasEwma = false

    for (let index = 0; index < TOTAL_WEEKS; index++) {
      const count = series.counts[index] ?? 0
      const historyN = rolling.length
      const mean = historyN > 0 ? sum / historyN : 0
      const rawVariance =
        historyN > 0 ? Math.max(0, sumSquares / historyN - mean * mean) : 0
      const r =
        mean > 0 && rawVariance > mean
          ? (mean * mean) / (rawVariance - mean)
          : Number.POSITIVE_INFINITY
      const seasonality = seasonal.get(weeks[index]!.number) ?? 1
      const expected = (hasEwma ? ewma : mean) * seasonality
      const expectedVariance =
        Number.isFinite(r) && r > 0 ? expected + (expected * expected) / r : expected
      const ucl = negativeBinomialQuantile(expected, r, UCL_QUANTILE)
      const zScore =
        expectedVariance > 0 ? (count - expected) / Math.sqrt(expectedVariance) : count > 0 ? count : 0
      const updatedEwma = hasEwma ? ALPHA * count + (1 - ALPHA) * ewma : count

      if (count >= 5 && count > ucl) alertCandidates++
      await writer.write({
        station_key: series.stationKey,
        station_code: series.stationCode,
        unit_name: series.unitName,
        crime_head: series.crimeHead,
        week_start: weeks[index]!.date,
        iso_week: weeks[index]!.label,
        fir_count: count,
        ewma: updatedEwma,
        expected_count: expected,
        mean_52: mean,
        variance_52: rawVariance,
        dispersion_r: Number.isFinite(r) ? r : null,
        ucl_99: ucl,
        z_score: zScore,
        seasonality_index: seasonality,
        window_observations: historyN,
        source_authority: 'third_party_mirror',
        transformation: 'derived',
        method: 'weekly_baseline_v1',
        source_checksum: inputChecksum,
        generation_version: GENERATION_VERSION,
      })
      written++
      ewma = updatedEwma
      hasEwma = true

      rolling.push(count)
      sum += count
      sumSquares += count * count
      if (rolling.length > WINDOW) {
        const removed = rolling.shift() ?? 0
        sum -= removed
        sumSquares -= removed * removed
      }
    }
    pairNumber++
    if (pairNumber % 1_000 === 0) {
      process.stdout.write(
        `  … ${pairNumber.toLocaleString()} / ${seriesByKey.size.toLocaleString()} series\n`,
      )
    }
  }

  const outputRows = await writer.finish(OUTPUT_PATH)
  await recordOutput(
    '06_baselines',
    OUTPUT_PATH,
    outputRows,
    [{ path: INPUT_PATH, sha256: inputChecksum }],
    {
      input_complete_window_rows: completeWindowRows,
      excluded_partial_2024_rows: 12_654,
      pairs: seriesByKey.size,
      weeks_per_pair: TOTAL_WEEKS,
      alpha: ALPHA,
      rolling_weeks: WINDOW,
      ucl_quantile: UCL_QUANTILE,
      ucl_distribution: 'negative_binomial_with_poisson_limit',
      alert_candidates_raw_count_gte_5: alertCandidates,
    },
  )

  await mkdir(OUTPUT.reports, { recursive: true })
  await writeFile(
    resolve(OUTPUT.reports, 'a7_baselines.md'),
    [
      '# A7 / 06 — Weekly baselines',
      '',
      '**PASS** — every fit input is inside `within_complete_window`.',
      '',
      `- Complete-window input rows: **${completeWindowRows.toLocaleString()}**`,
      '- Partial 2024 rows excluded before aggregation: **12,654**',
      `- Station/unit × crime-head pairs: **${seriesByKey.size.toLocaleString()}**`,
      `- Dense weekly output rows: **${outputRows.toLocaleString()}**`,
      `- Weeks per pair: **${TOTAL_WEEKS}** (ISO week 2015-12-28 through 2023-12-25)`,
      `- EWMA alpha: **${ALPHA}**`,
      `- UCL: exact **${UCL_QUANTILE * 100}th percentile** negative-binomial; Poisson limit when not overdispersed`,
      '',
      'The current week is scored only against prior weeks; it enters the rolling',
      'window and EWMA after its control values are emitted.',
      '',
    ].join('\n'),
    'utf8',
  )

  const expectedRows = seriesByKey.size * TOTAL_WEEKS
  if (
    completeWindowRows !== 412_754 ||
    written !== expectedRows ||
    outputRows !== expectedRows
  ) {
    throw new Error(
      `Baseline reconciliation failed: input=${completeWindowRows}, written=${outputRows}, expected=${expectedRows}`,
    )
  }
  process.stdout.write(
    `06 complete in ${((Date.now() - started) / 1000).toFixed(1)}s — ` +
      `${outputRows.toLocaleString()} weekly baselines · 2024 excluded\n`,
  )
}

main().catch((error: unknown) => {
  process.stderr.write(`06 failed: ${String(error)}\n`)
  process.exitCode = 1
})
