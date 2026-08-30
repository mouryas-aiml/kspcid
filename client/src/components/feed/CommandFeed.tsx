'use client'

import {
  Activity,
  AlertTriangle,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  Eye,
  Filter,
  MapPin,
  Pause,
  Play,
  Radar,
  Route,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react'
import { Map as MapLibreMap, Marker } from 'maplibre-gl'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Panel } from '@/components/primitives/Panel'
import { ProvenanceChip } from '@/components/primitives/ProvenanceChip'
import { Sparkline } from '@/components/primitives/Sparkline'
import { BLR_CENTER, INITIAL_VIEW_STATE } from '@/lib/geo'
import { buildBasemapStyle, registerPmtilesProtocol } from '@/lib/map/basemap'
import { dur } from '@/lib/motion'
import 'maplibre-gl/dist/maplibre-gl.css'
import { fetchPublicArtifact } from '@/lib/publicPath'
import { OpsShell } from '@/components/shell/OpsShell'
import type { Provenance } from '@/lib/provenance'

type AlertStatus = 'new' | 'acknowledged' | 'acting' | 'dismissed'
type Severity = 'critical' | 'high' | 'watch'

interface FeedAlert {
  readonly id: string
  readonly type: 'category_spike'
  readonly title: string
  readonly station_code: string | null
  readonly station_name: string
  readonly police_division: string | null
  readonly week_start: string
  readonly observed_count: number
  readonly expected_count: number
  readonly ucl_99: number
  readonly z_score: number
  readonly display_z_score: string
  readonly severity_weight: number
  readonly rank_score: number
  readonly severity: Severity
  readonly history_13_weeks: readonly number[]
  readonly geography: {
    readonly latitude: number
    readonly longitude: number
    readonly coordinate_records: number
    readonly method: string
  } | null
  readonly replay_offset_ms: number
  readonly provenance: Provenance
}

interface FeedFixture {
  readonly snapshot_through: string
  readonly replay_duration_ms: number
  readonly detector: {
    readonly condition: string
    readonly ranking: string
    readonly candidate_window: string
  }
  readonly alerts: readonly FeedAlert[]
}

const severityStyle: Record<Severity, { color: string; background: string }> = {
  critical: { color: 'var(--critical)', background: 'rgb(240 68 56 / .09)' },
  high: { color: 'var(--warn)', background: 'rgb(247 144 9 / .08)' },
  watch: { color: 'var(--cyan-400)', background: 'rgb(56 189 248 / .07)' },
}

function queryFor(alert: FeedAlert): string {
  return new URLSearchParams({
    station: alert.station_code ?? alert.station_name,
    crime_head: alert.title,
    week: alert.week_start,
    alert: alert.id,
  }).toString()
}

function FeedCard({
  alert,
  active,
  status,
  onSelect,
}: {
  readonly alert: FeedAlert
  readonly active: boolean
  readonly status: AlertStatus
  readonly onSelect: () => void
}) {
  const style = severityStyle[alert.severity]
  return (
    <button
      className="w-full border-b border-[--ink-600] p-4 text-left transition-colors hover:bg-[--ink-700]"
      data-active={active}
      onClick={onSelect}
      style={active ? { background: style.background, boxShadow: `inset 3px 0 ${style.color}` } : undefined}
      type="button"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="type-micro" style={{ color: style.color }}>Category spike</span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-[--txt-3]">
          {status !== 'new' ? <Check size={11} className="text-[--ok]" /> : null}
          {alert.display_z_score}
        </span>
      </span>
      <strong className="mt-2 block line-clamp-2 text-sm leading-5 text-[--txt-hi]">{alert.title}</strong>
      <span className="mt-1 block truncate text-xs text-[--txt-2]">{alert.station_name}</span>
      <span className="mt-3 flex items-center justify-between text-[10px] text-[--txt-3]">
        <span>{alert.week_start}</span>
        <span>{alert.observed_count} observed · UCL {alert.ucl_99}</span>
      </span>
    </button>
  )
}

/**
 * The Command Feed's map surface.
 *
 * This was the product's third geographic renderer, and the only one whose
 * projection was simply wrong: it placed DOM markers at
 * `((lon - 77.45) / 0.4)` × `((13.2 - lat) / 0.45)`, a bounding box that is
 * neither the OSRM extract nor the PMTiles archive, linearly stretched. Two
 * alerts a kilometre apart could land in the wrong order relative to each other.
 *
 * Now the same self-hosted basemap as every other surface (§3.4), with the
 * alert markers as MapLibre `Marker`s. Markers rather than a deck.gl layer
 * deliberately: there are 26 of them, they are buttons with hover, focus and
 * selection states, and a DOM element keeps the keyboard path and the styling
 * that a WebGL layer would have to reinvent.
 */
function MapCanvas({
  alerts,
  selected,
  onSelect,
}: {
  readonly alerts: readonly FeedAlert[]
  readonly selected: FeedAlert
  readonly onSelect: (alert: FeedAlert) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Marker[]>([])
  const [ready, setReady] = useState(false)
  const mappable = useMemo(() => alerts.filter((alert) => alert.geography), [alerts])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    registerPmtilesProtocol()
    const map = new MapLibreMap({
      container,
      style: buildBasemapStyle(),
      center: BLR_CENTER,
      zoom: INITIAL_VIEW_STATE.zoom,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    setReady(true)
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container)
    requestAnimationFrame(() => map.resize())
    return () => {
      observer.disconnect()
      mapRef.current = null
      map.remove()
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    for (const marker of markersRef.current) marker.remove()
    markersRef.current = mappable.map((alert) => {
      const geography = alert.geography!
      const style = severityStyle[alert.severity]
      const active = alert.id === selected.id
      const size = active ? 58 : 22 + Math.min(22, alert.observed_count)
      const element = document.createElement('button')
      element.type = 'button'
      element.className = 'grid place-items-center rounded-full transition-all duration-500'
      element.setAttribute('aria-label', `${alert.station_name}: ${alert.title}`)
      element.title = `${alert.station_name} · ${alert.observed_count} observed`
      Object.assign(element.style, {
        width: `${size}px`,
        height: `${size}px`,
        border: `1px solid ${style.color}`,
        background: style.background,
        boxShadow: active ? `0 0 0 10px ${style.background}, 0 0 34px ${style.color}` : '',
        zIndex: active ? '4' : '2',
        cursor: 'pointer',
      })
      const dot = document.createElement('span')
      Object.assign(dot.style, {
        width: '6px',
        height: '6px',
        borderRadius: '9999px',
        background: style.color,
      })
      element.append(dot)
      element.addEventListener('click', () => onSelect(alert))
      return new Marker({ element }).setLngLat([geography.longitude, geography.latitude]).addTo(map)
    })
    return () => {
      for (const marker of markersRef.current) marker.remove()
      markersRef.current = []
    }
  }, [mappable, onSelect, ready, selected.id])

  // Selecting from the list moves the camera, so the two halves stay in step.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selected.geography) return
    map.flyTo({
      center: [selected.geography.longitude, selected.geography.latitude],
      zoom: Math.max(map.getZoom(), 11.5),
      duration: dur.fly * 1000,
      essential: true,
    })
  }, [selected.geography, selected.id])

  return (
    <div className="relative h-full overflow-hidden bg-[--ink-900]">
      {/* maplibre-gl.css forces position:relative on its container. */}
      <div className="h-full w-full" ref={containerRef} />
      <div className="pointer-events-none absolute left-5 top-5 z-10 flex items-center gap-2 rounded-[--r-sm] border border-[--ink-500] bg-[rgb(10_15_22_/_0.94)] px-3 py-2 text-[10px] tabular-nums text-[--txt-2]">
        <Radar size={14} className="text-[--cyan-400]" />
        Alerts with a verified station location · {mappable.length}/{alerts.length}
      </div>
      <div className="absolute bottom-5 left-5 z-10 max-w-sm rounded-[--r-md] border border-[--ink-500] bg-[rgb(10_15_22_/_0.96)] p-4">
        <p className="type-micro text-[--gold-400]">{selected.geography ? 'Selected station location' : 'Station location unavailable'}</p>
        <p className="mt-2 text-base font-semibold">{selected.station_name}</p>
        <p className="mt-1 text-xs leading-5 text-[--txt-2]">{selected.title}</p>
        {selected.geography ? (
          <p className="mt-3 flex items-center gap-2 text-[10px] tabular-nums text-[--txt-3]">
            <MapPin size={12} /> Based on {selected.geography.coordinate_records.toLocaleString('en-IN')} records with a reported map location
          </p>
        ) : (
          <p className="mt-3 text-[10px] text-[--warn]">This alert remains in the list, but the map does not guess its location.</p>
        )}
      </div>
    </div>
  )
}

export function CommandFeed() {
  const [fixture, setFixture] = useState<FeedFixture | null>(null)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [severity, setSeverity] = useState<'all' | Severity>('all')
  const [search, setSearch] = useState('')
  const [statuses, setStatuses] = useState<Record<string, AlertStatus>>({})
  const [replaying, setReplaying] = useState(false)
  const [replayElapsed, setReplayElapsed] = useState(60_000)

  useEffect(() => {
    fetchPublicArtifact('/data/scenarios/command_feed.json')
      .then((response) => {
        if (!response.ok) throw new Error(`Feed snapshot request failed (${response.status})`)
        return response.json() as Promise<FeedFixture>
      })
      .then((data) => {
        setFixture(data)
        setSelectedId(data.alerts[0]?.id ?? '')
        setReplayElapsed(data.replay_duration_ms)
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Feed snapshot unavailable'))
  }, [])

  useEffect(() => {
    if (!replaying || !fixture) return
    const started = performance.now() - replayElapsed
    const timer = window.setInterval(() => {
      const elapsed = Math.min(fixture.replay_duration_ms, performance.now() - started)
      setReplayElapsed(elapsed)
      if (elapsed >= fixture.replay_duration_ms) setReplaying(false)
    }, 100)
    return () => window.clearInterval(timer)
  }, [fixture, replayElapsed, replaying])

  const visibleAlerts = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    return (fixture?.alerts ?? []).filter(
      (alert) =>
        alert.replay_offset_ms <= replayElapsed &&
        (severity === 'all' || alert.severity === severity) &&
        (!normalizedSearch ||
          alert.title.toLowerCase().includes(normalizedSearch) ||
          alert.station_name.toLowerCase().includes(normalizedSearch)),
    )
  }, [fixture, replayElapsed, search, severity])
  const selected =
    fixture?.alerts.find((alert) => alert.id === selectedId) ??
    visibleAlerts[0] ??
    fixture?.alerts[0]

  function setStatus(status: AlertStatus) {
    if (!selected) return
    setStatuses((current) => ({ ...current, [selected.id]: status }))
  }

  function startReplay() {
    setReplayElapsed(0)
    setReplaying(true)
    setSelectedId(fixture?.alerts[0]?.id ?? '')
  }

  if (error) {
    return (
      <OpsShell title="Command Feed" eyebrow="DETECT" context={<p className="text-sm text-[--critical]">{error}</p>} inspector={<p className="text-sm text-[--txt-2]">No claims rendered without the snapshot.</p>}>
        <div className="grid h-full place-items-center bg-[--ink-900] text-center">
          <div><ShieldAlert className="mx-auto text-[--critical]" /><p className="mt-3">Feed unavailable</p><p className="mt-1 text-xs text-[--txt-3]">Graceful degradation active</p></div>
        </div>
      </OpsShell>
    )
  }
  if (!fixture || !selected) {
    return <div className="grid h-screen place-items-center bg-[--ink-900] text-[--txt-2]">Loading audited feed snapshot…</div>
  }

  const status = statuses[selected.id] ?? 'new'
  const query = queryFor(selected)
  const progress = (replayElapsed / fixture.replay_duration_ms) * 100
  return (
    <OpsShell
      eyebrow="DETECT"
      inspector={
        <div className="space-y-4">
          <ProvenanceChip
            provenance={selected.provenance}
            derivation="Complete-window weekly count compared with its historical 99% control limit. It fires only when count ≥5 and count exceeds UCL."
          />
          <Panel title={selected.title} eyebrow="CATEGORY SPIKE">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-[--txt-2]">{selected.station_name}</p>
                <p className="mt-1 text-xs text-[--txt-3]">{selected.police_division ?? 'Division unavailable'} · week {selected.week_start}</p>
              </div>
              <span className="rounded-[--r-full] border px-2 py-1 font-mono text-[10px]" style={{ borderColor: severityStyle[selected.severity].color, color: severityStyle[selected.severity].color }}>
                {selected.display_z_score} {selected.severity}
              </span>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2 border-y border-[--ink-600] py-4 text-center">
              <div><p className="font-mono text-xl font-semibold text-[--txt-hi]">{selected.observed_count}</p><p className="type-micro mt-1 text-[--txt-3]">Observed</p></div>
              <div><p className="font-mono text-xl font-semibold text-[--txt-hi]">{selected.expected_count}</p><p className="type-micro mt-1 text-[--txt-3]">Expected</p></div>
              <div><p className="font-mono text-xl font-semibold text-[--warn]">{selected.ucl_99}</p><p className="type-micro mt-1 text-[--txt-3]">99% UCL</p></div>
            </div>
            <div className="mt-4">
              <Sparkline
                expected={selected.expected_count}
                label={`${selected.station_name}, ${selected.title}: 13 observed weeks against the expected count and the 99% upper control limit`}
                ucl={selected.ucl_99}
                values={selected.history_13_weeks}
              />
              {/* §5.7 — the band is the whole claim, so it is labelled. */}
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] tabular-nums text-[--txt-3]">
                <span>13 observed weeks · current week marked</span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-px w-3 bg-[--txt-3]" /> expected {selected.expected_count}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-px w-3 border-t border-dashed border-[--warn]" /> 99% UCL {selected.ucl_99}
                </span>
              </p>
              {/*
                A "20+σ" badge against a zero baseline is not a rate excursion,
                and a reader who is not told that will read it as one. Every
                alert in the shipped snapshot has expected 0 and UCL 0 — the
                detector is surfacing categories with no 13-week history, which
                is a different and weaker claim than an unusual rate.
              */}
              {selected.ucl_99 <= selected.expected_count ? (
                <p className="mt-2 border-l-2 border-[--warn] pl-2 text-[10px] leading-4 text-[--txt-2]">
                  No control band: the 13-week baseline for this category is zero, so the
                  expected count and the 99% limit are both 0. This is a first-occurrence
                  signal, not an excursion above a fitted rate.
                </p>
              ) : null}
            </div>
          </Panel>
          <Panel title="Open in workflow" eyebrow="DEMO SPINE">
            <div className="grid gap-2">
              <Link className="flex items-center justify-between rounded-[--r-sm] border border-[--ink-500] px-3 py-2 text-xs hover:bg-[--ink-700]" href={`/map/?${query}&explain=1`}>
                <span className="flex items-center gap-2"><Eye size={14} className="text-[--cyan-400]" /> Explain</span><ChevronRight size={14} />
              </Link>
              <Link className="flex items-center justify-between rounded-[--r-sm] border border-[--ink-500] px-3 py-2 text-xs hover:bg-[--ink-700]" href={`/similarity/?${query}`}>
                <span className="flex items-center gap-2"><Search size={14} className="text-[--teal-400]" /> Similar cases</span><ChevronRight size={14} />
              </Link>
              <Link className="flex items-center justify-between rounded-[--r-sm] border border-[--gold-500] bg-[rgb(240_168_0_/_0.08)] px-3 py-2 text-xs text-[--gold-400]" href={`/patrol/?${query}`}>
                <span className="flex items-center gap-2"><Route size={14} /> Plan patrol</span><ChevronRight size={14} />
              </Link>
            </div>
          </Panel>
          <Panel title="Alert disposition" eyebrow="SESSION STATE">
            <p className="mb-3 text-[10px] leading-4 text-[--txt-3]">Local session only. Catalyst Signals/Data Store workflow remains deployment-gated.</p>
            <div className="grid grid-cols-3 gap-2">
              <button className="condition-button" data-active={status === 'acknowledged'} onClick={() => setStatus('acknowledged')} type="button"><Check size={13} /> Acknowledge</button>
              <button className="condition-button" data-active={status === 'acting'} onClick={() => setStatus('acting')} type="button"><Activity size={13} /> Acting</button>
              <button className="condition-button" data-active={status === 'dismissed'} onClick={() => setStatus('dismissed')} type="button"><X size={13} /> Dismiss</button>
            </div>
          </Panel>
        </div>
      }
      inspectorEyebrow={`${selected.severity.toUpperCase()} · ${selected.display_z_score}`}
      inspectorTitle={selected.station_name}
      title="Command Feed"
      context={
        <div className="-m-4 flex h-[calc(100%+32px)] flex-col">
          <div className="border-b border-[--ink-600] p-4">
            <div className="flex items-center justify-between">
              <p className="type-micro text-[--txt-3]">Snapshot through {fixture.snapshot_through}</p>
              <span className="flex items-center gap-1 text-[10px] text-[--ok]"><CircleDot size={10} /> ready</span>
            </div>
            <label className="mt-3 flex items-center gap-2 rounded-[--r-sm] border border-[--ink-500] bg-[--ink-800] px-3 py-2">
              <Search size={14} className="text-[--txt-3]" />
              <input aria-label="Search feed" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[--txt-3]" onChange={(event) => setSearch(event.target.value)} placeholder="Station or category" value={search} />
            </label>
            {/*
              Only offer a tier that has cards behind it. A quiet period can
              legitimately leave `critical` empty, and a filter that always
              renders every tier then reads as a broken screen rather than an
              honest one. The count is shown so the tab says what it holds.
            */}
            <div className="mt-3 flex gap-1">
              {(['all', 'critical', 'high', 'watch'] as const)
                .map((value) => ({
                  value,
                  count:
                    value === 'all'
                      ? fixture.alerts.length
                      : fixture.alerts.filter((alert) => alert.severity === value).length,
                }))
                .filter((tier) => tier.count > 0)
                .map(({ value, count }) => (
                  <button
                    className="speed-button flex-1 capitalize"
                    data-active={severity === value}
                    key={value}
                    onClick={() => setSeverity(value)}
                    type="button"
                  >
                    {value} {count}
                  </button>
                ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {visibleAlerts.map((alert) => <FeedCard active={alert.id === selected.id} alert={alert} key={alert.id} onSelect={() => setSelectedId(alert.id)} status={statuses[alert.id] ?? 'new'} />)}
            {visibleAlerts.length === 0 ? <p className="p-6 text-center text-xs text-[--txt-3]">No alerts match this view.</p> : null}
          </div>
        </div>
      }
      timeline={
        <div className="flex h-full items-center gap-4 px-6">
          <button aria-label={replaying ? 'Pause replay' : 'Start 60-second replay'} className="timeline-play" onClick={() => replaying ? setReplaying(false) : startReplay()} type="button">
            {replaying ? <Pause size={15} /> : <Play size={15} className="translate-x-px" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex justify-between text-[10px] text-[--txt-3]"><span>{replaying ? 'Replaying audited H2 2023 feed' : 'All ranked alerts loaded'}</span><span>{Math.round(replayElapsed / 1000)} / 60s</span></div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-[--ink-600]"><div className="h-full bg-[--gold-400] transition-[width] duration-100" style={{ width: `${progress}%` }} /></div>
          </div>
          <span className="flex items-center gap-2 rounded-[--r-sm] border border-[--ink-500] px-3 py-2 text-[10px] text-[--txt-2]"><Clock3 size={13} /> {visibleAlerts.length} visible</span>
        </div>
      }
    >
      <MapCanvas alerts={visibleAlerts.length ? visibleAlerts : fixture.alerts} onSelect={(alert) => setSelectedId(alert.id)} selected={selected} />
    </OpsShell>
  )
}
