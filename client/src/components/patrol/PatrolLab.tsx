'use client'

import {
  AlertTriangle,
  Bike,
  CarFront,
  CloudRain,
  Footprints,
  Gauge,
  LocateFixed,
  MapPinned,
  Pause,
  Play,
  RotateCcw,
  Route,
  Shield,
  Sparkles,
  Siren,
  TrafficCone,
  UserRound,
  X,
} from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { PatrolMap } from '@/components/patrol/PatrolMap'
import { Panel } from '@/components/primitives/Panel'
import { ProvenanceChip } from '@/components/primitives/ProvenanceChip'
import { OpsShell } from '@/components/shell/OpsShell'
import {
  baselineDeployment,
  optimizeDeployment,
  optimizeDeploymentWithFallback,
} from '@/lib/patrol/optimizer'
import { isCovered, loadPatrolData, travelSeconds, unionCoverage } from '@/lib/patrol/routing'
import { scoreDeployment } from '@/lib/patrol/scoring'
import { simulateUntil } from '@/lib/patrol/simulation'
import { usePatrolStore } from '@/lib/patrol/store'
import type {
  Deployment,
  PatrolData,
  PatrolUnit,
  RoutingCell,
  ScoreBreakdown,
} from '@/lib/patrol/types'
import type { Provenance } from '@/lib/provenance'
import {
  OSRM_FREE_FLOW_KMH,
  assumedSpeedKmh,
  bandForHour,
  congestionMultiplier,
  hourForSimulationMinute,
  type CongestionBand,
} from '@/lib/patrol/congestion'

const unitColour: Record<string, string> = {
  Hoysala: '#38BDF8',
  Cheetah: '#FFC53D',
  'Foot patrol': '#2DD4BF',
  'Pink Hoysala': '#F472B6',
  Traffic: '#F79009',
}

const speeds = [1, 4, 16, 60] as const
const magma = ['#150b2a', '#451077', '#7e2482', '#bd3f69', '#ef7652', '#fdbc5b']

function unitIcon(type: string) {
  if (type === 'Cheetah') return Bike
  if (type === 'Foot patrol') return Footprints
  if (type === 'Pink Hoysala') return Shield
  if (type === 'Traffic') return TrafficCone
  return CarFront
}

const congestionProvenance: Provenance = {
  source_authority: 'open_reference',
  transformation: 'derived',
  method: 'hour_of_day_congestion_v1',
  // Mirrors data/routing/travel_time_profiles.json, whose source checksum is
  // the validated OSRM routing fixture the multipliers were measured against.
  source_checksum: '702096aa51e8622706f473af0a4e46a9d6b6fd6cdb69f3759bd84e3e402532ca',
  generation_version: 'kspcid-etl-1.0.0',
}

const CONGESTION_DERIVATION =
  'TomTom Traffic Index 2025 (Bengaluru, city), retrieved 2026-07-26: 16.6 km/h all-day, ' +
  '14.6 km/h morning rush, 13.2 km/h evening rush. The multiplier is OSRM free-flow speed ' +
  'divided by the observed speed, applied to stored durations at runtime only — the stored ' +
  'matrix stays free-flow. See etl/20_travel_time_profiles.ts.'

function bandLabel(band: CongestionBand): string {
  if (band === 'morning_rush') return 'morning rush hour'
  if (band === 'evening_rush') return 'evening rush hour'
  return 'all-day average (no published night figure)'
}

function formatClock(minute: number): string {
  const total = 20 * 60 + Math.floor(minute)
  const hour = Math.floor(total / 60) % 24
  return `${String(hour).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function gradeColour(total: number): string {
  if (total < 500) return 'var(--critical)'
  if (total < 650) return 'var(--warn)'
  if (total < 790) return 'var(--cyan-400)'
  return 'var(--ok)'
}

function ForcePanel({ data }: { readonly data: PatrolData }) {
  const deployment = usePatrolStore((state) => state.deployment)
  const selectedUnit = usePatrolStore((state) => state.selectedUnit)
  const selectUnit = usePatrolStore((state) => state.selectUnit)
  const toggleReserve = usePatrolStore((state) => state.toggleReserve)
  const targetMinutes = usePatrolStore((state) => state.targetMinutes)
  const setTarget = usePatrolStore((state) => state.setTarget)
  const requiredReserve = usePatrolStore((state) => state.requiredReserve)
  const setReserve = usePatrolStore((state) => state.setReserve)
  const rain = usePatrolStore((state) => state.rain)
  const roadClosure = usePatrolStore((state) => state.roadClosure)
  const toggleRain = usePatrolStore((state) => state.toggleRain)
  const toggleClosure = usePatrolStore((state) => state.toggleClosure)
  const minute = usePatrolStore((state) => state.minute)
  const shiftHour = hourForSimulationMinute(
    data.scenario.time_window.selected_hours_local,
    minute,
  )
  const reset = usePatrolStore((state) => state.reset)
  const setOptimized = usePatrolStore((state) => state.setOptimized)
  const [optimizing, setOptimizing] = useState(false)

  const groups = data.scenario.roster.reduce<Record<string, PatrolUnit[]>>((result, unit) => {
    ;(result[unit.unit_type] ??= []).push(unit)
    return result
  }, {})

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between">
          <p className="type-micro text-[--txt-3]">Demo patrol units</p>
          <span className="rounded-full bg-[color-mix(in_srgb,var(--prov-generated)_14%,transparent)] px-2 py-1 text-[10px] text-[--prov-generated]">
            DEMO · 16
          </span>
        </div>
        <p className="mt-2 text-xs leading-5 text-[--txt-2]">
          Select a unit, then choose an area. Use the reserve button to keep a unit available.
        </p>
      </div>
      <div className="space-y-3">
        {Object.entries(groups).map(([type, units]) => {
          const Icon = unitIcon(type)
          return (
            <div key={type}>
              <div className="mb-1.5 flex items-center gap-2 text-xs font-medium">
                <Icon size={14} style={{ color: unitColour[type] }} />
                <span>{type}</span>
                <span className="ml-auto font-mono text-[--txt-3]">{units.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {units.map((unit) => {
                  const reserve = deployment[unit.unit_id] === null
                  return (
                    <div
                      key={unit.unit_id}
                      className={`overflow-hidden rounded-[--r-sm] border ${
                        selectedUnit === unit.unit_id
                          ? 'border-[--gold-400] bg-[color-mix(in_srgb,var(--gold-400)_8%,transparent)]'
                          : 'border-[--ink-600] bg-[--ink-800]'
                      }`}
                    >
                      <button
                        type="button"
                        className="w-full px-2 py-1.5 text-left text-[10px]"
                        onClick={() => selectUnit(selectedUnit === unit.unit_id ? null : unit.unit_id)}
                      >
                        <span className="block font-mono text-[--txt]">{unit.unit_id}</span>
                        <span className={reserve ? 'text-[--warn]' : 'text-[--txt-3]'}>
                          {reserve ? 'RESERVE' : 'DEPLOYED'}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="w-full border-t border-[--ink-600] px-2 py-1 text-[9px] text-[--txt-3] hover:text-[--txt]"
                        onClick={() => toggleReserve(unit.unit_id)}
                      >
                        {reserve ? 'Post unit' : 'Hold reserve'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-[--txt-3]">
          RESPONSE TARGET
          <select
            value={targetMinutes}
            onChange={(event) => setTarget(Number(event.target.value))}
            className="mt-1 w-full rounded-[--r-sm] border border-[--ink-500] bg-[--ink-800] px-2 py-2 font-mono text-xs text-[--txt]"
          >
            {[3, 5, 7, 10, 15].map((minutes) => (
              <option key={minutes} value={minutes}>{minutes} min</option>
            ))}
          </select>
        </label>
        <label className="text-[10px] text-[--txt-3]">
          REQUIRED RESERVE
          <input
            type="number"
            min={0}
            max={8}
            value={requiredReserve}
            onChange={(event) => setReserve(Number(event.target.value))}
            className="mt-1 w-full rounded-[--r-sm] border border-[--ink-500] bg-[--ink-800] px-2 py-2 font-mono text-xs text-[--txt]"
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          data-active={rain}
          onClick={toggleRain}
          className="condition-button"
        >
          <CloudRain size={14} /> Heavy rain
        </button>
        <button
          type="button"
          data-active={roadClosure}
          onClick={toggleClosure}
          className="condition-button"
        >
          <TrafficCone size={14} /> Road closure
        </button>
      </div>

      {/* §8.4 / T6 — a judge asking "what speed are you assuming?" gets the
          answer on screen, not out of a file. The multiplier is applied to the
          stored free-flow durations at runtime; the durations never change. */}
      <div className="rounded-[--r-sm] border border-[--ink-600] bg-[--ink-800] px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="type-micro text-[--txt-3]">ESTIMATED TRAFFIC SPEED</span>
          <ProvenanceChip derivation={CONGESTION_DERIVATION} provenance={congestionProvenance} />
        </div>
        <div className="mt-1 font-mono text-[13px] tabular-nums text-[--txt]">
          {assumedSpeedKmh(shiftHour)} km/h
          <span className="ml-2 text-[--txt-2]">traffic-adjusted</span>
        </div>
        <p className="mt-1 text-[10px] leading-snug text-[--txt-3]">
          {formatClock(minute)} · {bandLabel(bandForHour(shiftHour))}. Road coverage uses normal
          travel times; response times include the traffic adjustment.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="rounded-[--r-sm] bg-[--gold-500] px-3 py-2 text-xs font-semibold text-[--ink-900]"
          disabled={optimizing}
          onClick={() => {
            setOptimizing(true)
            void optimizeDeploymentWithFallback(data, targetMinutes, requiredReserve)
              .then(setOptimized)
              .finally(() => setOptimizing(false))
          }}
        >
          {optimizing ? 'Preparing…' : 'Suggest plan'}
        </button>
        <button
          type="button"
          className="flex items-center justify-center gap-2 rounded-[--r-sm] border border-[--ink-500] px-3 py-2 text-xs"
          onClick={reset}
        >
          <RotateCcw size={13} /> Reset
        </button>
      </div>
    </div>
  )
}

// Projection and the SVG PatrolMap were replaced by a deck.gl + MapLibre
// surface (§8.9). See ./PatrolMap.tsx — the geometry and coverage maths are
// unchanged; only the renderer moved.

function ScorePanel({
  data,
  score,
  snapshot,
}: {
  readonly data: PatrolData
  readonly score: ScoreBreakdown
  readonly snapshot: ReturnType<typeof simulateUntil>
}) {
  const optimized = usePatrolStore((state) => state.optimized)
  const showGhost = usePatrolStore((state) => state.showGhost)
  const setShowGhost = usePatrolStore((state) => state.setShowGhost)
  const provenance: Provenance = {
    source_authority: 'third_party_mirror',
    transformation: 'derived',
    method: 'recency_weighted_h3_demand_and_osrm_matrix',
    source_checksum: data.scenario.provenance.source_checksum,
    generation_version: data.scenario.provenance.generation_version,
  }
  /**
   * Plain labels, with one line saying what each is.
   *
   * These read "Coverage / Response p50 / Equity / Reserve / Efficiency" in the
   * scoring code, which is right for the code and wrong for the panel: an
   * officer looking at this for the first time cannot tell what "p50" is or
   * whether an equity of 0.82 is good. The number and the bar are unchanged —
   * only the words around them.
   */
  const metrics = [
    [
      'Calls reached in time',
      `${(score.coverageRatio * 100).toFixed(1)}%`,
      score.coveragePoints,
      400,
      'Share of expected calls a unit can reach inside the response target.',
    ],
    [
      'Typical response',
      `${score.p50Minutes.toFixed(1)} min`,
      score.responsePoints,
      250,
      'Half of calls are reached faster than this, half slower.',
    ],
    [
      'Evenly spread',
      score.equity.toFixed(2),
      score.equityPoints,
      150,
      'Whether cover is shared across the area or concentrated in one part. 1.00 is even.',
    ],
    [
      'Units held in reserve',
      String(score.reserveCount),
      score.reservePoints,
      100,
      'Units kept free for a call that has not come in yet.',
    ],
    [
      'Distance driven',
      `${score.totalUnitKm.toFixed(1)} km`,
      score.efficiencyPoints,
      100,
      'Total distance across all units. Less is better for the same cover.',
    ],
  ] as const
  return (
    <div className="space-y-4">
      <div className="score-hero">
        <div
          className="score-ring"
          style={{
            '--score-angle': `${Math.max(0, Math.min(1000, score.total)) * 0.36}deg`,
            '--score-colour': gradeColour(score.total),
          } as React.CSSProperties}
        >
          <div><strong>{score.total}</strong><span>/1000</span></div>
        </div>
        <div>
          <p className="type-micro text-[--txt-3]">Plan score</p>
          <h2 className="mt-1 text-lg font-semibold" style={{ color: gradeColour(score.total) }}>
            {score.grade}
          </h2>
          <p className="mt-1 text-xs text-[--txt-3]">{snapshot.missed} missed · {snapshot.completed} complete</p>
        </div>
      </div>
      {/* One sentence a first-time viewer can act on, before the breakdown. */}
      <p className="text-xs leading-5 text-[--txt-2]">
        This plan reaches <strong className="text-[--txt-hi]">{(score.coverageRatio * 100).toFixed(0)}%</strong>{' '}
        of expected calls in time, with a typical response of{' '}
        <strong className="text-[--txt-hi]">{score.p50Minutes.toFixed(1)} minutes</strong>. Move a unit
        and the score changes straight away.
      </p>
      <div className="space-y-3">
        {metrics.map(([label, value, points, maximum, hint]) => (
          <div key={label}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[--txt-2]">{label}</span>
              <span className="font-mono">{value}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[--ink-700]">
              <div
                className="h-full rounded-full bg-[--cyan-400]"
                style={{ width: `${Math.max(0, Math.min(100, (points / maximum) * 100))}%` }}
              />
            </div>
            <div className="mt-1 flex items-start justify-between gap-3">
              <p className="text-[10px] leading-4 text-[--txt-3]">{hint}</p>
              <span className="shrink-0 font-mono text-[9px] text-[--txt-3]">
                {points.toFixed(1)} / {maximum}
              </span>
            </div>
          </div>
        ))}
      </div>
      <Panel title="How the score works" eyebrow="SCORE BREAKDOWN">
        <p className="text-xs leading-5 text-[--txt-2]">
          Calls reached in time: 400 points · response time: 250 · even coverage: 150 ·
          reserve units: 100 · distance driven: 100.
        </p>
        <p className="mt-3 border-t border-[--ink-600] pt-3 text-xs leading-5 text-[--txt-3]">
          The score measures reach and response only; it does not estimate changes in crime.
        </p>
      </Panel>
      <ProvenanceChip
        provenance={provenance}
        derivation="Groups historical FIR registrations into nearby areas and gives more weight to recent weeks. Coverage and response follow the road network. Patrol names and staffing are demonstration inputs."
      />
      <Panel title="Dispatch feed" eyebrow={`${snapshot.active} ACTIVE`}>
        <div className="space-y-2">
          {snapshot.dispatches.slice(-6).reverse().map((dispatch) => (
            <div
              key={dispatch.event.incident_id}
              className="grid grid-cols-[42px_1fr_auto] items-center gap-2 border-b border-[--ink-600] pb-2 text-[10px] last:border-0 last:pb-0"
            >
              <span className="font-mono text-[--txt-3]">
                {formatClock(dispatch.event.simulation_minute)}
              </span>
              <span className="truncate text-[--txt-2]">
                {dispatch.event.case_ref} · {dispatch.unitId ?? 'No available unit'}
              </span>
              <span
                className={
                  dispatch.result === 'missed'
                    ? 'text-[--critical]'
                    : dispatch.result === 'complete'
                      ? 'text-[--ok]'
                      : 'text-[--gold-400]'
                }
              >
                {dispatch.result === 'missed'
                  ? 'MISSED'
                  : dispatch.responseMinutes === null
                    ? dispatch.result
                    : `${dispatch.responseMinutes.toFixed(1)}m`}
              </span>
            </div>
          ))}
          {snapshot.dispatches.length === 0 ? (
            <p className="text-xs text-[--txt-3]">Replay has not started.</p>
          ) : null}
        </div>
      </Panel>
      {optimized ? (
        <Panel
          title="Heuristic ready"
          eyebrow={
            optimized.source === 'precomputed_fallback'
              ? 'STORED FALLBACK'
              : `${optimized.elapsedMs.toFixed(1)} MS`
          }
        >
          <p className="mb-2 font-mono text-lg font-semibold text-[--txt-hi]">
            {optimized.source === 'precomputed_fallback' ? 'Stored' : 'Computed'} plan score {optimized.score.total}
          </p>
          <p className="text-xs leading-5 text-[--txt-2]">
            MCLP-inspired heuristic (greedy + local search). 300 deterministic 1-swaps plus equity repair, following the Church & ReVelle covering formulation.
          </p>
          <button
            type="button"
            className="mt-3 w-full rounded-[--r-sm] border border-[--prov-generated] px-3 py-2 text-xs text-[--prov-generated]"
            onClick={() => setShowGhost(!showGhost)}
          >
            {showGhost ? 'Hide optimized ghosts' : 'Show optimized ghosts'}
          </button>
        </Panel>
      ) : null}
    </div>
  )
}

function Timeline({
  data,
  snapshot,
}: {
  readonly data: PatrolData
  readonly snapshot: ReturnType<typeof simulateUntil>
}) {
  const minute = usePatrolStore((state) => state.minute)
  const setMinute = usePatrolStore((state) => state.setMinute)
  const playing = usePatrolStore((state) => state.playing)
  const setPlaying = usePatrolStore((state) => state.setPlaying)
  const speed = usePatrolStore((state) => state.speed)
  const setSpeed = usePatrolStore((state) => state.setSpeed)
  return (
    <div className="flex h-full items-center gap-3 px-5">
      <button
        type="button"
        className="timeline-play"
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? 'Pause replay' : 'Play replay'}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <span className="w-12 font-mono text-xs text-[--gold-400]">{formatClock(minute)}</span>
      <input
        aria-label="Simulation minute"
        type="range"
        min={0}
        max={data.scenario.time_window.shift_minutes}
        value={minute}
        onChange={(event) => setMinute(Number(event.target.value))}
        className="patrol-range min-w-0 flex-1"
      />
      <div className="hidden items-center gap-3 text-[10px] text-[--txt-3] xl:flex">
        <span>{snapshot.active} active</span>
        <span>{snapshot.completed} complete</span>
        <span className={snapshot.missed ? 'text-[--critical]' : ''}>{snapshot.missed} missed</span>
      </div>
      <div className="flex gap-1">
        {speeds.map((candidate) => (
          <button
            type="button"
            key={candidate}
            onClick={() => setSpeed(candidate)}
            className="speed-button"
            data-active={speed === candidate}
          >
            {candidate}×
          </button>
        ))}
      </div>
    </div>
  )
}

function CompareCard({
  baseline,
  yours,
  optimized,
  onClose,
  onGhost,
}: {
  readonly baseline: ScoreBreakdown
  readonly yours: ScoreBreakdown
  readonly optimized: ScoreBreakdown
  readonly onClose: () => void
  readonly onGhost: () => void
}) {
  const plans = [
    ['Baseline', baseline],
    ['Yours', yours],
    ['Optimized', optimized],
  ] as const
  return (
    <motion.div
      className="end-card"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="end-card-inner"
        initial={{ y: 24, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
      >
        <button type="button" className="end-close" onClick={onClose} aria-label="Close comparison">
          <X size={18} />
        </button>
        <p className="type-micro text-[--gold-400]">SHIFT COMPLETE · THREE-WAY COMPARE</p>
        <div className="mt-6 flex items-end gap-6">
          <strong className="font-mono text-7xl" style={{ color: gradeColour(yours.total) }}>{yours.total}</strong>
          <div className="pb-2">
            <h2 className="text-2xl font-semibold">{yours.grade}</h2>
            <p className="mt-1 text-sm text-[--txt-2]">Your deployment replay score</p>
          </div>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {plans.map(([label, plan], index) => (
            <motion.div
              key={label}
              className="compare-bar-card"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.12 }}
            >
              <div className="flex items-center justify-between">
                <span className="type-micro text-[--txt-3]">{label}</span>
                <strong className="font-mono text-xl">{plan.total}</strong>
              </div>
              <div className="mt-4 flex h-32 items-end rounded-[--r-sm] bg-[--ink-900] px-4">
                <div
                  className="w-full rounded-t-[--r-sm]"
                  style={{
                    height: `${Math.max(8, plan.total / 10)}%`,
                    backgroundColor: index === 2 ? 'var(--prov-generated)' : index === 1 ? 'var(--gold-400)' : 'var(--ink-500)',
                  }}
                />
              </div>
              <p className="mt-3 text-xs text-[--txt-2]">
                {(plan.coverageRatio * 100).toFixed(1)}% coverage · {plan.p50Minutes.toFixed(1)} min typical response
              </p>
            </motion.div>
          ))}
        </div>
        <div className="mt-6 grid gap-3 border-t border-[--ink-600] pt-5 text-sm text-[--txt-2] md:grid-cols-2">
          <p><LocateFixed className="mr-2 inline text-[--cyan-400]" size={16} />Road-time coverage left {(100 - yours.coverageRatio * 100).toFixed(1)}% of expected workload outside the target.</p>
          <p><Gauge className="mr-2 inline text-[--gold-400]" size={16} />Coverage balance was {yours.equity.toFixed(2)}; the suggested plan reached {optimized.equity.toFixed(2)}.</p>
        </div>
        <div className="mt-7 flex flex-wrap gap-3">
          <button type="button" className="end-primary" onClick={onGhost}><Sparkles size={15} /> View suggested positions</button>
          <button type="button" className="end-secondary" onClick={onClose}>Try another plan</button>
          <button type="button" className="end-secondary" onClick={() => window.print()}>Export duty roster</button>
        </div>
      </motion.div>
    </motion.div>
  )
}

export function PatrolLab() {
  const data = usePatrolStore((state) => state.data)
  const setData = usePatrolStore((state) => state.setData)
  const deployment = usePatrolStore((state) => state.deployment)
  const targetMinutes = usePatrolStore((state) => state.targetMinutes)
  const requiredReserve = usePatrolStore((state) => state.requiredReserve)
  const rain = usePatrolStore((state) => state.rain)
  const roadClosure = usePatrolStore((state) => state.roadClosure)
  const minute = usePatrolStore((state) => state.minute)
  const setMinute = usePatrolStore((state) => state.setMinute)
  const playing = usePatrolStore((state) => state.playing)
  const setPlaying = usePatrolStore((state) => state.setPlaying)
  const speed = usePatrolStore((state) => state.speed)
  const optimized = usePatrolStore((state) => state.optimized)
  const setOptimized = usePatrolStore((state) => state.setOptimized)
  const setShowGhost = usePatrolStore((state) => state.setShowGhost)
  const [error, setError] = useState<string | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [injectionOpen, setInjectionOpen] = useState(false)
  const [injectionSeconds, setInjectionSeconds] = useState(10)
  const [injectionIndex, setInjectionIndex] = useState(0)
  const [dispatched, setDispatched] = useState<string | null>(null)
  // Each injection fires once. Index-keyed rather than a single flag, because
  // the shift now carries two and a shared flag would swallow the second.
  const injectionsShown = useRef(new Set<string>())
  const injection = data?.scenario.injections[injectionIndex]

  useEffect(() => {
    void loadPatrolData().then(setData).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Unable to load Patrol Lab data')
    })
  }, [setData])

  useEffect(() => {
    if (!playing || !data) return
    const timer = window.setInterval(() => {
      const next = Math.min(data.scenario.time_window.shift_minutes, minute + speed / 4)
      setMinute(next)
      if (next >= data.scenario.time_window.shift_minutes) {
        setPlaying(false)
        setCompareOpen(true)
      }
    }, 250)
    return () => window.clearInterval(timer)
  }, [data, minute, playing, setMinute, setPlaying, speed])

  useEffect(() => {
    if (!data || !playing) return
    const due = data.scenario.injections.findIndex(
      (entry) => minute >= entry.simulation_minute && !injectionsShown.current.has(entry.injection_id),
    )
    if (due === -1) return
    injectionsShown.current.add(data.scenario.injections[due]!.injection_id)
    setInjectionIndex(due)
    setDispatched(null)
    setPlaying(false)
    setInjectionOpen(true)
  }, [data, minute, playing, setPlaying])

  useEffect(() => {
    if (!injectionOpen) return
    setInjectionSeconds(injection?.decision_seconds ?? 10)
    const timer = window.setInterval(() => {
      setInjectionSeconds((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [injection?.decision_seconds, injectionOpen])

  useEffect(() => {
    if (!injectionOpen || injectionSeconds > 0) return
    // Timing out is a decision too. A closure left undecided applies; an
    // unanswered SOS simply resumes, and the card has already shown what the
    // delay cost.
    if (injection?.type === 'road_closure' && !usePatrolStore.getState().roadClosure) {
      usePatrolStore.getState().toggleClosure()
    }
    setInjectionOpen(false)
    setPlaying(true)
  }, [injection?.type, injectionOpen, injectionSeconds, setPlaying])

  /**
   * Nearest deployed unit to the SOS point, by real road time.
   *
   * This is the whole point of putting an SOS press inside the Patrol Lab
   * rather than on a screen of its own: the answer comes from the same OSRM
   * duration matrix the coverage engine uses, so "4.2 minutes away" is a road
   * network figure, not a straight line.
   */
  const sosResponse = useMemo(() => {
    if (!data || injection?.type !== 'sos_activation') return null
    const target = injection.hex_index
    if (typeof target !== 'number') return null
    // `deployment` maps unit id → hex, with null meaning held in reserve. A
    // reserve unit is deliberately not offered: holding one back is a decision
    // the planner made, and quietly spending it would undo their plan.
    const multiplier =
      (roadClosure ? data.scenario.conditions.road_closure_multiplier : 1) *
      (rain ? data.scenario.conditions.rain_multiplier : 1)
    const candidates = data.scenario.roster
      .map((unit) => ({ unit, hex: deployment[unit.unit_id] }))
      .filter((entry): entry is { unit: PatrolUnit; hex: number } => typeof entry.hex === 'number')
      .map((entry) => ({
        unit: entry.unit,
        seconds: travelSeconds(data, entry.hex, target) * multiplier,
      }))
      .filter((entry) => Number.isFinite(entry.seconds))
      .sort((left, right) => left.seconds - right.seconds)
    const nearest = candidates[0]
    if (!nearest) return null
    return {
      callSign: nearest.unit.call_sign,
      unitType: nearest.unit.unit_type,
      minutes: nearest.seconds / 60,
      seconds: Math.round(nearest.seconds),
      alternatives: candidates.length,
      // The next two. Showing them is what makes "every deployed unit was
      // evaluated" visible rather than asserted — and it shows the margin,
      // which is the part a control room actually argues about.
      runnersUp: candidates.slice(1, 3).map((entry) => ({
        callSign: entry.unit.call_sign,
        minutes: entry.seconds / 60,
      })),
    }
  }, [data, deployment, injection, rain, roadClosure])

  const score = useMemo(
    () =>
      data
        ? scoreDeployment(data, deployment, targetMinutes, requiredReserve, rain, roadClosure)
        : null,
    [data, deployment, rain, requiredReserve, roadClosure, targetMinutes],
  )
  const snapshot = useMemo(
    () =>
      data
        ? simulateUntil(data, deployment, minute, rain, roadClosure)
        : { dispatches: [], missed: 0, completed: 0, active: 0 },
    [data, deployment, minute, rain, roadClosure],
  )

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-[--ink-900] p-8 text-center">
        <div><AlertTriangle className="mx-auto text-[--critical]" /><h1 className="mt-4 text-xl">Patrol fixture unavailable</h1><p className="mt-2 text-[--txt-2]">{error}</p></div>
      </div>
    )
  }
  if (!data || !score) {
    return <div className="grid min-h-screen place-items-center bg-[--ink-900] font-mono text-xs text-[--txt-3]">LOADING VALIDATED ROUTING FIXTURE…</div>
  }

  const baseline = scoreDeployment(
    data,
    baselineDeployment(data, requiredReserve),
    targetMinutes,
    requiredReserve,
    rain,
    roadClosure,
  )
  const optimizedResult =
    optimized ?? optimizeDeployment(data, targetMinutes, requiredReserve)

  return (
    <>
      <OpsShell
        title="Namma Patrol Lab"
        eyebrow="PLAN · DEPLOY"
        context={<ForcePanel data={data} />}
        inspector={<ScorePanel data={data} score={score} snapshot={snapshot} />}
        timeline={<Timeline data={data} snapshot={snapshot} />}
      >
        <PatrolMap
          data={data}
          score={score}
          minute={minute}
          rain={rain}
          roadClosure={roadClosure}
        />
      </OpsShell>
      <AnimatePresence>
        {injectionOpen && injection?.type === 'sos_activation' ? (
          <motion.div className="injection-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div
              className="injection-card"
              initial={{ scale: 0.96 }}
              animate={{ scale: 1 }}
              style={{ borderColor: 'var(--critical)' }}
            >
              <span className="injection-icon" style={{ background: 'color-mix(in srgb, var(--critical) 14%, transparent)', color: 'var(--critical)' }}>
                <Siren />
              </span>
              <div className="flex items-center justify-between">
                <p className="type-micro" style={{ color: 'var(--critical)' }}>
                  SOS POINT ACTIVATED · {injection.local_time}
                </p>
                <span
                  className="rounded-full border px-2 py-1 font-mono text-xs"
                  style={{ borderColor: 'var(--critical)', color: 'var(--critical)' }}
                >
                  {injectionSeconds}s
                </span>
              </div>
              <h2 className="mt-2 text-xl font-semibold">{injection.location}</h2>
              {sosResponse ? (
                <>
                  <p className="mt-3 text-sm leading-6 text-[--txt-2]">
                    Nearest available unit is{' '}
                    <strong className="text-[--txt-hi]">{sosResponse.callSign}</strong> —{' '}
                    <strong className="text-[--txt-hi]">{sosResponse.minutes.toFixed(1)} minutes</strong>{' '}
                    <span className="text-[--txt-3]">({sosResponse.seconds}s)</span> away by road.
                    All {sosResponse.alternatives} deployed units were checked.
                  </p>
                  {sosResponse.runnersUp.length > 0 ? (
                    <div className="mt-2 flex flex-col gap-1">
                      {sosResponse.runnersUp.map((entry) => (
                        <div
                          key={entry.callSign}
                          className="flex items-center justify-between text-xs text-[--txt-3]"
                        >
                          <span className="font-mono">{entry.callSign}</span>
                          <span className="font-mono tabular-nums">
                            {entry.minutes.toFixed(1)} min
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {dispatched ? (
                    <p className="mt-2 text-sm" style={{ color: 'var(--ok)' }}>
                      {dispatched} dispatched. Control room notified.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-3 text-sm leading-6 text-[--txt-2]">
                  No unit is deployed and available. Every unit is held in reserve or off the map.
                </p>
              )}
              <div className="mt-5 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className="end-primary justify-center"
                  disabled={!sosResponse}
                  onClick={() => {
                    if (!sosResponse) return
                    setDispatched(sosResponse.callSign)
                    window.setTimeout(() => {
                      setInjectionOpen(false)
                      setPlaying(true)
                    }, 900)
                  }}
                >
                  Dispatch {sosResponse?.callSign ?? 'nearest'}
                </button>
                <button
                  type="button"
                  className="end-secondary justify-center"
                  onClick={() => setInjectionOpen(false)}
                >
                  Hold and redeploy
                </button>
              </div>
              {/* The press is invented; the travel time is not. */}
              <p className="mt-4 text-[10px] leading-4 text-[--txt-3]">
                SOS points and this activation are generated for the demonstration — the archive holds
                no device inventory or control-room log. The response time is calculated from the
                road network and the unit&apos;s current post.
              </p>
            </motion.div>
          </motion.div>
        ) : null}
        {injectionOpen && injection?.type !== 'sos_activation' ? (
          <motion.div className="injection-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="injection-card" initial={{ scale: 0.96 }} animate={{ scale: 1 }}>
              <span className="injection-icon"><TrafficCone /></span>
              <div className="flex items-center justify-between">
                <p className="type-micro text-[--warn]">DEMO EVENT · {injection?.local_time ?? '23:00'}</p>
                <span className="rounded-full border border-[--warn] px-2 py-1 font-mono text-xs text-[--warn]">
                  {injectionSeconds}s
                </span>
              </div>
              <h2 className="mt-2 text-xl font-semibold">{injection?.title ?? 'Old Madras Road closure'}</h2>
              <p className="mt-3 text-sm leading-6 text-[--txt-2]">
                A scripted carriageway closure at {injection?.location ?? 'Old Madras Road / ORR approach'} applies the declared ×{data.scenario.conditions.road_closure_multiplier} duration multiplier. Rebalance posts now or accept the constraint.
              </p>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className="end-primary justify-center"
                  onClick={() => {
                    if (!roadClosure) usePatrolStore.getState().toggleClosure()
                    setInjectionOpen(false)
                    setPlaying(true)
                  }}
                >
                  Apply closure
                </button>
                <button
                  type="button"
                  className="end-secondary justify-center"
                  onClick={() => setInjectionOpen(false)}
                >
                  Pause and redeploy
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
        {compareOpen ? (
          <CompareCard
            baseline={baseline}
            yours={score}
            optimized={optimizedResult.score}
            onClose={() => setCompareOpen(false)}
            onGhost={() => {
              setOptimized(optimizedResult)
              setShowGhost(true)
              setCompareOpen(false)
            }}
          />
        ) : null}
      </AnimatePresence>
    </>
  )
}
