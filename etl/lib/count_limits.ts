/**
 * Control limits for weekly count series.
 *
 * FIR counts per station and week are small integers with more spread than a
 * Poisson allows — a few busy weeks pull the variance above the mean. So the
 * limit is the quantile of a negative binomial fitted to the series, falling
 * back to Poisson only where the data shows no overdispersion to fit.
 *
 * Extracted from `06_baselines.ts` so the weekly baseline compiler and the
 * station-brief forecast use the same arithmetic. Two copies of a quantile
 * function drift, and then two screens quote different limits for the same
 * series.
 */

/** Smallest k where the Poisson CDF reaches `quantile`. */
export function poissonQuantile(mean: number, quantile: number): number {
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

/**
 * Smallest k where the negative-binomial CDF reaches `quantile`.
 *
 * `r` is the dispersion. A non-finite or very large `r` means the fit found no
 * overdispersion, and the distribution has collapsed to Poisson.
 */
export function negativeBinomialQuantile(mean: number, r: number, quantile: number): number {
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

/**
 * Method-of-moments dispersion for a count series: `mean² / (variance − mean)`.
 * Returns `Infinity` when the series is not overdispersed, which the quantile
 * functions read as "use Poisson".
 */
export function dispersion(mean: number, variance: number): number {
  if (variance <= mean || mean <= 0) return Number.POSITIVE_INFINITY
  return (mean * mean) / (variance - mean)
}
