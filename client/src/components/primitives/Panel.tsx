import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

interface PanelProps {
  readonly title: string
  readonly eyebrow?: string
  readonly provenance?: ReactNode
  readonly actions?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}

export function Panel({
  title,
  eyebrow,
  provenance,
  actions,
  children,
  className,
}: PanelProps) {
  return (
    <section className={cn('panel', className)}>
      <header className="panel-header">
        <div className="min-w-0">
          {eyebrow ? <p className="type-micro text-[--txt-3]">{eyebrow}</p> : null}
          <h2 className="truncate text-base font-semibold">{title}</h2>
        </div>
        <div className="panel-actions">
          {provenance}
          {actions}
        </div>
      </header>
      {children}
    </section>
  )
}
