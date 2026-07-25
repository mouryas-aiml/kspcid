'use client'

import { ArrowLeft, Download, Printer, Shield } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

interface BriefShellProps {
  readonly children: ReactNode
}

export function BriefShell({ children }: BriefShellProps) {
  return (
    <div className="brief-shell">
      <header className="brief-toolbar no-print">
        <Link href="/map/" className="brief-back">
          <ArrowLeft size={16} />
          Command wall
        </Link>
        <div className="brief-brand">
          <Shield size={17} />
          <span>KSPCID</span>
        </div>
        <div className="brief-actions">
          <button type="button"><Download size={15} /> Export</button>
          <button type="button" onClick={() => window.print()}>
            <Printer size={15} /> Print
          </button>
        </div>
      </header>
      <main className="brief-page">{children}</main>
    </div>
  )
}
