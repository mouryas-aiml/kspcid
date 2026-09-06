'use client'

import {
  Activity,
  BookOpen,
  FileSearch,
  Info,
  Map,
  Network,
  RadioTower,
  Route,
  Scale,
  Search,
  Shield,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

const items = [
  { label: 'Bengaluru overview', description: 'Alerts, exceedances and station briefs', route: '/overview/', category: 'Review', icon: Shield },
  { label: 'Station briefs', description: 'One printable page per station', route: '/station/', category: 'Review', icon: BookOpen },
  { label: 'Command Feed', description: 'Ranked weekly-baseline signals', route: '/feed/', category: 'Detect', icon: RadioTower },
  { label: 'Command Map', description: 'Citywide operational map', route: '/map/', category: 'Detect', icon: Map },
  { label: 'Namma Patrol Lab', description: 'Road-time deployment exercise', route: '/patrol/', category: 'Plan', icon: Route },
  { label: 'Case Similarity', description: 'Graph-independent prior cases', route: '/similarity/', category: 'Investigate', icon: FileSearch },
  { label: 'Case Constellation', description: 'Seeded entity graph snapshot', route: '/network/', category: 'Investigate', icon: Network },
  { label: 'Justice Pipeline', description: 'Observed stage and ageing brief', route: '/justice/', category: 'Review', icon: Scale },
  { label: 'Cyber Intelligence Wing', description: 'Non-geographic cyber evidence', route: '/cyber/', category: 'Detect', icon: Activity },
  { label: 'Old Madras Road scenario', description: 'Open the integrated closure exercise', route: '/patrol/?scenario=demo-corridor-patrol-2021-2023-night', category: 'Scenario', icon: ShieldCheck },
] as const

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [about, setAbout] = useState(false)
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setAbout(false)
        setOpen((value) => !value)
      }
      if (event.key === 'Escape') {
        setOpen(false)
        setAbout(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (open && !about) window.setTimeout(() => input.current?.focus(), 0)
  }, [about, open])

  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return items
    return items.filter((item) =>
      `${item.label} ${item.description} ${item.category}`.toLowerCase().includes(normalized),
    )
  }, [query])

  if (!open) return null
  return (
    <div
      aria-label="Command palette backdrop"
      className="fixed inset-0 z-[200] flex items-start justify-center bg-[rgb(5_8_13_/_0.78)] p-4 pt-[10vh] backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
      role="presentation"
    >
      <section aria-label={about ? 'About KSPCID' : 'Command palette'} aria-modal="true" className="w-full max-w-2xl overflow-hidden rounded-[--r-lg] border border-[--ink-500] bg-[--ink-800] text-[--txt] shadow-[0_32px_100px_rgb(0_0_0_/.7)]" role="dialog">
        <header className="flex items-center justify-between border-b border-[--ink-600] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-[--r-sm] bg-[rgb(240_168_0_/.12)] text-[--gold-400]"><Shield size={16} /></span>
            <div><p className="type-micro text-[--gold-400]">KSPCID</p><h2 className="text-sm font-semibold">{about ? 'About this build' : 'Go to module or scenario'}</h2></div>
          </div>
          <button aria-label="Close command palette" className="icon-button" onClick={() => setOpen(false)} type="button"><X size={16} /></button>
        </header>
        {about ? (
          <div className="max-h-[70vh] overflow-y-auto p-6">
            <p className="text-sm leading-6 text-[--txt-2]">Decision-support and scenario analysis for the Karnataka State Police. This local build separates source authority from transformation on every analytical surface.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                ['Data checks', 'VERIFIED', 'var(--ok)'],
                ['Road coverage areas', '106 / 106 READY', 'var(--ok)'],
                ['Offline demo', 'VERIFIED', 'var(--ok)'],
                ['Suggested patrol plan', 'SCORE 913', 'var(--ok)'],
                ['Catalyst connection', 'READY', 'var(--cyan-400)'],
                ['Development website', 'LIVE', 'var(--ok)'],
              ].map(([label, value, color]) => (
                <div className="rounded-[--r-md] border border-[--ink-600] bg-[--ink-850] p-4" key={label}>
                  <p className="type-micro text-[--txt-3]">{label}</p>
                  <p className="mt-2 font-mono text-sm font-semibold" style={{ color }}>{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-[--r-md] border border-[--ink-600] p-4">
              <p className="type-micro text-[--txt-3]">Data source guide</p>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <span><b className="text-[--prov-official]">●</b> Government or official open data</span>
                <span><b className="text-[--prov-third-party]">●</b> Mirrored FIR dataset</span>
                <span><b className="text-[--prov-open-reference]">●</b> Public map or reference data</span>
                <span><b className="text-[--prov-generated]">●</b> Demonstration-only data</span>
              </div>
            </div>
            <div className="mt-4 flex gap-3 rounded-[--r-md] border border-[--warn] bg-[rgb(247_144_9_/.06)] p-4 text-xs leading-5 text-[--txt-2]">
              <Info className="mt-0.5 shrink-0 text-[--warn]" size={16} />
              The Development website is live. Cloud database, messaging, document delivery and a
              custom domain are outside this demo.
            </div>
            <button className="mt-5 flex items-center gap-2 text-xs text-[--cyan-400]" onClick={() => setAbout(false)} type="button"><BookOpen size={14} /> Back to modules</button>
          </div>
        ) : (
          <>
            <label className="flex items-center gap-3 border-b border-[--ink-600] px-5 py-4">
              <Search className="text-[--txt-3]" size={18} />
              <input ref={input} aria-label="Search commands" className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[--txt-3]" onChange={(event) => setQuery(event.target.value)} placeholder="Search modules and scenarios…" value={query} />
              <kbd className="rounded border border-[--ink-500] px-2 py-1 font-mono text-[10px] text-[--txt-3]">ESC</kbd>
            </label>
            <div className="max-h-[55vh] overflow-y-auto p-2">
              {matches.map((item) => {
                const Icon = item.icon
                return (
                  <button className="flex w-full items-center gap-4 rounded-[--r-md] p-3 text-left hover:bg-[--ink-700]" key={item.label} onClick={() => { setOpen(false); router.push(item.route) }} type="button">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[--r-sm] border border-[--ink-600] text-[--cyan-400]"><Icon size={16} /></span>
                    <span className="min-w-0 flex-1"><strong className="block text-sm">{item.label}</strong><span className="block truncate text-xs text-[--txt-3]">{item.description}</span></span>
                    <span className="type-micro text-[--txt-3]">{item.category}</span>
                  </button>
                )
              })}
              {matches.length === 0 ? <p className="p-8 text-center text-sm text-[--txt-3]">No matching command.</p> : null}
            </div>
            <footer className="flex items-center justify-between border-t border-[--ink-600] px-5 py-3 text-[10px] text-[--txt-3]">
              <span>⌘K from any screen</span>
              <button className="flex items-center gap-1.5 hover:text-[--txt]" onClick={() => setAbout(true)} type="button"><Info size={12} /> About this build</button>
            </footer>
          </>
        )}
      </section>
    </div>
  )
}
