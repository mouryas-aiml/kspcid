'use client'

import { X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

import { dur, ease, spring } from '@/lib/motion'

interface InspectorProps {
  readonly open: boolean
  readonly title: string
  readonly eyebrow?: string
  readonly children: ReactNode
  readonly onClose: () => void
}

export function Inspector({
  open,
  title,
  eyebrow,
  children,
  onClose,
}: InspectorProps) {
  const reduce = useReducedMotion()
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.aside
          className="inspector"
          initial={{ x: reduce ? 0 : 32, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: reduce ? 0 : 32, opacity: 0 }}
          transition={reduce ? { duration: 0 } : { ...spring, duration: dur.panel }}
          aria-label={`${title} inspector`}
        >
          <header className="inspector-header">
            <div>
              {eyebrow ? <p className="type-micro text-[--txt-3]">{eyebrow}</p> : null}
              <h2 className="text-base font-semibold">{title}</h2>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={onClose}
              aria-label="Close inspector"
            >
              <X size={17} />
            </button>
          </header>
          <motion.div
            className="inspector-content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduce ? 0 : dur.base, ease: ease.out }}
          >
            {children}
          </motion.div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}
