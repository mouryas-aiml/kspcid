'use client'

import { useEffect } from 'react'

export function OfflineBootstrap() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !navigator.onLine) return
    void navigator.serviceWorker.register('/offline-sw.js').then(() => {
      document.documentElement.dataset.offlineCache = 'registered'
    }).catch(() => {
      document.documentElement.dataset.offlineCache = 'unavailable'
    })
  }, [])
  return null
}
