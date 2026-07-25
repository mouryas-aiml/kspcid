'use client'

import { AlertCircle, BarChart3, FileText, MonitorSmartphone, ShieldCheck, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Panel } from '@/components/primitives/Panel'
import { ProvenanceChip } from '@/components/primitives/ProvenanceChip'
import { OpsShell } from '@/components/shell/OpsShell'
import type { Provenance } from '@/lib/provenance'

interface CyberFixture {
  readonly zero_geographic_dependency: boolean
  readonly summary: {
    readonly cyber_records: number
    readonly all_records: number
    readonly caseload_share_pct: number
    readonly nonzero_coordinates: number
    readonly nonzero_share_pct: number
    readonly mappable_coordinates: number
    readonly mappable_share_pct: number
  }
  readonly monthly_volume: readonly {
    month: string
    total_records: number
    cyber_records: number
    partial_window: boolean
  }[]
  readonly top_act_sections: readonly { act_section: string; count: number }[]
  readonly complaint_modes: readonly { complaint_mode: string; count: number }[]
  readonly complaint_modes_by_year: readonly { year: number; complaint_mode: string; count: number }[]
  readonly outcomes: readonly { stage: string; count: number }[]
  readonly victims: { male: number; female: number; boy: number; girl: number }
  readonly provenance: Provenance
}

function format(value: number): string {
  return value.toLocaleString('en-IN')
}

function title(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function VolumeChart({ rows }: { readonly rows: CyberFixture['monthly_volume'] }) {
  const width = 900
  const height = 250
  const maxTotal = Math.max(...rows.map((row) => row.total_records))
  const maxCyber = Math.max(...rows.map((row) => row.cyber_records))
  const x = (index: number) => 38 + (index / Math.max(1, rows.length - 1)) * (width - 58)
  const yTotal = (value: number) => 215 - (value / maxTotal) * 175
  const yCyber = (value: number) => 215 - (value / maxCyber) * 175
  const totalPoints = rows.map((row, index) => `${x(index)},${yTotal(row.total_records)}`).join(' ')
  const cyberPoints = rows.map((row, index) => `${x(index)},${yCyber(row.cyber_records)}`).join(' ')
  const partialIndex = rows.findIndex((row) => row.partial_window)
  return (
    <div className="mt-5 overflow-x-auto">
      <svg aria-label="Monthly cyber FIR volume against all FIRs, 2016 through partial 2024" className="min-w-[760px]" role="img" viewBox={`0 0 ${width} ${height}`}>
        {partialIndex >= 0 ? <rect fill="rgb(247 144 9 / .08)" height="190" width={width - x(partialIndex) + 12} x={x(partialIndex) - 8} y="28" /> : null}
        {[40, 84, 128, 172, 215].map((y) => <line key={y} stroke="#2B3849" strokeWidth="1" x1="38" x2={width - 20} y1={y} y2={y} />)}
        <polyline fill="none" points={totalPoints} stroke="#64748B" strokeWidth="1.5" />
        <polyline fill="none" points={cyberPoints} stroke="#38BDF8" strokeWidth="2.5" />
        {rows.map((row, index) => index % 12 === 0 ? <text fill="#64748B" fontSize="9" key={row.month} textAnchor="middle" x={x(index)} y="238">{row.month.slice(0, 4)}</text> : null)}
        <text fill="#94A3B8" fontSize="10" x="48" y="20">all FIRs · independent scale</text>
        <text fill="#38BDF8" fontSize="10" x="188" y="20">cyber FIRs · independent scale</text>
        {partialIndex >= 0 ? <text fill="#F79009" fontSize="9" textAnchor="end" x={width - 24} y="43">2024 partial collection</text> : null}
      </svg>
    </div>
  )
}

function SectionBars({ rows }: { readonly rows: CyberFixture['top_act_sections'] }) {
  const maximum = Math.max(...rows.map((row) => row.count))
  return (
    <div className="mt-5 space-y-2">
      {rows.slice(0, 12).map((row) => (
        <div className="grid grid-cols-[minmax(0,1fr)_72px] items-center gap-3" key={row.act_section}>
          <div className="relative min-w-0 overflow-hidden rounded-[--r-sm] border border-[--ink-600] bg-[--ink-850] px-3 py-2">
            <span className="absolute inset-y-0 left-0 bg-[rgb(56_189_248_/_0.1)]" style={{ width: `${(row.count / maximum) * 100}%` }} />
            <span className="relative block truncate text-[11px] text-[--txt-2]" title={row.act_section}>{row.act_section}</span>
          </div>
          <span className="text-right font-mono text-xs text-[--txt]">{format(row.count)}</span>
        </div>
      ))}
    </div>
  )
}

function ModeByYear({ rows }: { readonly rows: CyberFixture['complaint_modes_by_year'] }) {
  const years = [...new Set(rows.map((row) => row.year))]
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-xs">
        <thead><tr className="text-left text-[--txt-3]"><th className="border-b border-[--ink-600] py-2">Year</th><th className="border-b border-[--ink-600] py-2 text-right">Written</th><th className="border-b border-[--ink-600] py-2 text-right">Online</th><th className="border-b border-[--ink-600] py-2 text-right">Other modes</th><th className="border-b border-[--ink-600] py-2 text-right">Total</th></tr></thead>
        <tbody>
          {years.map((year) => {
            const yearRows = rows.filter((row) => row.year === year)
            const written = yearRows.find((row) => row.complaint_mode === 'Written')?.count ?? 0
            const online = yearRows.find((row) => row.complaint_mode === 'Online')?.count ?? 0
            const total = yearRows.reduce((sum, row) => sum + row.count, 0)
            return (
              <tr className={year === 2024 ? 'text-[--warn]' : 'text-[--txt-2]'} key={year}>
                <td className="border-b border-[--ink-600] py-2">{year}{year === 2024 ? ' partial' : ''}</td>
                <td className="border-b border-[--ink-600] py-2 text-right font-mono">{format(written)}</td>
                <td className="border-b border-[--ink-600] py-2 text-right font-mono">{format(online)}</td>
                <td className="border-b border-[--ink-600] py-2 text-right font-mono">{format(total - written - online)}</td>
                <td className="border-b border-[--ink-600] py-2 text-right font-mono text-[--txt]">{format(total)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Context({ fixture }: { readonly fixture: CyberFixture }) {
  return (
    <div className="space-y-4">
      <Panel title="Bengaluru cyber caseload" eyebrow="OBSERVED">
        <p className="font-mono text-4xl font-semibold text-[--txt-hi]">{format(fixture.summary.cyber_records)}</p>
        <p className="mt-2 text-sm text-[--txt-2]">{fixture.summary.caseload_share_pct.toFixed(2)}% of all {format(fixture.summary.all_records)} FIR rows</p>
      </Panel>
      <Panel title="Coordinate availability" eyebrow="CONTEXT · NOT A MAP">
        <dl className="space-y-3 text-xs">
          <div className="flex items-end justify-between border-b border-[--ink-600] pb-3"><dt className="text-[--txt-2]">Inside routable bbox</dt><dd className="text-right font-mono text-[--txt-hi]">{format(fixture.summary.mappable_coordinates)}<br /><span className="text-[--cyan-400]">{fixture.summary.mappable_share_pct.toFixed(2)}%</span></dd></div>
          <div className="flex items-end justify-between"><dt className="text-[--txt-2]">Non-zero coordinates</dt><dd className="text-right font-mono text-[--txt-hi]">{format(fixture.summary.nonzero_coordinates)}<br /><span className="text-[--txt-3]">{fixture.summary.nonzero_share_pct.toFixed(1)}%</span></dd></div>
        </dl>
      </Panel>
      <div className="flex gap-3 rounded-[--r-md] border border-[--warn] bg-[rgb(247_144_9_/_0.07)] p-4 text-xs leading-5 text-[--txt-2]">
        <AlertCircle className="mt-0.5 shrink-0 text-[--warn]" size={16} />
        A map would visually omit 86.34% of these records. This module intentionally uses no geographic dependency.
      </div>
    </div>
  )
}

function InspectorContent({ fixture }: { readonly fixture: CyberFixture }) {
  const topOutcomes = fixture.outcomes.slice(0, 6)
  const maximum = Math.max(...topOutcomes.map((row) => row.count))
  return (
    <div className="space-y-4">
      <ProvenanceChip provenance={fixture.provenance} derivation="Exact aggregates of rows whose normalized crime_group is CYBER CRIME. No coordinate, graph, or routing service is required." />
      <Panel title="Current outcomes" eyebrow="OBSERVED STAGE">
        <div className="space-y-3">
          {topOutcomes.map((row) => (
            <div key={row.stage}>
              <div className="flex justify-between text-xs"><span className="text-[--txt-2]">{title(row.stage)}</span><span className="font-mono">{format(row.count)}</span></div>
              <div className="mt-1 h-1 bg-[--ink-600]"><div className="h-full bg-[--teal-400]" style={{ width: `${(row.count / maximum) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Victim categories" eyebrow="SOURCE COLUMNS ONLY">
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(fixture.victims).map(([category, count]) => (
            <div className="rounded-[--r-sm] border border-[--ink-600] bg-[--ink-850] p-3" key={category}><p className="type-micro text-[--txt-3]">{category}</p><p className="mt-1 font-mono text-lg font-semibold">{format(count)}</p></div>
          ))}
        </div>
        <p className="mt-3 text-[10px] leading-4 text-[--txt-3]">Only the four victim categories present in the source are rendered.</p>
      </Panel>
      <Panel title="Complaint-mode truth" eyebrow="DRIFT DISCLOSURE">
        <p className="text-xs leading-5 text-[--txt-2]">Only 2 cyber FIR rows are explicitly recorded as Online. The mirror does not support a rising-online-share claim, so none is made.</p>
      </Panel>
    </div>
  )
}

export function CyberWing() {
  const [fixture, setFixture] = useState<CyberFixture | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    fetch('/data/scenarios/cyber_wing.json')
      .then((response) => {
        if (!response.ok) throw new Error(`Cyber snapshot request failed (${response.status})`)
        return response.json() as Promise<CyberFixture>
      })
      .then(setFixture)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Cyber snapshot unavailable'))
  }, [])
  const topModes = useMemo(() => fixture?.complaint_modes.slice(0, 5) ?? [], [fixture])

  if (error) {
    return <OpsShell title="Cyber Intelligence Wing" eyebrow="DETECT" context={<p className="text-sm text-[--critical]">{error}</p>} inspector={<p className="text-sm text-[--txt-2]">No aggregate claims rendered.</p>}><div className="grid h-full place-items-center bg-[--ink-900] text-[--critical]">Cyber snapshot unavailable</div></OpsShell>
  }
  if (!fixture) return <div className="grid h-screen place-items-center bg-[--ink-900] text-[--txt-2]">Loading cyber aggregates…</div>

  return (
    <OpsShell
      context={<Context fixture={fixture} />}
      eyebrow="DETECT · NON-GEOGRAPHIC"
      inspector={<InspectorContent fixture={fixture} />}
      inspectorEyebrow="FIR MIRROR · OBSERVED"
      inspectorTitle="Cyber evidence"
      title="Cyber Intelligence Wing"
    >
      <div className="h-full overflow-y-auto bg-[--ink-900] p-6">
        <header className="flex flex-wrap items-end justify-between gap-5 border-b border-[--ink-600] pb-6">
          <div>
            <p className="type-micro text-[--cyan-400]">Bengaluru City · 2016–2024 partial</p>
            <h2 className="mt-2 text-2xl font-semibold">The caseload the map cannot show</h2>
            <p className="mt-2 max-w-2xl text-sm text-[--txt-2]">Volume, legal sections, complaint mode, current outcome, and source-supported victim categories—without a misleading geographic view.</p>
          </div>
          <span className="flex items-center gap-2 rounded-[--r-full] border border-[--ok] px-3 py-2 text-[10px] text-[--ok]"><ShieldCheck size={13} /> ZERO GEOGRAPHIC DEPENDENCY</span>
        </header>

        <section className="grid gap-4 py-6 sm:grid-cols-3">
          <div className="metric-tile"><p className="type-micro text-[--txt-3]">Cyber FIRs</p><p className="mt-2 font-mono text-3xl font-semibold">{format(fixture.summary.cyber_records)}</p><p className="mt-1 text-xs text-[--cyan-400]">{fixture.summary.caseload_share_pct.toFixed(2)}% of caseload</p></div>
          <div className="metric-tile"><p className="type-micro text-[--txt-3]">Mappable / routable</p><p className="mt-2 font-mono text-3xl font-semibold">{fixture.summary.mappable_share_pct.toFixed(2)}%</p><p className="mt-1 text-xs text-[--txt-2]">{format(fixture.summary.mappable_coordinates)} inside canonical bbox</p></div>
          <div className="metric-tile"><p className="type-micro text-[--txt-3]">Non-zero coordinates</p><p className="mt-2 font-mono text-3xl font-semibold">{fixture.summary.nonzero_share_pct.toFixed(1)}%</p><p className="mt-1 text-xs text-[--txt-2]">{format(fixture.summary.nonzero_coordinates)} rows · secondary only</p></div>
        </section>

        <section className="panel">
          <div className="panel-header"><div><p className="type-micro text-[--txt-3]">MONTHLY VOLUME</p><h3 className="mt-1 flex items-center gap-2 text-base font-semibold"><BarChart3 size={16} /> Cyber FIRs against all FIRs</h3></div><ProvenanceChip provenance={fixture.provenance} derivation="Monthly counts by registration date. 2024 is visibly marked partial and is not used for trend inference." /></div>
          <VolumeChart rows={fixture.monthly_volume} />
        </section>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_.7fr]">
          <section className="panel">
            <div className="panel-header"><div><p className="type-micro text-[--txt-3]">LEGAL CLASSIFICATION</p><h3 className="mt-1 flex items-center gap-2 text-base font-semibold"><FileText size={16} /> Top exact Act / section combinations</h3></div><ProvenanceChip provenance={fixture.provenance} derivation="Exact source act_section strings, ranked by FIR count. Similar-looking strings are not merged." /></div>
            <SectionBars rows={fixture.top_act_sections} />
          </section>
          <section className="panel">
            <div className="panel-header"><div><p className="type-micro text-[--txt-3]">COMPLAINT → FIR</p><h3 className="mt-1 flex items-center gap-2 text-base font-semibold"><MonitorSmartphone size={16} /> Recorded complaint mode</h3></div></div>
            <div className="mt-4 space-y-3">
              {topModes.map((row, index) => (
                <div className="flex items-center gap-3" key={row.complaint_mode}><span className="grid h-7 w-7 place-items-center rounded-full border border-[--ink-500] font-mono text-[10px] text-[--txt-3]">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-xs text-[--txt-2]">{row.complaint_mode}</p><p className="font-mono text-sm">{format(row.count)}</p></div></div>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-[--ink-600] pt-4 text-xs"><span className="text-[--txt-3]">All modes → registered FIR</span><strong className="font-mono">{format(fixture.summary.cyber_records)}</strong></div>
          </section>
        </div>

        <section className="panel mt-4">
          <div className="panel-header"><div><p className="type-micro text-[--txt-3]">REGISTRATION MODE BY YEAR</p><h3 className="mt-1 flex items-center gap-2 text-base font-semibold"><Users size={16} /> Exact observed split</h3></div><ProvenanceChip provenance={fixture.provenance} derivation="Exact complaint_mode counts by FIR year. The 2024 collection is partial; only two cyber rows are explicitly Online." /></div>
          <ModeByYear rows={fixture.complaint_modes_by_year} />
        </section>
      </div>
    </OpsShell>
  )
}
