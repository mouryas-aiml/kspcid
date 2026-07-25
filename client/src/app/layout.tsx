import type { Metadata } from 'next'
import { Geist, Geist_Mono, Noto_Sans_Kannada } from 'next/font/google'
import type { ReactNode } from 'react'

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
        {children}
      </body>
    </html>
  )
}
