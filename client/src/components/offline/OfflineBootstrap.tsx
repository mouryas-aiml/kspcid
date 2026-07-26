'use client'

import { useEffect } from 'react'

export function OfflineBootstrap() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !navigator.onLine) return
    // Catalyst Web Client Hosting mounts the export under /app. Keep its
    // submission build network-first; the root-scoped offline worker remains
    // enabled for the normal root deployment and venue demo.
    if (process.env.NEXT_PUBLIC_BASE_PATH) {
      document.documentElement.dataset.offlineCache = 'unavailable'
      return
    }
    void navigator.serviceWorker.register('/offline-sw.js').then(() => {
      document.documentElement.dataset.offlineCache = 'registered'
    }).catch(() => {
      document.documentElement.dataset.offlineCache = 'unavailable'
    })
  }, [])
  return null
}
