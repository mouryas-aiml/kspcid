/**
 * Paths and constants for the KSPCID build-time compiler (BUILD_SPEC §6.4).
 *
 * Stage 1 runs on the build machine, not on Catalyst (§2.2). Nothing in this
 * directory is deployed.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `/Users/…/KSPCID` — the repository root, per BUILD_SPEC §4.
 *
 * `etl/`, `data/`, `functions/`, `appsail/` and `client/` are all siblings here.
 * Resolved rather than hardcoded, so no machine-specific path appears in source.
 */
export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The archive root. Identical to {@link APP_ROOT}: the frozen source data
 * (`Data_Docs/`, `reference/`, `mappings/`, `output/`) sits alongside the
 * compiler rather than one level above it.
 *
 * It is **read-only** from here on. The only files the compiler writes outside
 * `data/` and `reports/` are the two donor-note blocks in `DATA_DICTIONARY.md`
 * and `README.md`.
 *
 * Kept as a distinct name because the two roots are different concepts and may
 * diverge if the archive is ever relocated off the repo — see the note on
 * large-file handling in `.gitignore`.
 */
export const SOURCE_ROOT = APP_ROOT

export const INPUT = {
  /** 1,674,734 rows × 34 columns, 2016–2024. Third-party Kaggle mirror (§6.2). */
  firCsv: resolve(
    SOURCE_ROOT,
    'Data_Docs/third_party/kaggle/fir_details_karnataka_police_v2/FIR_Details_Data.csv',
  ),
  /** 106 station jurisdiction polygons with division, subdivision, area, bbox. */
  jurisdictions: resolve(SOURCE_ROOT, 'reference/processed/jurisdictions.geojson'),
  /** 140,373 OSM road/POI anchors, already tagged with `station_code`. */
  anchors: resolve(SOURCE_ROOT, 'reference/processed/anchors.json'),
  /** 135 Bengaluru station placemarks (`POL_STAName`), for crosswalk tier 2. */
  stationKml: resolve(
    SOURCE_ROOT,
    'Data_Docs/official/opencity/police_station_locations/bengaluru_urban_police_stations.kml',
  ),
} as const

export const OUTPUT = {
  derived: resolve(APP_ROOT, 'data/derived'),
  routing: resolve(APP_ROOT, 'data/routing'),
  scenarios: resolve(APP_ROOT, 'data/scenarios'),
  manifest: resolve(APP_ROOT, 'data/manifest.json'),
  reports: resolve(APP_ROOT, 'reports'),
  staging: resolve(APP_ROOT, '.staging'),
} as const

/** The one district this product analyses at row level (§6.2). */
export const TARGET_DISTRICT = 'Bengaluru City'

/**
 * Analysis cutoff — the last date inside the complete collection window.
 *
 * The source stops mid-March 2024: Bengaluru City has 72,902 rows for 2023 and
 * 12,654 for 2024 (Jan 5,245 · Feb 5,720 · Mar 1,689). That is a −82.6%
 * year-over-year drop of pure collection artifact.
 *
 * Left unhandled it would poison three things: every trend line ending in 2024
 * shows a fake crime collapse; the §6.4 step 06 rolling 52-week EWMA baselines
 * get fitted over a mostly-empty window; and §7.6's Command Feed — whose whole
 * premise is "registered FIRs above the 52-week expected range" — fires on
 * everything or on nothing.
 *
 * 2024 rows are **retained** (dropping them would break the exact `GROUP BY`
 * reconciliation §7.4 requires) but carry `within_complete_window = false`, and
 * every trend, baseline and feed query filters on it by default.
 */
export const ANALYSIS_CUTOFF = '2023-12-31'

/**
 * The audited demo spine (§11.1): `THEFT / Of Automobiles - Of Two Wheelers`
 * along a west→east chain that crosses a division boundary.
 *
 * An earlier draft used Kadugodi chain snatching; a data audit killed it
 * (1,784 rows across 109 stations over 9 years, peak station-month of 6 — a
 * "12 this week vs 5 expected" alert is not supportable). Do not hand-pick a
 * narrative again: `audit_demo_spine.ts` re-ranks alternates automatically.
 */
export const DEMO_SPINE = Object.freeze({
  crimeHead: 'Of Automobiles - Of Two Wheelers',
  crimeGroup: 'THEFT',
  /** Consecutive pairs share a boundary; the last is in a different division. */
  stations: Object.freeze([
    'Kadugondana Halli',
    'Banaswadi',
    'Ramamurthy Nagar',
    'K.R. Puram',
  ] as const),
} as const)

/**
 * The mappable-cyber figure §7.7 puts on screen: **13.66%** (8,823 of 64,599).
 *
 * Decided against the spec's 14.4%. Same data, different box — 14.4% was
 * measured on a wider "plausible Bengaluru" extent, 13.66% on the routable
 * OSRM extract (`BLR_BBOX`). The routable figure is the defensible one because
 * it is the share the map can actually use; a coordinate the router cannot
 * reach is not mappable in any sense the product means. 16.4% non-zero may
 * appear as a secondary note, exactly as §7.7 allows.
 */
export const CYBER_MAPPABLE = Object.freeze({ rows: 8_823, of: 64_599, share: '13.66%' })

/**
 * Corridor reality check, measured on the four §11.1 spine stations.
 *
 * Only **22.29%** of corridor two-wheeler-theft rows (822 of 3,687) carry a
 * coordinate inside the routable extent. Roughly four in five corridor
 * incidents resolve to `inferred` and are therefore `map_pin_eligible: false`.
 *
 * Two consequences for step 03 and the demo: the premise tokenizer and
 * anchor-bias logic carry more weight on this corridor than the citywide
 * average suggests, and the visual density along the corridor comes from hex
 * aggregates, not from pins. That is the §6.3 rendering rule working as
 * intended, not a shortfall.
 */
export const CORRIDOR_COORD_SHARE = '22.29%'

/**
 * Non-territorial unit patterns (§6.4 step 02). These units have no jurisdiction
 * polygon: they are excluded from map geography but kept in every count.
 *
 * Used only to *propose* classifications into
 * `etl/overrides/station_crosswalk_manual.csv`, which is the reviewed source of
 * truth. §6.4 requires zero silent fallbacks, so nothing is classified by
 * pattern alone.
 */
export const NON_TERRITORIAL_HINTS: readonly RegExp[] = Object.freeze([
  /\bCCB\b/i,
  /\bCID\b/i,
  /cyber\s*crime/i,
  /\bwomen\b.*\bPS\b/i,
  /\btraffic\b/i,
  /\brailway\b/i,
  /\bCEN\b/i,
  /anti[\s-]?terror/i,
  /\bchief\s+office\b/i,
])
