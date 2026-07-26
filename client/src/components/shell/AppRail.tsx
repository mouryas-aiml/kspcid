'use client'

import {
  Activity,
  BellRing,
  BookOpenText,
  GitBranch,
  Map,
  Network,
  RadioTower,
  ScanSearch,
  Shield,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const items = [
  { href: '/map/', label: 'Command Map', icon: Map },
  { href: '/feed/', label: 'Command Feed', icon: BellRing },
  { href: '/patrol/', label: 'Patrol Lab', icon: RadioTower },
  { href: '/network/', label: 'Case Constellation', icon: Network },
  { href: '/cyber/', label: 'Cyber Wing', icon: Activity },
  { href: '/review/', label: 'Crime Review', icon: BookOpenText },
  { href: '/justice/', label: 'Justice Pipeline', icon: GitBranch },
] as const

export function AppRail() {
  const pathname = usePathname()
  return (
    <nav className="app-rail no-print" aria-label="Primary">
      <Link href="/map/" className="rail-mark" aria-label="KSPCID home">
        <Shield size={20} strokeWidth={1.8} />
      </Link>
      <div className="rail-items">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              prefetch={false}
              className="rail-item"
              data-active={active}
              aria-label={label}
              title={label}
            >
              <Icon size={19} strokeWidth={1.7} />
            </Link>
          )
        })}
        <a
          aria-label="CipherWatch"
          className="rail-item"
          href="https://cipherwatch-ksp.streamlit.app/"
          rel="noopener noreferrer"
          target="_blank"
          title="CipherWatch — open in a new tab"
        >
          <ScanSearch size={19} strokeWidth={1.7} />
        </a>
      </div>
      <button className="rail-avatar" type="button" aria-label="Officer profile">
        DCP
      </button>
    </nav>
  )
}
