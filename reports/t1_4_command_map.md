# T1.4 — Command Map on MapLibre + deck.gl

Verdict: **PASS**, with one §7.1 layer omitted for a documented reason and one
inherited defect fixed.

## What the SVG version was doing

`CommandMap.tsx:86–95` projected lon/lat into a 1000×700 box by linear stretch —
not conformal, so every cell was the wrong shape and the wrong place relative to
every other. Zoom was a CSS `transform: scale()` between 1× and 2.5× with **no
pan at all**, so a judge could not move the map. Both are gone.

Now: MapLibre GL over the self-hosted PMTiles basemap with the §7.1 layer stack
attached as an interleaved deck.gl overlay, a real `MapView` controller, and
`flyTo` at `dur.fly` / `essential: true` on selection.

| §7.1 layer | Built as | Notes |
|---|---|---|
| Jurisdictions | `GeoJsonLayer` | 106 official polygons, fill `rgba(56,189,248,0.04)`, line `--ink-500` 1px; selected line `--gold-400` 2px, fill 0.10 |
| Density | `H3HexagonLayer` | `extruded:false`, magma, `opacity:0.72`, `coverage:0.92` |
| Corridors | **omitted** | see below |
| Incidents | `ScatterplotLayer` | `--gold-400`, `radiusMinPixels:2`, `radiusMaxPixels:8` |
| Alerts | `ScatterplotLayer` + pulse | `r = base·(1 + 0.55·sin t)`, alpha inverse to radius, 1.8 s period, `--critical`, capped at 6 |

Layout §5.4 needed no work — `globals.css` already lays the shell out as 56px
rail · 360px context · fluid canvas · 400px inspector · 88px timeline, and
`.ops-canvas` is bare, so the map is not inside a card.

## The corridor layer is omitted, not forgotten

`data/routing/corridor_region.json` carries `station_codes`, `station_names` and
`buffer_km`. There is no polyline anywhere in the repo. Drawing one would be
inventing geometry, so the layer is not built, and the "Visible layer rules"
panel says so on screen rather than only here.

## Two defects found by looking at the running screen

### `interpolateMagma` returns hex, and the parse was garbage

The magma helper parsed the ramp with `.match(/\d+/g)`, which assumes
`rgb(r, g, b)`. `d3-scale-chromatic` returns `#rrggbb`:

| t | returns | old parse | old result |
|---|---|---|---|
| 0.12 | `#1a1042` | `['1','1042']` | `rgb(1, 1042, NaN)` |
| 0.5 | `#b73779` | `['73779']` | fell through to black |
| 1.0 | `#fcfdbf` | `null` | black |

So the ramp emitted near-arbitrary dark colours. **This shipped in
`PatrolMap.tsx` at T1.3** — the Patrol Lab demand surface has been rendering
wrong since the deck.gl migration, and I did not catch it because a dark
surface under a teal blanket looks plausible. Both surfaces now share one
corrected implementation in `client/src/lib/geo/index.ts`, which parses both
forms and **throws** on anything else: a colour ramp that fails quietly is
indistinguishable from real data.

### A linear ramp made the city read as empty

Record counts per cell run 7 → 499, and **97.6% of cells sit below a tenth of
the maximum**. On a linear ramp that puts almost the whole city at magma's black
end. The density layer is now log-scaled, and because a ramp whose scale is not
stated is a misleading chart (§5.7), the scale is named on the map itself:
*"magma, log-scaled · 7 → 499 records"* beside a swatch of the ramp.

The old SVG had the same flaw, masked by a six-stop discrete ramp whose bottom
stop was a visible purple.

## Shared geo module

`client/src/lib/geo/index.ts` — `BLR_BBOX` was a literal in three places:
`CommandMap.tsx` had it right, `CommandFeed.tsx` had it **wrong** (77.45 / 0.4 /
13.2 / 0.45, neither the OSRM extract nor the archive), `etl/lib/geo.ts:20` is
canonical. The client now has one, plus `INITIAL_VIEW_STATE` and the one magma
ramp. `CommandFeed`'s percentage-positioned pseudo-map still carries its own
numbers; moving it onto this module is T1.5's item.

## CRITICAL #4 — no inferred coordinate rendered as a pin

`fixture.reported_points` is the only array carrying `map_pin_eligible = true`
and is the only source the `incidents` layer reads. `cells` feed hex aggregates
only; `explanations` are never plotted. The layer config carries that as a
comment so a future edit has to argue with it.

The incidents layer is deliberately **not pickable**: it sits above the density
layer, and a pickable 2–8 px dot swallows the click on the hex beneath it.
Selection in §7.1 is by cell.

## Keyboard access

A WebGL canvas gives no keyboard path to what the SVG polygons had. A parallel
`sr-only` focusable list of cells restores it — selecting a row flies the camera
and opens the inspector exactly as a click does.

## `/spike` deleted

The T0 scratch route and `components/spike/MapSpike.tsx` are gone; the plan said
to remove them after CHECKPOINT 0 and they had survived into three builds.
`/spike/` now 404s.

## Verification

- Selection verified by driving the real browser: click a hex → the camera flies
  to it, the jurisdiction polygon outlines gold, the on-canvas card and the
  inspector both switch to the new station (Ramamurthy Nagar PS → Nandini Layout
  PS).
- Offline verified with the server process killed and the port refusing
  connections: full surface renders including the 2.5 MB jurisdiction polygons
  from cache. `CACHE_NAME` → `kspcid-offline-v8`.
- `npm run check` green 10/10; `next build` succeeds.
- `reports/screenshots/t1_4_command_map.jpg` — city scale, 500 density hexes,
  500 eligible point marks, four critical pulses, selected jurisdiction outlined,
  all over real streets, lakes, place names and highway shields.

## Not claimed

60 fps during pan/zoom is not measured. The automation browser runs with the tab
backgrounded, which starves `requestAnimationFrame`, so any frame timing taken
here would be fiction. It needs a foreground browser.
