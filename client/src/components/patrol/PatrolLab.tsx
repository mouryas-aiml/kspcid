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
  TrafficCone,
  UserRound,
  X,
} from 'lucide-react'
import { cellToBoundary } from 'h3-js'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Panel } from '@/components/primitives/Panel'
import { ProvenanceChip } from '@/components/primitives/ProvenanceChip'
import { OpsShell } from '@/components/shell/OpsShell'
import { baselineDeployment, optimizeDeployment } from '@/lib/patrol/optimizer'
import { isCovered, loadPatrolData, unionCoverage } from '@/lib/patrol/routing'
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
  const reset = usePatrolStore((state) => state.reset)
  const setOptimized = usePatrolStore((state) => state.setOptimized)

  const groups = data.scenario.roster.reduce<Record<string, PatrolUnit[]>>((result, unit) => {
    ;(result[unit.unit_type] ??= []).push(unit)
    return result
  }, {})

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between">
          <p className="type-micro text-[--txt-3]">Generated force</p>
          <span className="rounded-full bg-[color-mix(in_srgb,var(--prov-generated)_14%,transparent)] px-2 py-1 text-[10px] text-[--prov-generated]">
            DEMO · 16
          </span>
        </div>
        <p className="mt-2 text-xs leading-5 text-[--txt-2]">
          Select a unit, then choose a hex. Hold units in reserve with the post toggle.
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
          <CloudRain size={14} /> Rain ×1.35
        </button>
        <button
          type="button"
          data-active={roadClosure}
          onClick={toggleClosure}
          className="condition-button"
        >
          <TrafficCone size={14} /> Closure
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="rounded-[--r-sm] bg-[--gold-500] px-3 py-2 text-xs font-semibold text-[--ink-900]"
          onClick={() => setOptimized(optimizeDeployment(data, targetMinutes, requiredReserve))}
        >
          Optimize
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

interface Projection {
  readonly point: (cell: RoutingCell) => readonly [number, number]
  readonly path: (cell: RoutingCell) => string
}

function useProjection(data: PatrolData): Projection {
  return useMemo(() => {
    const lats = data.hexIndex.cells.map((cell) => cell.latitude)
    const lons = data.hexIndex.cells.map((cell) => cell.longitude)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLon = Math.min(...lons)
    const maxLon = Math.max(...lons)
    const x = (lon: number) => 40 + ((lon - minLon) / (maxLon - minLon)) * 920
    const y = (lat: number) => 660 - ((lat - minLat) / (maxLat - minLat)) * 620
    return {
      point: (cell) => [x(cell.longitude), y(cell.latitude)] as const,
      path: (cell) =>
        cellToBoundary(cell.h3)
          .map(([lat, lon], index) => `${index === 0 ? 'M' : 'L'}${x(lon).toFixed(2)},${y(lat).toFixed(2)}`)
          .join(' ') + ' Z',
    }
  }, [data])
}

function PatrolMap({
  data,
  score,
  minute,
  rain,
  roadClosure,
}: {
  readonly data: PatrolData
  readonly score: ScoreBreakdown
  readonly minute: number
  readonly rain: boolean
  readonly roadClosure: boolean
}) {
  const deployment = usePatrolStore((state) => state.deployment)
  const selectedUnit = usePatrolStore((state) => state.selectedUnit)
  const selectUnit = usePatrolStore((state) => state.selectUnit)
  const deploySelected = usePatrolStore((state) => state.deploySelected)
  const targetMinutes = usePatrolStore((state) => state.targetMinutes)
  const showGhost = usePatrolStore((state) => state.showGhost)
  const optimized = usePatrolStore((state) => state.optimized)
  const reduce = useReducedMotion()
  const projection = useProjection(data)
  const demand = useMemo(
    () =>
      new Map(
        data.scenario.demand_model.demand.map((cell) => [
          cell.hex_index,
          cell.recency_weighted_demand,
        ]),
      ),
    [data],
  )
  const maxDemand = Math.max(...demand.values())
  const selectedBudget = data.region.response_budgets_seconds.indexOf(targetMinutes * 60)
  const coverage = useMemo(
    () => unionCoverage(data, deployment, Math.max(0, selectedBudget)),
    [data, deployment, selectedBudget],
  )
  const snapshot = useMemo(
    () => simulateUntil(data, deployment, minute, rain, roadClosure),
    [data, deployment, minute, rain, roadClosure],
  )
  const recentDispatches = snapshot.dispatches.filter(
    (dispatch) => minute - dispatch.event.simulation_minute < 22,
  )
  const committedUnits = new Set(
    snapshot.dispatches
      .filter((dispatch) => ['enroute', 'on_scene', 'returning'].includes(dispatch.result))
      .flatMap((dispatch) => dispatch.unitId ?? []),
  )

  return (
    <div className="relative h-full overflow-hidden bg-[--ink-900]">
      <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgb(56_189_248_/_0.08)_1px,transparent_1px),linear-gradient(90deg,rgb(56_189_248_/_0.08)_1px,transparent_1px)] [background-size:40px_40px]" />
      <svg
        className="absolute inset-0 h-full w-full touch-none"
        viewBox="0 0 1000 700"
        role="img"
        aria-label="H3 demand surface, road-time coverage, and generated patrol posts"
      >
        <g>
          {data.hexIndex.cells.map((cell) => {
            const value = demand.get(cell.index) ?? 0
            const intensity = maxDemand > 0 ? value / maxDemand : 0
            const colour = magma[Math.min(magma.length - 1, Math.floor(intensity * magma.length))]
            return (
              <path
                key={cell.h3}
                d={projection.path(cell)}
                fill={value > 0 ? colour : '#10161F'}
                fillOpacity={value > 0 ? 0.5 + intensity * 0.42 : 0.12}
                stroke={isCovered(coverage, cell.index) ? '#2DD4BF' : '#2B3849'}
                strokeOpacity={isCovered(coverage, cell.index) ? 0.56 : 0.25}
                strokeWidth={isCovered(coverage, cell.index) ? 1.2 : 0.42}
                onPointerUp={() => deploySelected(cell.index)}
                className={selectedUnit ? 'cursor-crosshair' : ''}
              >
                <title>
                  H3 {cell.h3} · weighted demand {value.toFixed(2)}
                  {isCovered(coverage, cell.index) ? ' · inside road-time blanket' : ''}
                </title>
              </path>
            )
          })}
        </g>
        {showGhost && optimized ? (
          <g aria-label="Optimized position ghost overlay">
            {Object.entries(optimized.deployment).map(([unitId, hexIndex]) => {
              if (hexIndex === null) return null
              const cell = data.hexIndex.cells[hexIndex]
              if (!cell) return null
              const [x, y] = projection.point(cell)
              return (
                <circle
                  key={unitId}
                  cx={x}
                  cy={y}
                  r={13}
                  fill="none"
                  stroke="#A78BFA"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  opacity={0.65}
                />
              )
            })}
          </g>
        ) : null}
        <g aria-label="Historical replay events aggregated to H3 cells">
          {recentDispatches.map((dispatch) => {
            const cell = data.hexIndex.cells[dispatch.event.hex_index]
            if (!cell) return null
            const [x, y] = projection.point(cell)
            const missed = dispatch.result === 'missed'
            return (
              <g key={dispatch.event.incident_id}>
                {!reduce ? (
                  <circle cx={x} cy={y} r={16} fill="none" stroke={missed ? '#F04438' : '#FFC53D'} opacity=".3">
                    <animate attributeName="r" values="5;22" dur="1.2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values=".7;0" dur="1.2s" repeatCount="indefinite" />
                  </circle>
                ) : null}
                <circle cx={x} cy={y} r={4.5} fill={missed ? '#F04438' : '#FFC53D'} />
              </g>
            )
          })}
        </g>
        <g aria-label="Generated demonstration patrol units">
          {data.scenario.roster.map((unit) => {
            const hexIndex = deployment[unit.unit_id]
            if (hexIndex === null || hexIndex === undefined) return null
            const cell = data.hexIndex.cells[hexIndex]
            if (!cell) return null
            const [x, y] = projection.point(cell)
            const colour = unitColour[unit.unit_type] ?? '#F8FAFC'
            const committed = committedUnits.has(unit.unit_id)
            return (
              <motion.g
                key={unit.unit_id}
                transform={`translate(${x} ${y})`}
                role="button"
                tabIndex={0}
                aria-label={`Select ${unit.call_sign}`}
                onPointerDown={() => selectUnit(unit.unit_id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') selectUnit(unit.unit_id)
                }}
                animate={{
                  scale: selectedUnit === unit.unit_id ? 1.18 : 1,
                  opacity: committed ? 0.55 : 1,
                }}
                className="cursor-grab"
              >
                <path
                  d="M0,-13 L11,-6.5 L11,6.5 L0,13 L-11,6.5 L-11,-6.5 Z"
                  fill="#10161F"
                  stroke={colour}
                  strokeWidth={selectedUnit === unit.unit_id ? 3 : 2}
                />
                <text x="0" y="3.5" textAnchor="middle" fill={colour} fontSize="8" fontWeight="700">
                  {unit.unit_id.slice(-2)}
                </text>
                {committed ? <circle cx="9" cy="-9" r="3.5" fill="#FFC53D" /> : null}
              </motion.g>
            )
          })}
        </g>
      </svg>
      <div className="absolute left-4 top-4 flex flex-wrap items-center gap-2">
        <span className="map-badge"><MapPinned size={13} /> H3 r9 demand</span>
        <span className="map-badge text-[--teal-400]"><Route size={13} /> {targetMinutes}m road-time blanket</span>
        {selectedUnit ? <span className="map-badge text-[--gold-400]">Choose a destination hex</span> : null}
      </div>
      <div className="absolute bottom-4 left-4 max-w-[420px] rounded-[--r-sm] border border-[--ink-500] bg-[rgb(10_15_22_/_0.92)] px-3 py-2 text-[10px] text-[--txt-2]">
        Replay marks are H3 aggregates. Coordinates inferred from text are never rendered as precise pins.
      </div>
      <div className="absolute right-4 top-4 rounded-[--r-md] border border-[--ink-500] bg-[rgb(10_15_22_/_0.92)] px-3 py-2 shadow-xl">
        <span className="type-micro text-[--txt-3]">LIVE PLAN</span>
        <strong className="ml-3 font-mono text-xl" style={{ color: gradeColour(score.total) }}>
          {score.total}
        </strong>
      </div>
    </div>
  )
}

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
  const metrics = [
    ['Coverage', `${(score.coverageRatio * 100).toFixed(1)}%`, score.coveragePoints, 400],
    ['Response p50', `${score.p50Minutes.toFixed(1)}m`, score.responsePoints, 250],
    ['Equity', score.equity.toFixed(2), score.equityPoints, 150],
    ['Reserve', String(score.reserveCount), score.reservePoints, 100],
    ['Efficiency', `${score.totalUnitKm.toFixed(1)} km`, score.efficiencyPoints, 100],
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
      <div className="space-y-3">
        {metrics.map(([label, value, points, maximum]) => (
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
            <p className="mt-1 text-right font-mono text-[9px] text-[--txt-3]">
              {points.toFixed(1)} / {maximum}
            </p>
          </div>
        ))}
      </div>
      <Panel title="Published formula" eyebrow="EXPLAINABLE SCORE">
        <p className="font-mono text-[10px] leading-5 text-[--txt-2]">
          400·coverage + response(150 p50 + 100 p90) + 150·(1−Gini) + 100·reserve + 100·efficiency
        </p>
        <p className="mt-3 border-t border-[--ink-600] pt-3 text-xs leading-5 text-[--txt-3]">
          Counterfactual incident reduction is explicitly outside this score. It measures resource reach and replay performance only.
        </p>
      </Panel>
      <ProvenanceChip
        provenance={provenance}
        derivation="Observed FIR-mirror records are aggregated to H3 r9 and recency weighted with a 365.25-day half-life. Coverage and response use validated OSRM road-network durations; roster identities are generated demonstration inputs."
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
        <Panel title="Heuristic ready" eyebrow={`${optimized.elapsedMs.toFixed(1)} MS`}>
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
                {(plan.coverageRatio * 100).toFixed(1)}% coverage · {plan.p50Minutes.toFixed(1)}m p50
              </p>
            </motion.div>
          ))}
        </div>
        <div className="mt-6 grid gap-3 border-t border-[--ink-600] pt-5 text-sm text-[--txt-2] md:grid-cols-2">
          <p><LocateFixed className="mr-2 inline text-[--cyan-400]" size={16} />Road-time coverage left {(100 - yours.coverageRatio * 100).toFixed(1)}% of weighted demand outside target.</p>
          <p><Gauge className="mr-2 inline text-[--gold-400]" size={16} />Beat coverage balance was {yours.equity.toFixed(2)}; optimizer reached {optimized.equity.toFixed(2)}.</p>
        </div>
        <div className="mt-7 flex flex-wrap gap-3">
          <button type="button" className="end-primary" onClick={onGhost}><Sparkles size={15} /> View optimized ghosts</button>
          <button type="button" className="end-secondary" onClick={onClose}>Retry deployment</button>
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
  const injectionShown = useRef(false)

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
    if (minute >= 180 && !injectionShown.current && playing) {
      injectionShown.current = true
      setPlaying(false)
      setInjectionOpen(true)
    }
  }, [minute, playing, setPlaying])

  useEffect(() => {
    if (!injectionOpen) return
    setInjectionSeconds(10)
    const timer = window.setInterval(() => {
      setInjectionSeconds((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [injectionOpen])

  useEffect(() => {
    if (!injectionOpen || injectionSeconds > 0) return
    if (!usePatrolStore.getState().roadClosure) usePatrolStore.getState().toggleClosure()
    setInjectionOpen(false)
    setPlaying(true)
  }, [injectionOpen, injectionSeconds, setPlaying])

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
        {injectionOpen ? (
          <motion.div className="injection-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="injection-card" initial={{ scale: 0.96 }} animate={{ scale: 1 }}>
              <span className="injection-icon"><TrafficCone /></span>
              <div className="flex items-center justify-between">
                <p className="type-micro text-[--warn]">SCRIPTED INJECTION · 23:00</p>
                <span className="rounded-full border border-[--warn] px-2 py-1 font-mono text-xs text-[--warn]">
                  {injectionSeconds}s
                </span>
              </div>
              <h2 className="mt-2 text-xl font-semibold">Old Madras Road closure</h2>
              <p className="mt-3 text-sm leading-6 text-[--txt-2]">
                A scripted carriageway closure increases matrix travel penalties for this demonstration. Rebalance posts now or accept the constraint.
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
