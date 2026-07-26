'use client'

import dynamic from 'next/dynamic'

// §9: next/dynamic with ssr:false must live in a Client Component under Next 15.
const MapSpike = dynamic(() => import('@/components/spike/MapSpike').then((m) => m.MapSpike), {
  ssr: false,
  loading: () => (
    <div className="grid h-screen place-items-center font-mono text-xs text-[--txt-3]">
      INITIALIZING WEBGL MAP…
    </div>
  ),
})

export default function SpikePage() {
  return <MapSpike />
}
