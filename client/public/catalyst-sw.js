// Bump when same-path data artifacts change so returning clients cannot retain
// an older manifest or scenario fixture after a new Web Client deployment.
const CACHE_NAME = 'kspcid-catalyst-v3'
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '')

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith(`${SCOPE_PATH}/`)) return
  if (request.mode === 'navigate') return

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok && response.status === 200) {
        event.waitUntil(cache.put(request, response.clone()))
      }
      return response
    }),
  )
})
