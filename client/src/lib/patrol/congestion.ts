/**
 * Hour-of-day congestion calibration — BUILD_SPEC §8.4.
 *
 * OSRM returns free-flow durations: §3.3 measured 39–49 km/h over the corridor,
 * and the validated median across the 100 sampled pairs in
 * `data/routing/validation.json` is 44.0 km/h. Bengaluru does not move at
 * 44 km/h, so uncalibrated coverage and response times read far too generous —
 * §3.3 puts it at "roughly 3× too generous", which the numbers below confirm.
 *
 * This module is the single source of truth for the correction. It is imported
 * by both the client (scoring, simulation) and the ETL step that publishes
 * `data/routing/travel_time_profiles.json`, so the shipped artifact and the
 * running product can never drift apart.
 *
 * **The multiplier is applied at runtime only.** §8.4: "Conditions modify
 * durations, not geometry." `etl/08_routing_matrix.ts` keeps
 * `congestion_baked_in: false` and `verify_routing.ts` asserts it.
 */

/**
 * TomTom Traffic Index 2025 — Bengaluru, **city** area (not metro).
 * https://www.tomtom.com/traffic-index/bengaluru-traffic/ — retrieved 2026-07-26.
 *
 * TomTom defines "congestion level" as the percentage of extra travel time
 * versus free-flow, so each published pair is internally consistent: the
 * implied free-flow is 16.6 × 1.744 ≈ 14.6 × 1.942 ≈ 13.2 × 2.152 ≈ 28.4 km/h.
 * That is TomTom's own free-flow reference, and it is markedly lower than
 * OSRM's speed-limit-derived 44.0 km/h — which is exactly why the correction
 * below is computed against the OSRM baseline we actually route on, rather than
 * by reusing TomTom's congestion percentage directly.
 */
export const TOMTOM_BENGALURU_2025 = Object.freeze({
  source: 'TomTom Traffic Index 2025 — Bengaluru (city)',
  url: 'https://www.tomtom.com/traffic-index/bengaluru-traffic/',
  retrieved: '2026-07-26',
  average_speed_kmh: 16.6,
  average_congestion_level_percent: 74.4,
  morning_rush_speed_kmh: 14.6,
  morning_rush_congestion_percent: 94.2,
  evening_rush_speed_kmh: 13.2,
  evening_rush_congestion_percent: 115.2,
  ten_km_travel_time: '36 min 9 s',
})

/**
 * Median OSRM free-flow speed over the 100 validated corridor pairs in
 * `data/routing/validation.json` (p25 39.5, median 44.0, p75 50.5 km/h),
 * consistent with the 39–49 km/h range §3.3 records.
 */
export const OSRM_FREE_FLOW_KMH = 44.0

export type CongestionBand = 'morning_rush' | 'evening_rush' | 'all_day'

/**
 * TomTom publishes figures for three bands, not for 24 individual hours — the
 * per-hour chart on the city page is canvas-rendered and exposes no values.
 * Rather than invent an hourly curve, every hour outside the two published rush
 * windows takes the published **all-day average**.
 *
 * That is deliberately conservative for this scenario: the demo shift runs
 * 20:00–02:00, and treating those hours as all-day-average rather than
 * free-flowing night traffic *overstates* congestion, which understates
 * coverage. It never flatters the plan.
 *
 * The hour windows themselves are an assumption — TomTom names the bands but
 * does not publish their boundaries. Flagged as such in the emitted artifact.
 */
const MORNING_RUSH_HOURS = [7, 8, 9] as const
const EVENING_RUSH_HOURS = [17, 18, 19] as const

export function bandForHour(hour: number): CongestionBand {
  const h = ((hour % 24) + 24) % 24
  if ((MORNING_RUSH_HOURS as readonly number[]).includes(h)) return 'morning_rush'
  if ((EVENING_RUSH_HOURS as readonly number[]).includes(h)) return 'evening_rush'
  return 'all_day'
}

/** The measured TomTom speed that applies to this hour, in km/h. */
export function assumedSpeedKmh(hour: number): number {
  switch (bandForHour(hour)) {
    case 'morning_rush':
      return TOMTOM_BENGALURU_2025.morning_rush_speed_kmh
    case 'evening_rush':
      return TOMTOM_BENGALURU_2025.evening_rush_speed_kmh
    default:
      return TOMTOM_BENGALURU_2025.average_speed_kmh
  }
}

/**
 * Multiply a stored free-flow duration by this to get a congested duration.
 *
 * `OSRM free-flow speed ÷ observed speed` — 44.0/16.6 = 2.65 off-peak,
 * 44.0/13.2 = 3.33 in the evening peak.
 */
export function congestionMultiplier(hour: number): number {
  return Number((OSRM_FREE_FLOW_KMH / assumedSpeedKmh(hour)).toFixed(4))
}

/**
 * Local clock hour for a point in a scenario's shift.
 *
 * `selected_hours_local[0]` is the hour the shift opens; simulation minutes run
 * forward from there and wrap past midnight.
 */
export function hourForSimulationMinute(
  selectedHoursLocal: readonly number[],
  simulationMinute: number,
): number {
  const start = selectedHoursLocal[0] ?? 0
  return (start + Math.floor(simulationMinute / 60)) % 24
}

/** The 24-hour profile, for the published artifact and the UI disclosure. */
export function hourProfile(): readonly {
  hour: number
  band: CongestionBand
  assumed_speed_kmh: number
  multiplier: number
}[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    band: bandForHour(hour),
    assumed_speed_kmh: assumedSpeedKmh(hour),
    multiplier: congestionMultiplier(hour),
  }))
}
