'use client'

import { useEffect } from 'react'
import { preloadCatalystArtifacts } from '@/lib/publicPath'

export function OfflineBootstrap() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !navigator.onLine) return
    if (process.env.NEXT_PUBLIC_BASE_PATH) {
      preloadCatalystArtifacts()
      void navigator.serviceWorker.register('/app/catalyst-sw.js', { scope: '/app/' }).then(() => {
        document.documentElement.dataset.offlineCache = 'registered'
      }).catch(() => {
        document.documentElement.dataset.offlineCache = 'unavailable'
      })
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
