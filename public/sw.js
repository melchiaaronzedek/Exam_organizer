/* Pariksha Desk service worker: shell cache-first, data stale-while-revalidate. */
const VERSION = 'pd-v1'
const SHELL = ['./', './index.html', './manifest.webmanifest']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  const isData = url.pathname.includes('/data/') || url.pathname.endsWith('.ics') || url.pathname.includes('/documents/')
  if (isData) {
    e.respondWith(
      caches.open(VERSION).then(async (c) => {
        const cached = await c.match(req)
        const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res }).catch(() => cached)
        return cached || net
      }),
    )
    return
  }
  e.respondWith(
    caches.open(VERSION).then(async (c) => {
      const cached = await c.match(req, { ignoreSearch: true })
      if (cached) return cached
      try {
        const res = await fetch(req)
        if (res.ok && (url.pathname.includes('/assets/') || url.pathname.endsWith('.html') || url.pathname.endsWith('/'))) c.put(req, res.clone())
        return res
      } catch {
        return (await c.match('./index.html')) || Response.error()
      }
    }),
  )
})
