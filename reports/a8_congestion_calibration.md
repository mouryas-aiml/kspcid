# A8 congestion calibration — PASS

OSRM stores free-flow durations. Measured over the 100 validated corridor pairs in
`data/routing/validation.json`: **p25 39.5 · median 44 · p75 50.5 km/h**, matching the 39–49 km/h range §3.3 records.
Bengaluru does not move at 44 km/h.

## Source

[TomTom Traffic Index 2025 — Bengaluru (city)](https://www.tomtom.com/traffic-index/bengaluru-traffic/) — retrieved 2026-07-26.

| figure | value |
|---|---:|
| Average speed (all day) | 16.6 km/h |
| Average congestion level | 74.4% |
| Morning rush speed | 14.6 km/h (congestion 94.2%) |
| Evening rush speed | 13.2 km/h (congestion 115.2%) |
| Travel time for 10 km | 36 min 9 s |

TomTom's "congestion level" is extra travel time versus free-flow, so its figures are
internally consistent: 16.6 × 1.744 ≈ 14.6 × 1.942 ≈ 13.2 × 2.152 ≈ **28.4 km/h** implied
free-flow. That is TomTom's own baseline and is far below OSRM's speed-limit-derived
44 km/h, so the multiplier is computed against the baseline we actually route on
(`OSRM free-flow ÷ observed speed`) rather than by reusing TomTom's percentage.

## Multipliers

| band | assumed speed | multiplier |
|---|---:|---:|
| All day / off-peak | 16.6 km/h | **×2.6506** |
| Morning rush (07–09) | 14.6 km/h | ×3.0137 |
| Evening rush (17–19) | 13.2 km/h | **×3.3333** |

§3.3 predicted that uncalibrated coverage reads "roughly 3× too generous". The measured
correction is ×2.6506 off-peak and ×3.3333 in the evening peak, which confirms it.

## What this does and does not correct

Applied as a **runtime multiplier only**, at the `conditionFactor` seam in
`scoring.ts` and `simulation.ts`, resolved per replay event from that event's own clock
hour. Stored durations are untouched and `congestion_baked_in` stays `false` (§8.4).

**Known limitation — the coverage component is still free-flow.** Coverage bitsets are
precomputed per origin hex × five fixed response budgets and cannot be rescaled at
runtime, so the 400-point coverage term still answers "reachable within 7 free-flow
minutes", not 7 congested minutes. Only the 250-point response term and the dispatch
simulation are corrected. §8.4 anticipates this — "switching conditions swaps the active
bitset table" — which needs one precompiled bitset set per condition band. Not built;
at ×2.6506 off-peak the honest reading is that a 7-minute blanket is closer to a
2.6-minute one, and the UI states the assumed speed on screen so the gap is visible.

Hour windows are an assumption (TomTom names the bands, not their boundaries); the
speeds are published figures. Hours outside the two rush bands take the all-day average,
which for the 20:00–02:00 demo shift overstates congestion rather than flattering it.
