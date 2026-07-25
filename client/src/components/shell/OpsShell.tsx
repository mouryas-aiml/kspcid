'use client'

import { Brackets, Command, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { cn } from '@/lib/cn'
import { dur, ease } from '@/lib/motion'
import { AppRail } from './AppRail'
import { Inspector } from './Inspector'

interface OpsShellProps {
  readonly title: string
  readonly eyebrow: string
  readonly context: ReactNode
  readonly inspector: ReactNode
  readonly children: ReactNode
  readonly timeline?: ReactNode
}

export function OpsShell({
  title,
  eyebrow,
  context,
  inspector,
  children,
  timeline,
}: OpsShellProps) {
  const [contextOpen, setContextOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const reduce = useReducedMotion()

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === '[') setContextOpen((value) => !value)
      if (event.key === 'Escape') setInspectorOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="ops-shell">
      <AppRail />
      <motion.aside
        className={cn('context-panel no-print', !contextOpen && 'is-collapsed')}
        animate={{ x: contextOpen ? 0 : -360, opacity: contextOpen ? 1 : 0 }}
        transition={{ duration: reduce ? 0 : dur.panel, ease: ease.out }}
        aria-hidden={!contextOpen}
      >
        <header className="context-header">
          <div>
            <p className="type-micro text-[--gold-400]">{eyebrow}</p>
            <h1 className="mt-1 text-lg font-semibold">{title}</h1>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => setContextOpen(false)}
            aria-label="Collapse context panel"
          >
            <PanelLeftClose size={17} />
          </button>
        </header>
        <div className="context-content">{context}</div>
        <div className="context-shortcuts">
          <span><Brackets size={13} /> Toggle panel</span>
          <span><Command size={13} /> K Command</span>
        </div>
      </motion.aside>
      {!contextOpen ? (
        <button
          type="button"
          className="context-reopen no-print"
          onClick={() => setContextOpen(true)}
          aria-label="Open context panel"
        >
          <PanelLeftOpen size={17} />
        </button>
      ) : null}
      <main className="ops-canvas">{children}</main>
      <Inspector
        open={inspectorOpen}
        title="Banaswadi corridor"
        eyebrow="SELECTED AREA"
        onClose={() => setInspectorOpen(false)}
      >
        {inspector}
      </Inspector>
      {timeline ? <footer className="timeline no-print">{timeline}</footer> : null}
    </div>
  )
}
