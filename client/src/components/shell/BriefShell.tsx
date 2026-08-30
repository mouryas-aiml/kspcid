'use client'

import { ArrowLeft, Printer, Shield } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

interface BriefShellProps {
  readonly children: ReactNode
  /**
   * Where the back link goes. Defaults to the command wall, which is where the
   * Justice Pipeline is reached from; a station brief is reached from the
   * overview, so it overrides this. `null` omits the link — the overview is
   * itself the top of the tree and has nowhere to go back to.
   */
  readonly backHref?: string | null
  readonly backLabel?: string
  /** Extra toolbar controls, right-aligned beside Print. Hidden when printing. */
  readonly actions?: ReactNode
}

export function BriefShell({
  children,
  backHref = '/map/',
  backLabel = 'Command wall',
  actions,
}: BriefShellProps) {
  return (
    <div className="brief-shell">
      <header className="brief-toolbar no-print">
        {backHref ? (
          <Link href={backHref} className="brief-back">
            <ArrowLeft size={16} />
            {backLabel}
          </Link>
        ) : (
          <span />
        )}
        <div className="brief-brand">
          <Shield size={17} />
          <span>KSPCID</span>
        </div>
        <div className="brief-actions">
          {actions}
          {/*
            Print is the export path. There was a second "Export" button here
            with no handler at all — it looked like a download and did nothing,
            which on a page an officer is meant to file is worse than not
            offering one. The A4 rules live in the @media print block.
          */}
          <button type="button" onClick={() => window.print()}>
            <Printer size={15} /> Print
          </button>
        </div>
      </header>
      <main className="brief-page">{children}</main>
    </div>
  )
}
