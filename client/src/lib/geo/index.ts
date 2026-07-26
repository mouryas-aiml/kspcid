/**
 * Shared geography and the one magma ramp (BUILD_SPEC §5.2, §3.3).
 *
 * `BLR_BBOX` was a literal in three places: `CommandMap.tsx` had it right,
 * `CommandFeed.tsx` had it *wrong* (77.45 / 0.4 / 13.2 / 0.45, which is neither
 * the OSRM extract nor the PMTiles archive), and `etl/lib/geo.ts:20` is the
 * canonical definition. Three copies of a bounding box is three chances to draw
 * a point in the wrong place, so the client now has one.
 *
 * §5.2 also forbids hand-rolling the sequential ramp. `PatrolLab.tsx` and
 * `CommandMap.tsx` each carried a different six-stop approximation of magma for
 * the same quantity — two ramps for one concept, neither of them magma.
 */
import { interpolateMagma } from 'd3-scale-chromatic'

/** Identical to `etl/lib/geo.ts` BLR_BBOX, the OSRM extract, and the archive header. */
export const BLR_BBOX = {
  minLon: 77.35,
  minLat: 12.7,
  maxLon: 77.85,
  maxLat: 13.2,
} as const

/** `[west, south, east, north]` — MapLibre's `fitBounds` / source-bounds order. */
export const BLR_BOUNDS: [number, number, number, number] = [
  BLR_BBOX.minLon,
  BLR_BBOX.minLat,
  BLR_BBOX.maxLon,
  BLR_BBOX.maxLat,
]

export const BLR_CENTER: [number, number] = [
  (BLR_BBOX.minLon + BLR_BBOX.maxLon) / 2,
  (BLR_BBOX.minLat + BLR_BBOX.maxLat) / 2,
]

/** Opens on the whole extract; individual surfaces fit to their own data after mount. */
export const INITIAL_VIEW_STATE = {
  longitude: BLR_CENTER[0],
  latitude: BLR_CENTER[1],
  zoom: 10.4,
  bearing: 0,
  pitch: 0,
} as const

/**
 * §5.2 — `interpolateMagma`, domain-clipped to [0.12, 0.94].
 *
 * The clip matters: magma's extremes are near-black and near-white, and both
 * ends destroy the dark surface this sits on. Returns 8-bit RGB for deck.gl.
 */
export const MAGMA_CLIP_LOW = 0.12
export const MAGMA_CLIP_HIGH = 0.94

export function magma(intensity: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 0))
  const clipped = MAGMA_CLIP_LOW + clamped * (MAGMA_CLIP_HIGH - MAGMA_CLIP_LOW)
  return parseColour(interpolateMagma(clipped))
}

/**
 * `interpolateMagma` returns `#rrggbb`, not `rgb(r, g, b)`.
 *
 * The first version of this shipped with `.match(/\d+/g)`, which on `#1a1042`
 * yields `['1', '1042']` and on `#fcfdbf` yields `null` — so the Patrol Lab
 * demand surface rendered near-arbitrary dark colours from T1.3 until this was
 * found. Both forms are handled here; anything else throws rather than
 * silently painting black, because a colour ramp that fails quietly is
 * indistinguishable from real data.
 */
function parseColour(value: string): [number, number, number] {
  if (value.startsWith('#')) {
    const hex = value.slice(1)
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((char) => char + char)
            .join('')
        : hex
    if (full.length !== 6) throw new Error(`Unparseable ramp colour: ${value}`)
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
    ]
  }
  const parsed = value.match(/\d+(\.\d+)?/g)
  if (!parsed || parsed.length < 3) throw new Error(`Unparseable ramp colour: ${value}`)
  return [Math.round(Number(parsed[0])), Math.round(Number(parsed[1])), Math.round(Number(parsed[2]))]
}

/** The same ramp as a CSS colour, for SVG and DOM surfaces that cannot take a tuple. */
export function magmaCss(intensity: number): string {
  const [r, g, b] = magma(intensity)
  return `rgb(${r} ${g} ${b})`
}
