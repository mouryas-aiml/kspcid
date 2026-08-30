import type { Metadata } from 'next'
import { Geist, Geist_Mono, Noto_Sans_Kannada } from 'next/font/google'
import type { ReactNode } from 'react'

import { Assistant } from '@/components/assistant/Assistant'
import { CommandPalette } from '@/components/command/CommandPalette'
import { OfflineBootstrap } from '@/components/offline/OfflineBootstrap'
import './globals.css'

const sans = Geist({ subsets: ['latin'], variable: '--f-sans' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--f-mono' })
const kannada = Noto_Sans_Kannada({
  subsets: ['kannada'],
  variable: '--f-kn',
  weight: ['400', '600'],
})

export const metadata: Metadata = {
  title: {
    default: 'KSPCID',
    template: '%s · KSPCID',
  },
  description:
    'Crime Intelligence & Analytical Platform · State Crime Records Bureau',
}

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable} ${kannada.variable}`}>
        <OfflineBootstrap />
        <CommandPalette />
        {children}
        {/* Mounted globally so it is reachable from every route, like ⌘K. */}
        <Assistant />
      </body>
    </html>
  )
}
