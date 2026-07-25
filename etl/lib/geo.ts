/**
 * Geography primitives (BUILD_SPEC §6.3, §6.4 step 03, §8.4).
 */
import { booleanPointInPolygon, distance, explode, nearestPoint, point } from '@turf/turf'
import { latLngToCell } from 'h3-js'
import type { Feature, MultiPolygon, Polygon } from 'geojson'

/**
 * Canonical Bengaluru extent. Identical to the §3.3 OSRM extract bbox.
 *
 * A coordinate outside this box cannot be routed, so it is useless to the
 * Patrol Lab, the coverage engine and the corridor model regardless of whether
 * it is geographically "plausible". Plausibility is a judgment call;
 * routability is a fact.
 *
 * This supersedes both the 12.5–13.3 / 77.2–78.0 box and the data catalog's
 * "broad plausible Bengaluru bounding box". Neither is used anywhere in KSPCID.
 */
export const BLR_BBOX = Object.freeze({
  minLon: 77.35,
  minLat: 12.7,
  maxLon: 77.85,
  maxLat: 13.2,
})

/**
 * A coordinate is usable only if it is non-zero AND inside the routable extent.
 *
 * `(0, 0)` is the source's null coordinate, not a location in the Gulf of
 * Guinea. §7.7 makes this distinction load-bearing: 1,332 cyber rows carry
 * non-zero coordinates that fall outside any plausible Bengaluru extent, which
 * is why the quotable mappability figure is 14.4% and not 16.4%.
 */
export function isUsableCoordinate(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false
  if (lat === 0 || lon === 0) return false
  return (
    lat >= BLR_BBOX.minLat &&
    lat <= BLR_BBOX.maxLat &&
    lon >= BLR_BBOX.minLon &&
    lon <= BLR_BBOX.maxLon
  )
}

export type StationFeature = Feature<Polygon | MultiPolygon, Record<string, unknown>>

/** Cheap bbox rejection before the expensive point-in-polygon test. */
export function inFeatureBbox(feature: StationFeature, lat: number, lon: number): boolean {
  const bbox = feature.properties['bbox'] as [number, number, number, number] | undefined
  if (!bbox) return true
  const [minLon, minLat, maxLon, maxLat] = bbox
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat
}

export function isInside(feature: StationFeature, lat: number, lon: number): boolean {
  if (!inFeatureBbox(feature, lat, lon)) return false
  return booleanPointInPolygon(point([lon, lat]), feature)
}

/**
 * The polygon containing a coordinate, or null. Bbox-prefiltered — the same
 * pattern `scripts/prepare-references.mjs:306` already uses over these 106
 * features.
 */
export function containingStation(
  features: readonly StationFeature[],
  lat: number,
  lon: number,
): StationFeature | null {
  for (const feature of features) {
    if (isInside(feature, lat, lon)) return feature
  }
  return null
}

/** H3 indices at the three resolutions §6.4 step 03 emits. */
export function h3Cells(lat: number, lon: number): { r7: string; r8: string; r9: string } {
  return {
    r7: latLngToCell(lat, lon, 7),
    r8: latLngToCell(lat, lon, 8),
    r9: latLngToCell(lat, lon, 9),
  }
}

/** Two stations are adjacent if their boundaries come within this distance. */
export const ADJACENCY_THRESHOLD_KM = 0.05

/**
 * Minimum distance in km between two polygons' boundaries.
 *
 * Uses vertex-to-vertex minimum distance — the same method §11.1 used to
 * establish the demo corridor, which is why its table reads exactly `0.000` for
 * boundary-sharing pairs. `booleanTouches` is deliberately not used: it is
 * unreliable across the MultiPolygon geometry these jurisdictions actually
 * have, and a false negative would silently break cross-boundary response.
 */
export function minBoundaryDistanceKm(a: StationFeature, b: StationFeature): number {
  const pointsA = explode(a)
  const pointsB = explode(b)
  let min = Infinity
  for (const feature of pointsA.features) {
    const nearest = nearestPoint(feature, pointsB)
    const d = distance(feature, nearest, { units: 'kilometers' })
    if (d < min) min = d
  }
  return min
}

export type AdjacencyMap = Record<string, string[]>

/** Densification step and grid cell size, in degrees (~40 m and ~55 m). */
const DENSIFY_STEP_DEG = 0.00036
const GRID_DEG = 0.0005

/** Every boundary vertex, densified so long straight edges are not missed. */
function densifiedBoundary(feature: StationFeature): Array<[number, number]> {
  const rings: number[][][] =
    feature.geometry.type === 'Polygon'
      ? (feature.geometry.coordinates as number[][][])
      : (feature.geometry.coordinates as number[][][][]).flat()

  const points: Array<[number, number]> = []
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i] as [number, number]
      const [x2, y2] = ring[i + 1] as [number, number]
      points.push([x1, y1])
      const span = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))
      const steps = Math.floor(span / DENSIFY_STEP_DEG)
      for (let s = 1; s < steps; s++) {
        const t = s / steps
        points.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t])
      }
    }
  }
  return points
}

/**
 * Build the station adjacency map.
 *
 * Consumed by `03_geo_resolve.ts`: a reported coordinate landing in an
 * *adjacent* polygon is a boundary nudge worth keeping; one landing in a
 * non-adjacent polygon is a data error that must not be silently placed in the
 * wrong jurisdiction.
 *
 * Implemented as a densified spatial hash rather than the O(n²) vertex-pair
 * scan `minBoundaryDistanceKm` performs. The exact version is ~400M distance
 * computations over these 106 MultiPolygons; this is linear in total boundary
 * length and agrees with it on the §11.1 corridor, whose adjacent pairs share
 * boundaries exactly (that table reads 0.000 km). Densification matters because
 * a long straight shared edge may carry only two vertices.
 *
 * `booleanTouches` is deliberately not used — it is unreliable across
 * MultiPolygon geometry, and a false negative would silently break
 * cross-boundary response, which is the whole premise of §8.4 and M8.
 */
export function buildAdjacency(
  features: readonly StationFeature[],
  codeOf: (feature: StationFeature) => string,
): AdjacencyMap {
  const cells = new Map<string, Set<string>>()

  for (const feature of features) {
    const code = codeOf(feature)
    for (const [lon, lat] of densifiedBoundary(feature)) {
      const gx = Math.floor(lon / GRID_DEG)
      const gy = Math.floor(lat / GRID_DEG)
      // Claim the 3×3 neighbourhood so boundaries that fall either side of a
      // cell edge still meet.
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = `${gx + dx}:${gy + dy}`
          let set = cells.get(key)
          if (!set) cells.set(key, (set = new Set()))
          set.add(code)
        }
      }
    }
  }

  const map: AdjacencyMap = {}
  for (const feature of features) map[codeOf(feature)] = []
  const pairs = new Set<string>()
  for (const codes of cells.values()) {
    if (codes.size < 2) continue
    const list = [...codes]
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = [list[i]!, list[j]!].sort() as [string, string]
        const key = `${a}|${b}`
        if (pairs.has(key)) continue
        pairs.add(key)
        map[a]!.push(b)
        map[b]!.push(a)
      }
    }
  }
  for (const code of Object.keys(map)) map[code]!.sort()
  return map
}
