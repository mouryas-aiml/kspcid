const CACHE_NAME = 'kspcid-offline-v2'
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
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(PRECACHE.map((url) => cache.add(url))),
    ),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  const isAsset =
    url.pathname.startsWith('/data/') ||
    url.pathname.startsWith('/_next/') ||
    url.pathname.endsWith('/index.txt')
  if (isAsset) {
    event.respondWith(
      caches.match(event.request).then((cached) =>
        cached || fetch(event.request).then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
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
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
          return response
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/'))),
    )
  }
})
