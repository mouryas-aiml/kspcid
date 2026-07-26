// Bump on every change to a precached asset. `/data/` is served cache-first,
// so a stale name silently serves the previous compile — the Neo4j + GDS
// recompile (T2) surfaced exactly that: the Constellation kept reporting the
// old Graphology 105 communities / 0.98115 modularity until this was raised.
const CACHE_NAME = 'kspcid-offline-v8'

// The 37 MB PMTiles basemap lives in its own cache, keyed separately from
// CACHE_NAME: a data-only bump must not force a 37 MB re-download over venue
// Wi-Fi. Bump this only when the archive itself is re-extracted.
const TILES_CACHE = 'kspcid-tiles-v1'
const TILE_ARCHIVE = '/tiles/bengaluru.pmtiles'

const PRECACHE = [
  '/',
  '/icon.svg',
  '/feed/',
  '/map/',
  '/similarity/',
  '/network/',
  '/patrol/',
  '/justice/',
  '/cyber/',
  '/feed/index.txt',
  '/map/index.txt',
  '/similarity/index.txt',
  '/network/index.txt',
  '/patrol/index.txt',
  '/justice/index.txt',
  '/cyber/index.txt',
  '/data/offline/demo_snapshot.json',
  '/data/scenarios/command_feed.json',
  '/data/scenarios/command_map.json',
  '/data/scenarios/demo_corridor_patrol.json',
  '/data/scenarios/optimizer_fallback.json',
  '/data/scenarios/similarity_demo.json',
  '/data/scenarios/justice_pipeline.json',
  '/data/scenarios/cyber_wing.json',
  '/data/graph/graph_snapshot.json',
  '/data/routing/corridor_region.json',
  '/data/routing/hex_index.json',
  '/data/routing/duration_matrix.bin',
  '/data/routing/coverage_bitsets.bin',
  '/data/routing/dispatch_routes.json',
  '/data/reference/jurisdictions.geojson',
  // Basemap glyphs and sprites (§3.4, self-hosted). Without these the archive
  // draws geometry but every street name and shield disappears offline, which
  // fails T1 acceptance just as surely as a missing tile.
  '/basemap/sprites/dark.json',
  '/basemap/sprites/dark.png',
  '/basemap/sprites/dark@2x.json',
  '/basemap/sprites/dark@2x.png',
  '/basemap/fonts/Noto%20Sans%20Regular/0-255.pbf',
  '/basemap/fonts/Noto%20Sans%20Regular/256-511.pbf',
  '/basemap/fonts/Noto%20Sans%20Regular/512-767.pbf',
  '/basemap/fonts/Noto%20Sans%20Regular/768-1023.pbf',
  '/basemap/fonts/Noto%20Sans%20Regular/3072-3327.pbf',
  '/basemap/fonts/Noto%20Sans%20Regular/8192-8447.pbf',
  '/basemap/fonts/Noto%20Sans%20Medium/0-255.pbf',
  '/basemap/fonts/Noto%20Sans%20Medium/256-511.pbf',
  '/basemap/fonts/Noto%20Sans%20Medium/512-767.pbf',
  '/basemap/fonts/Noto%20Sans%20Medium/768-1023.pbf',
  '/basemap/fonts/Noto%20Sans%20Medium/3072-3327.pbf',
  '/basemap/fonts/Noto%20Sans%20Medium/8192-8447.pbf',
  '/basemap/fonts/Noto%20Sans%20Italic/0-255.pbf',
  '/basemap/fonts/Noto%20Sans%20Italic/256-511.pbf',
  '/basemap/fonts/Noto%20Sans%20Italic/512-767.pbf',
  '/basemap/fonts/Noto%20Sans%20Italic/768-1023.pbf',
  '/basemap/fonts/Noto%20Sans%20Italic/3072-3327.pbf',
  '/basemap/fonts/Noto%20Sans%20Italic/8192-8447.pbf',
]

/**
 * The only place in this worker allowed to write to a cache.
 *
 * A 206 Partial Content response can never be stored — the Cache API rejects
 * it outright, and because the write is fire-and-forget the rejection is
 * invisible. MapLibre reads the PMTiles archive exclusively by HTTP range, so
 * any handler that caches responses indiscriminately is one refactor away from
 * silently dropping every tile. Non-200 responses are refused for the same
 * reason a 404 must never be promoted into the offline snapshot.
 *
 * `etl/verify_offline.ts` asserts that this file writes to a cache in exactly
 * one place, and that both guards below are present.
 */
async function putIfComplete(cacheName, request, response) {
  if (response.status !== 200) return
  if (request.headers.has('range')) return
  const cache = await caches.open(cacheName)
  await cache.put(request, response)
}

/** Full archive bytes, memoised so the offline path is not O(37 MB) per tile. */
let archiveBytes = null

async function readArchive() {
  if (archiveBytes) return archiveBytes
  const cache = await caches.open(TILES_CACHE)
  const cached = await cache.match(TILE_ARCHIVE)
  if (!cached) return null
  archiveBytes = await cached.arrayBuffer()
  return archiveBytes
}

/** `bytes=start-end`, `bytes=start-` and `bytes=-suffix`, per RFC 7233. */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, rawStart, rawEnd] = match
  let start
  let end
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (rawEnd === '' || !Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start > end || start >= size) return null
  return [start, Math.min(end, size - 1)]
}

/**
 * Serve a PMTiles range read out of the cached archive.
 *
 * `caches.match()` returns whole responses and ignores `Range` entirely, so the
 * slice has to be synthesised here. Only reached when the network is gone —
 * online, the range read goes straight to the HTTP stack, which does this far
 * more efficiently than we can.
 */
async function sliceArchive(request) {
  const bytes = await readArchive()
  if (!bytes) return null
  const header = request.headers.get('range')
  if (!header) {
    return new Response(bytes.slice(0), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(bytes.byteLength),
        'Accept-Ranges': 'bytes',
      },
    })
  }
  const parsed = parseRange(header, bytes.byteLength)
  if (!parsed) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${bytes.byteLength}` },
    })
  }
  const [start, end] = parsed
  return new Response(bytes.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}`,
      'Accept-Ranges': 'bytes',
    },
  })
}

/** One unranged GET of the whole archive, so offline range reads have a source. */
async function cacheTileArchive() {
  const cache = await caches.open(TILES_CACHE)
  if (await cache.match(TILE_ARCHIVE)) return
  const request = new Request(TILE_ARCHIVE)
  const response = await fetch(request)
  await putIfComplete(TILES_CACHE, request, response)
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.allSettled([
      caches
        .open(CACHE_NAME)
        .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url)))),
      cacheTileArchive(),
    ]),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME && name !== TILES_CACHE)
          .map((name) => caches.delete(name)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return

  // Tiles are network-first and never cached by the request: the request is
  // ranged, so its response is a 206 and unstorable. The cached full archive is
  // the fallback, sliced by hand.
  if (url.pathname.startsWith('/tiles/')) {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const sliced = await sliceArchive(event.request)
        if (sliced) return sliced
        return new Response(null, { status: 504 })
      }),
    )
    return
  }

  const isAsset =
    url.pathname.startsWith('/data/') ||
    url.pathname.startsWith('/basemap/') ||
    url.pathname.startsWith('/_next/') ||
    url.pathname.endsWith('/index.txt')
  if (isAsset) {
    event.respondWith(
      caches.match(event.request).then((cached) =>
        cached ||
        fetch(event.request).then((response) => {
          void putIfComplete(CACHE_NAME, event.request, response.clone())
          return response
        }),
      ),
    )
    return
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          void putIfComplete(CACHE_NAME, event.request, response.clone())
          return response
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/'))),
    )
  }
})
