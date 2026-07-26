# T1.5 — Charts on Visx

Verdict: **PASS**, with one §1.4 feature **not built** for a data reason and one
detector finding surfaced rather than hidden.

Installed `@visx/scale`, `@visx/shape`, `@visx/group`, `@visx/hierarchy`,
`@visx/axis`, `@visx/curve`.

## One sparkline, zero-based

There were three, each with its own normalisation: `MetricTile` scaled to
`[min, max]` of its own series, `CommandFeed` scaled to `[0, max]`, and the
Command Map timeline used a third. The same shape meant different things on
three screens and the reader had no way to know which.

`components/primitives/Sparkline.tsx` is now the only one, and it **always
scales from zero**. A count sparkline whose baseline is the series minimum
exaggerates every wobble — a 13-week run of 4,4,4,4,5 draws as a step change.
Zero-based is the honest default for counts, so it is the only mode offered.

`MetricTile` also picked up two §5.6 corrections: `tabular-nums` on the value,
and the delta coloured **by direction, not by good/bad**. It previously painted
every rise `--critical` red, which asserts that up is bad — a judgment that
depends on the metric and belongs to the reader.

## The control band, and what drawing it revealed

`command_feed.json` has carried `expected_count` and `ucl_99` on every alert
since A16 and nothing drew them, so the reader saw a rising line with no way to
judge whether it was unusual — which is the entire claim the alert makes. The
band is now drawn: shaded expected → UCL, dashed limit line, solid centre line,
and the current-period marker turns `--critical` when it sits above the limit.

Drawing it surfaced a finding. **All 30 alerts in the shipped snapshot have
`expected_count = 0` and `ucl_99 = 0`**, so the band is degenerate on every one
of them:

| | |
|---|---|
| alerts in snapshot | 30 |
| alerts with `ucl_99 > expected_count > 0` | **0** |
| typical `history_13_weeks` | `[0,0,0,0,0,0,0,0,0,0,0,0,5]` |

The detector is surfacing categories with **no 13-week history**, not
excursions above a fitted rate. That is a weaker and different claim, and the
`20+σ` badge is a divide-by-zero artifact — one alert carries a raw z-score of
`5.14e17`. The inspector now says so in place of an empty band:

> No control band: the 13-week baseline for this category is zero, so the
> expected count and the 99% limit are both 0. This is a first-occurrence
> signal, not an excursion above a fitted rate.

Fixing the detector is `etl/16_command_feed.ts`, outside T1.5. Recorded here so
it is not mistaken for a rendering gap.

## Pulse Ring — roster band built, weekday/weekend toggle NOT built

§1.4's roster overlay is the point of the chart, and it now exists: the
generated shift roster as a gold **annulus** whose thickness at each hour is the
strength. It was previously 24 dots at a fixed radius with opacity varying —
readable as decoration, not as a band. (First attempt filled the whole disc; an
annulus is what makes thickness the reading.)

The caption is **computed, never the spec's example string**. §1.4 gives
*"Peak 20:00–23:00 · patrol strength falls 21:00"* from an illustrative cell.
Hard-coding that would put a finding on screen this fixture does not support.
For the shipped cell it renders:

> Peak **13:00** · patrol strength falls **21:00** (−2 units)
> 9 records with a derived hour in this cell — too few to read as a shift
> pattern; shown as the cell's own history, not a rate.

**The weekday/weekend cross-fade toggle is not built, and should not be.** The
only weekday available is the weekday of `registered_on`, the *registration*
date. Occurrence hour is itself modelled from crime-head × premise × weekday
(`04_time_model.ts`), and there is no recorded occurrence date. Splitting by
registration weekday and presenting it as a weekday/weekend *occurrence* pattern
would put a registration artifact on screen dressed as a crime finding — and
`lint_data_truth.ts` bans exactly this class of claim. Building it needs an
occurrence date the source does not have. **DRIFT, deliberate.**

## Justice — a real Sankey where the data is a real graph, and not where it isn't

`modelled.edges` is a DAG rooted at `registered`, six columns deep, 15 nodes,
14 edges. It was drawn as a grid of independent bars, throwing away the one
thing the data has: that these paths connect. It is now a Sankey — layered
layout by longest path, node height from the larger of inflow and outflow,
ribbons sized by path count.

The **observed** view is deliberately still a fan and is not called a Sankey.
`observed.stages` is a single hop from registration to current stage; a
multi-stage ribbon diagram over one hop would imply transitions the source does
not record.

Visx has no Sankey primitive. The layered layout is written out; the ribbons are
generated directly because `@visx/shape`'s link generators emit a stroked centre
line and a Sankey link is a filled variable-width band.

Verified by DOM measurement — 15 node rects across 6 columns at x =
0/98/195/293/390/488, 14 ribbons, heights proportional (Registered 388 px =
4,25,408; Transferred 1 px = 651), labels in Indian digit grouping.

## Cyber treemap — built

Did not exist. `@visx/hierarchy` treemap over the 18 exact act/section
combinations, §5.2 categorical colours in order. Two truth constraints:

- Exact source `act_section` strings, **not merged** — which is what the panel's
  provenance note already claimed. Several tiles differ only by Act year or
  section order and they stay separate.
- The fixture carries the top 18, not all. The tail is one
  *"All other combinations"* tile at the genuine remainder — 6,319 FIRs against
  `summary.cyber_records` — so the areas sum to 64,599 instead of silently
  dropping 10% of the caseload.

The top two combinations are 57.7% of the cyber caseload, which is the thing a
ranked bar list could not show at a glance. The panel was widened to full width;
a treemap in a 250 px column cannot label its own tiles.

## Command Feed — the third geographic renderer, retired

This was the only projection in the product that was simply **wrong**: DOM
markers at `((lon − 77.45) / 0.4)` × `((13.2 − lat) / 0.45)`, a bounding box
that is neither the OSRM extract nor the PMTiles archive, linearly stretched.
Two alerts a kilometre apart could land in the wrong order relative to each
other.

It is now the same self-hosted basemap as every other surface, with the 26
alerts as MapLibre `Marker`s. Markers rather than a deck.gl layer on purpose:
they are buttons with hover, focus and selection states, and a DOM element keeps
the keyboard path and the styling a WebGL layer would have to reinvent.
Selecting from the list flies the camera, so the two halves stay in step.

That closes CHECKPOINT 3's first line — streets and place names now render under
**every** map surface: `/map/`, `/patrol/`, `/feed/`.

## Shared tokens

`client/src/lib/charts.ts` — the §5.2 categorical eight in order, the "Other"
grey, and a `withOther` helper that folds a long tail into one honest row rather
than generating a ninth colour.

## Gates

- `npm run check` green 10/10; `next build` succeeds.
- Pulse Ring, treemap, Sankey and control band all verified in the running
  browser by DOM measurement and screenshot.
- The light `(brief)` Justice page does not composite correctly through this
  automation harness (large black region, content pinned below the fold), so the
  Sankey was verified by measuring its rendered geometry rather than by eye. It
  needs a look in a real browser before the demo.

## Left for later, named

- `16_command_feed.ts` detector: zero baselines producing `20+σ` badges.
- Pulse Ring weekday/weekend toggle: blocked on occurrence date (above).
- 60 fps pan/zoom still unmeasured — the automation tab is backgrounded, which
  starves `requestAnimationFrame`, so any frame timing taken here is fiction.
