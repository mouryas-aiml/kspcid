/**
 * Self-hosted Bengaluru basemap — BUILD_SPEC §3.4.
 *
 * A PMTiles archive clipped to BLR_BBOX is served from `public/tiles/`, read
 * through the `pmtiles://` protocol with HTTP range requests. No external tile
 * provider, no venue-Wi-Fi dependency.
 *
 * Style is the Protomaps "dark" flavor overridden to §5.2:
 *   - roads at 18% opacity
 *   - no POI labels
 *   - no green landuse fills
 *   - water #0B1620
 * The map is a substrate, not a subject — but street names stay legible.
 */
import { layers, namedFlavor } from '@protomaps/basemaps'
import { addProtocol, type StyleSpecification } from 'maplibre-gl'
import { PMTiles, Protocol } from 'pmtiles'
import { isCatalystClientHosting, publicPath } from '@/lib/publicPath'
import { ChunkedPmtilesSource } from './chunkedPmtiles'

export const BASEMAP_SOURCE = 'protomaps'
const cloudMode = (process.env.NEXT_PUBLIC_DEMO_MODE ?? 'offline') !== 'offline'
const stratusBase = process.env.NEXT_PUBLIC_STRATUS_BASE_URL?.replace(/\/+$/, '')
if (cloudMode && !stratusBase) {
  throw new Error('NEXT_PUBLIC_STRATUS_BASE_URL is required in cloud mode')
}
const CHUNKED_ARCHIVE_KEY = 'kspcid-bengaluru-chunked'
const useChunkedArchive = isCatalystClientHosting && !stratusBase
export const BASEMAP_ARCHIVE = useChunkedArchive
  ? CHUNKED_ARCHIVE_KEY
  : cloudMode && stratusBase
    ? `${stratusBase}/tiles/bengaluru.pmtiles`
    : publicPath('/tiles/bengaluru.pmtiles')

/**
 * Explicit tile template rather than `url: 'pmtiles://…'`.
 *
 * The TileJSON form makes MapLibre resolve archive metadata through the
 * protocol before the source becomes ready; under maplibre-gl@6 + pmtiles@4
 * that round-trip never resolves, so the style hangs after the header read and
 * no tiles, sprite or glyphs are ever requested. Declaring the template plus
 * bounds/zooms up front skips the round-trip. Values mirror the archive header
 * (verified: PMTiles v3, MVT, z0–15, bbox 77.35,12.70 → 77.85,13.20).
 */
export const BASEMAP_TILES = `pmtiles://${BASEMAP_ARCHIVE}/{z}/{x}/{y}`

/** BLR_BBOX — identical to the §3.3 OSRM extract bbox and the archive header. */
export const BLR_BOUNDS: [number, number, number, number] = [77.35, 12.7, 77.85, 13.2]

/** §5.2 water, overriding the flavor default. */
const WATER = '#0B1620'
/**
 * §3.4 specifies "roads at 18% opacity". That figure assumes a brighter road
 * colour than the Protomaps dark flavor uses: its road strokes are already a
 * near-background grey, and at 0.18 they disappear entirely against `earth`
 * (#1f1f1f) — verified in the T0 spike, see reports/t0_spike.md.
 *
 * §3.4's stated intent is that "the map is a substrate, not a subject" while
 * remaining a usable street reference, and T1 acceptance requires streets to be
 * visible under every map surface. Those two cannot both hold at 0.18 with this
 * flavor, so opacity is raised to the lowest value at which streets read.
 * Recorded as deliberate DRIFT rather than silently applied.
 */
const ROAD_OPACITY = 0.55

/** POI and address labels are noise on an operational picture (§3.4). */
const DROPPED_LAYER_IDS = new Set(['pois', 'address_label'])
/** §3.4 — no green landuse fills; they read as parks the data cannot support. */
const DROPPED_LAYER_PREFIXES = ['landuse_park', 'landuse_urban_green', 'landuse_zoo']

let protocolRegistered = false

/**
 * Register the pmtiles:// protocol with MapLibre. Idempotent — React
 * StrictMode double-invokes effects, and MapLibre throws on a duplicate
 * protocol registration.
 */
export function registerPmtilesProtocol(): void {
  if (protocolRegistered) return
  const protocol = new Protocol()
  if (useChunkedArchive) {
    protocol.add(
      new PMTiles(
        new ChunkedPmtilesSource(
          CHUNKED_ARCHIVE_KEY,
          publicPath('/tiles/bengaluru-pmtiles'),
        ),
      ),
    )
  }
  addProtocol('pmtiles', protocol.tile)
  protocolRegistered = true
}

function isRoadLayer(id: string): boolean {
  return id.startsWith('roads_') && !id.includes('label')
}

function isWaterFill(id: string): boolean {
  return id === 'water' || id === 'water_stream' || id === 'water_river'
}

/** Build the §3.4 style. `lang` follows §5.3's bilingual intent. */
export function buildBasemapStyle(lang = 'en'): StyleSpecification {
  const flavor = namedFlavor('dark')
  const base = layers(BASEMAP_SOURCE, flavor, { lang })
  const origin = typeof window === 'undefined' ? '' : window.location.origin

  const styled = base
    .filter((layer) => !DROPPED_LAYER_IDS.has(layer.id))
    .filter((layer) => !DROPPED_LAYER_PREFIXES.some((prefix) => layer.id.startsWith(prefix)))
    .map((layer) => {
      if (isRoadLayer(layer.id) && layer.type === 'line') {
        return { ...layer, paint: { ...layer.paint, 'line-opacity': ROAD_OPACITY } }
      }
      if (isWaterFill(layer.id) && layer.type === 'fill') {
        return { ...layer, paint: { ...layer.paint, 'fill-color': WATER } }
      }
      if (isWaterFill(layer.id) && layer.type === 'line') {
        return { ...layer, paint: { ...layer.paint, 'line-color': WATER } }
      }
      return layer
    })

  return {
    version: 8,
    // Self-hosted — §3.4 forbids an external tile/asset provider, and T1
    // acceptance requires the map to work with the network disabled. Glyph
    // ranges cover Latin, Latin Extended, Kannada (U+0C80–0CFF → 3072-3327)
    // and General Punctuation.
    //
    // MapLibre rejects a relative sprite URL ("must be absolute"), so it is
    // resolved against the page origin. Same-origin either way — this stays
    // offline-safe and never reaches an external host.
    glyphs: `${origin}${publicPath('/basemap/fonts/{fontstack}/{range}.pbf')}`,
    sprite: `${origin}${publicPath('/basemap/sprites/dark')}`,
    sources: {
      [BASEMAP_SOURCE]: {
        type: 'vector',
        tiles: [BASEMAP_TILES],
        bounds: BLR_BOUNDS,
        minzoom: 0,
        maxzoom: 15,
        attribution: '© OpenStreetMap · Protomaps',
      },
    },
    layers: styled,
  } as StyleSpecification
}
