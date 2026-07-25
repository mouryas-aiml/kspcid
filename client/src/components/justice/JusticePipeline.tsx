'use client'

import { AlertTriangle, ArrowRight, GitBranch, Scale, TimerReset } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { ProvenanceChip } from '@/components/primitives/ProvenanceChip'
import type { Provenance } from '@/lib/provenance'

interface StageCount {
  readonly stage: string
  readonly label: string
  readonly count: number
}

interface Station {
  readonly station_code: string
  readonly unit_name: string
  readonly police_division: string
  readonly stages: Readonly<Record<string, number>>
  readonly ageing: Readonly<Record<string, number>>
}

interface JusticeFixture {
  readonly analysis_cutoff: string
  readonly observed: {
    readonly total_records: number
    readonly stages: readonly StageCount[]
    readonly by_year: readonly { year: number; stage: string; count: number }[]
    readonly stations: readonly Station[]
    readonly provenance: Provenance
  }
  readonly modelled: {
    readonly edges: readonly { source: string; target: string; count: number }[]
    readonly provenance: Provenance
  }
}

const COLORS: Readonly<Record<string, string>> = {
  pending_trial: '#8A6300',
  undetected: '#F04438',
  convicted: '#12B76A',
  traced: '#0284C7',
  under_investigation: '#7C3AED',
  false_case: '#64748B',
  compounded: '#0F766E',
  discharged_acquitted: '#4D7C0F',
  bound_over: '#C2410C',
  other_disposal: '#475569',
  un_traced: '#E11D48',
  abated: '#6B7280',
  transferred: '#7E22CE',
}

const AGE_BUCKETS = [
  ['lt_30d', '<30d'],
  ['30_90d', '30–90d'],
  ['90_180d', '90–180d'],
  ['180_365d', '180–365d'],
  ['1_2y', '1–2y'],
  ['2y_plus', '2y+'],
] as const

function format(value: number): string {
  return value.toLocaleString('en-IN')
}

function humanize(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function stageRows(
  fixture: JusticeFixture,
  scope: 'city' | 'year' | 'station',
  year: number,
  stationCode: string,
): StageCount[] {
  if (scope === 'city') return [...fixture.observed.stages]
  const counts = new Map<string, number>()
  if (scope === 'year') {
    for (const row of fixture.observed.by_year) {
      if (row.year === year) counts.set(row.stage, row.count)
    }
  } else {
    const station = fixture.observed.stations.find((row) => row.station_code === stationCode)
    for (const [stage, count] of Object.entries(station?.stages ?? {})) counts.set(stage, count)
  }
  return fixture.observed.stages
    .map((row) => ({ ...row, count: counts.get(row.stage) ?? 0 }))
    .filter((row) => row.count > 0)
    .sort((left, right) => right.count - left.count || left.stage.localeCompare(right.stage))
}

function FlowFigure({
  rows,
  percentage,
}: {
  readonly rows: readonly StageCount[]
  readonly percentage: boolean
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0)
  const height = Math.max(390, rows.length * 36 + 28)
  const available = height - 24
  return (
    <div className="mt-5 overflow-x-auto">
      <svg
        aria-label="Registered FIRs flowing to exact observed current stages"
        className="min-w-[680px]"
        viewBox={`0 0 720 ${height}`}
        role="img"
      >
        <rect x="8" y={height / 2 - 42} width="116" height="84" rx="5" fill="#14181F" />
        <text x="66" y={height / 2 - 8} textAnchor="middle" fill="#fff" fontSize="12">
          Registered FIRs
        </text>
        <text x="66" y={height / 2 + 15} textAnchor="middle" fill="#fff" fontSize="16" fontWeight="700">
          {format(total)}
        </text>
        {rows.map((row, index) => {
          const y = 12 + ((index + 0.5) * available) / rows.length
          const ratio = total ? row.count / total : 0
          const strokeWidth = Math.max(2, ratio * 145)
          return (
            <g key={row.stage}>
              <path
                d={`M124 ${height / 2} C 280 ${height / 2}, 310 ${y}, 472 ${y}`}
                fill="none"
                opacity=".48"
                stroke={COLORS[row.stage] ?? '#64748B'}
                strokeWidth={strokeWidth}
              />
              <rect
                x="472"
                y={y - 13}
                width="236"
                height="26"
                rx="4"
                fill={row.stage === 'undetected' ? '#FFF0EF' : '#F8F7F4'}
                stroke={COLORS[row.stage] ?? '#64748B'}
              />
              <text x="483" y={y + 4} fill="#14181F" fontSize="11" fontWeight="600">
                {row.label}
              </text>
              <text x="697" y={y + 4} textAnchor="end" fill="#14181F" fontFamily="monospace" fontSize="11">
                {percentage ? `${(ratio * 100).toFixed(1)}%` : format(row.count)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function ModelledFigure({ fixture }: { readonly fixture: JusticeFixture }) {
  const max = Math.max(...fixture.modelled.edges.map((edge) => edge.count))
  return (
    <div className="mt-5 grid gap-2 sm:grid-cols-2">
      {fixture.modelled.edges.map((edge) => (
        <div
          className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border border-[#D8C7F2] bg-[#FAF7FF] px-3 py-2"
          key={`${edge.source}-${edge.target}`}
        >
          <span className="truncate text-xs">{humanize(edge.source)}</span>
          <ArrowRight size={13} className="text-[#7C3AED]" />
          <span className="truncate text-right text-xs font-semibold">{humanize(edge.target)}</span>
          <div className="col-span-3 h-1 bg-[#EDE5F7]">
            <div className="h-full bg-[#7C3AED]" style={{ width: `${(edge.count / max) * 100}%` }} />
          </div>
          <span className="col-span-3 text-right font-mono text-[10px] text-[--ink-soft]">
            {format(edge.count)} generated paths
          </span>
        </div>
      ))}
    </div>
  )
}

export function JusticePipeline() {
  const [fixture, setFixture] = useState<JusticeFixture | null>(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'observed' | 'modelled'>('observed')
  const [scope, setScope] = useState<'city' | 'year' | 'station'>('city')
  const [year, setYear] = useState(2023)
  const [stationCode, setStationCode] = useState('')
  const [compareCode, setCompareCode] = useState('')
  const [percentage, setPercentage] = useState(false)

  useEffect(() => {
    fetch('/data/scenarios/justice_pipeline.json')
      .then((response) => {
        if (!response.ok) throw new Error(`Fixture request failed (${response.status})`)
        return response.json() as Promise<JusticeFixture>
      })
      .then((data) => {
        setFixture(data)
        setStationCode(data.observed.stations[0]?.station_code ?? '')
        setCompareCode(data.observed.stations[1]?.station_code ?? '')
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Fixture unavailable'))
  }, [])

  const years = useMemo(
    () => [...new Set(fixture?.observed.by_year.map((row) => row.year) ?? [])].sort((a, b) => b - a),
    [fixture],
  )
  const rows = useMemo(
    () => (fixture ? stageRows(fixture, scope, year, stationCode) : []),
    [fixture, scope, year, stationCode],
  )
  const selectedStation = fixture?.observed.stations.find((row) => row.station_code === stationCode)
  const compareStation = fixture?.observed.stations.find((row) => row.station_code === compareCode)
  const cityAgeing = useMemo(() => {
    const aggregate: Record<string, number> = {}
    for (const station of fixture?.observed.stations ?? []) {
      for (const [bucket, count] of Object.entries(station.ageing)) {
        aggregate[bucket] = (aggregate[bucket] ?? 0) + count
      }
    }
    return aggregate
  }, [fixture])
  const ageing = scope === 'station' ? selectedStation?.ageing ?? {} : cityAgeing
  const undetected = rows.find((row) => row.stage === 'undetected')?.count ?? 0
  const total = rows.reduce((sum, row) => sum + row.count, 0)

  if (error) {
    return <article className="p-12 text-[--critical]">Justice fixture unavailable: {error}</article>
  }
  if (!fixture) {
    return <article className="p-12 text-[--ink-soft]">Compiling exact observed-stage view…</article>
  }

  const provenance = mode === 'observed' ? fixture.observed.provenance : fixture.modelled.provenance
  return (
    <article className="p-8 sm:p-12">
      {mode === 'modelled' ? (
        <div className="no-print -mx-8 -mt-8 mb-8 flex items-center gap-3 bg-[#6D28D9] px-8 py-3 text-white sm:-mx-12 sm:-mt-12 sm:px-12">
          <GitBranch size={17} />
          <strong className="text-xs tracking-[.08em]">GENERATED MODEL — NOT OBSERVED TRANSITION HISTORY</strong>
        </div>
      ) : null}
      <header className="border-b border-[--rule] pb-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className={`type-micro ${mode === 'observed' ? 'text-[--gold-print]' : 'text-[#6D28D9]'}`}>
              {mode === 'observed' ? 'Observed mode' : 'Generated model'}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em]">Justice Pipeline</h1>
            <p className="mt-2 text-sm text-[--ink-soft]">
              Current FIR stage accountability · Bengaluru City · cutoff {fixture.analysis_cutoff}
            </p>
          </div>
          <ProvenanceChip
            className="[&_.provenance-popover]:text-[--txt]"
            provenance={provenance}
            derivation={
              mode === 'observed'
                ? 'Exact group-by of the normalized current FIR_Stage value. The source contains no event-level transition history.'
                : 'Illustrative multi-hop paths constrained to each record’s observed terminal stage. Intermediate hops are generated.'
            }
          />
        </div>
        <div className="no-print mt-6 flex flex-wrap gap-2">
          <button
            className={`rounded border px-3 py-2 text-xs ${mode === 'observed' ? 'border-[--gold-print] bg-[#FFF8E8] font-semibold' : 'border-[--rule]'}`}
            onClick={() => setMode('observed')}
            type="button"
          >
            Observed one-hop
          </button>
          <button
            className={`rounded border px-3 py-2 text-xs ${mode === 'modelled' ? 'border-[#7C3AED] bg-[#F6F0FF] font-semibold text-[#6D28D9]' : 'border-[--rule]'}`}
            onClick={() => setMode('modelled')}
            type="button"
          >
            Generated multi-hop
          </button>
        </div>
      </header>

      <section className="no-print grid gap-4 border-b border-[--rule] py-6 sm:grid-cols-4">
        <label className="text-xs text-[--ink-soft]">
          Scope
          <select
            className="mt-1 block w-full rounded border border-[--rule] bg-white p-2 text-[--ink]"
            onChange={(event) => setScope(event.target.value as typeof scope)}
            value={scope}
          >
            <option value="city">City total</option>
            <option value="year">FIR year</option>
            <option value="station">Police station</option>
          </select>
        </label>
        {scope === 'year' ? (
          <label className="text-xs text-[--ink-soft]">
            FIR year
            <select className="mt-1 block w-full rounded border border-[--rule] bg-white p-2 text-[--ink]" onChange={(event) => setYear(Number(event.target.value))} value={year}>
              {years.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
        ) : null}
        {scope === 'station' ? (
          <label className="text-xs text-[--ink-soft] sm:col-span-2">
            Police station
            <select className="mt-1 block w-full rounded border border-[--rule] bg-white p-2 text-[--ink]" onChange={(event) => setStationCode(event.target.value)} value={stationCode}>
              {fixture.observed.stations.map((station) => (
                <option key={station.station_code} value={station.station_code}>{station.unit_name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex items-end gap-2 pb-2 text-xs text-[--ink-soft]">
          <input checked={percentage} onChange={(event) => setPercentage(event.target.checked)} type="checkbox" />
          Show percentages
        </label>
      </section>

      <section className="py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Scale size={18} /> Registered FIRs → current stage
            </h2>
            <p className="mt-1 text-sm text-[--ink-soft]">
              {mode === 'observed'
                ? 'One observed current state per FIR; counts reconcile exactly to the selected scope.'
                : 'Generated intermediate stages are visually separated from source observations.'}
            </p>
          </div>
          <ProvenanceChip
            className="[&_.provenance-popover]:text-[--txt]"
            provenance={provenance}
            derivation={mode === 'observed' ? 'Exact stage counts for the selected scope.' : 'Generated edge counts derived from terminal-constrained templates.'}
          />
        </div>
        {mode === 'observed' ? <FlowFigure percentage={percentage} rows={rows} /> : <ModelledFigure fixture={fixture} />}
      </section>

      {mode === 'observed' ? (
        <>
          <aside className="border-l-4 border-[--critical] bg-[#FFF5F4] p-5">
            <p className="type-micro text-[--critical]">Actionable backlog</p>
            <p className="mt-2 text-2xl font-semibold">{format(undetected)} undetected</p>
            <p className="mt-1 text-sm text-[--ink-soft]">
              {total ? ((undetected / total) * 100).toFixed(1) : '0.0'}% of records in the selected scope.
              Citywide observed total is 92,874 (21.8%).
            </p>
          </aside>

          <section className="border-b border-[--rule] py-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold"><TimerReset size={18} /> Open-case ageing</h2>
                <p className="mt-1 text-sm text-[--ink-soft]">
                  Complete-window registrations in open stages, aged to {fixture.analysis_cutoff}.
                </p>
              </div>
              <ProvenanceChip
                className="[&_.provenance-popover]:text-[--txt]"
                provenance={fixture.observed.provenance}
                derivation="Age at the fixed analysis cutoff for pending trial, under investigation, undetected, and untraced records inside the complete analysis window."
              />
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {AGE_BUCKETS.map(([key, label]) => (
                <div className={`border p-4 ${key === '2y_plus' ? 'border-[#F5B8B2] bg-[#FFF5F4]' : 'border-[--rule] bg-[--paper-tint]'}`} key={key}>
                  <p className="type-micro text-[--ink-soft]">{label}</p>
                  <p className="mt-1 font-mono text-xl font-semibold">{format(ageing[key] ?? 0)}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="no-print py-8">
            <h2 className="text-lg font-semibold">Two-station comparison</h2>
            <p className="mt-1 text-sm text-[--ink-soft]">Exact current-stage totals; no inferred station-to-station ranking.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {[selectedStation, compareStation].map((station, index) => (
                <div className="border border-[--rule] p-4" key={`${index}-${station?.station_code ?? 'none'}`}>
                  <select
                    className="w-full rounded border border-[--rule] bg-white p-2 text-xs"
                    onChange={(event) => (index === 0 ? setStationCode(event.target.value) : setCompareCode(event.target.value))}
                    value={index === 0 ? stationCode : compareCode}
                  >
                    {fixture.observed.stations.map((option) => <option key={option.station_code} value={option.station_code}>{option.unit_name}</option>)}
                  </select>
                  <div className="mt-4 flex items-end justify-between">
                    <div>
                      <p className="type-micro text-[--ink-soft]">Undetected</p>
                      <p className="mt-1 font-mono text-2xl font-semibold text-[--critical]">{format(station?.stages.undetected ?? 0)}</p>
                    </div>
                    <div className="text-right">
                      <p className="type-micro text-[--ink-soft]">All FIRs</p>
                      <p className="mt-1 font-mono text-lg font-semibold">{format(Object.values(station?.stages ?? {}).reduce((sum, value) => sum + value, 0))}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : (
        <aside className="flex gap-3 border border-[#D8C7F2] bg-[#FAF7FF] p-5 text-sm">
          <AlertTriangle className="shrink-0 text-[#7C3AED]" size={19} />
          These edges are generated analytical scaffolding. Only each record’s final current stage is observed.
        </aside>
      )}
    </article>
  )
}
