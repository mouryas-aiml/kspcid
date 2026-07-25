'use client'

import { cellToBoundary } from 'h3-js'
import {
  AlertTriangle,
  ChevronDown,
  Clock3,
  Crosshair,
  Layers3,
  LocateFixed,
  Minus,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Panel } from '@/components/primitives/Panel'
import { ProvenanceChip } from '@/components/primitives/ProvenanceChip'
import { OpsShell } from '@/components/shell/OpsShell'
import type { Provenance } from '@/lib/provenance'

interface Cell {
  readonly h3_r9: string
  readonly count: number
  readonly top_crime_head: string | null
  readonly top_crime_head_count: number
  readonly top_station_code: string | null
  readonly top_station_name: string | null
  readonly top_station_count: number
  readonly latitude: number
  readonly longitude: number
}

interface Explanation {
  readonly h3: string
  readonly total: number
  readonly paragraph: string
  readonly confidence: 'high' | 'medium' | 'low'
  readonly evidence: {
    readonly crime_heads: readonly { value: string; count: number }[]
    readonly hours: readonly { value: string; count: number }[]
    readonly premises: readonly { value: string; count: number }[]
    readonly origins: readonly { value: string; count: number }[]
    readonly stations: readonly { value: string; count: number }[]
  }
}

interface CommandMapFixture {
  readonly window: { start: string; end: string; days_inclusive: number }
  readonly cells: readonly Cell[]
  readonly reported_points: readonly {
    incident_id: string
    station_code: string | null
    unit_name: string
    crime_head: string
    latitude: number
    longitude: number
    geo_origin: string
  }[]
  readonly stations: readonly {
    station_code: string | null
    unit_name: string
    police_division: string | null
    count: number
  }[]
  readonly weekly_histogram: readonly { iso_week: string; count: number }[]
  readonly explanations: readonly Explanation[]
  readonly pulse_ring: {
    h3_r9: string
    crime_heads: readonly string[]
    hourly: readonly { crime_head: string; estimated_occurrence_hour: number; count: number }[]
    generated_roster_strength: readonly number[]
  }
  readonly alerts: readonly {
    id: string
    title: string
    station_name: string
    observed_count: number
    severity: string
    geography: { latitude: number; longitude: number }
  }[]
  readonly provenance: Provenance
}

const BBOX = { minLon: 77.35, maxLon: 77.85, minLat: 12.7, maxLat: 13.2 }
const MAGMA = ['#160C2F', '#3C176B', '#792582', '#B73779', '#E65D5F', '#FDB65D']

function x(lon: number): number {
  return ((lon - BBOX.minLon) / (BBOX.maxLon - BBOX.minLon)) * 1000
}

function y(lat: number): number {
  return ((BBOX.maxLat - lat) / (BBOX.maxLat - BBOX.minLat)) * 700
}

function format(value: number): string {
  return value.toLocaleString('en-IN')
}

function Context({
  fixture,
  station,
  crimeHead,
  search,
  onStation,
  onCrimeHead,
  onSearch,
}: {
  readonly fixture: CommandMapFixture
  readonly station: string
  readonly crimeHead: string
  readonly search: string
  readonly onStation: (value: string) => void
  readonly onCrimeHead: (value: string) => void
  readonly onSearch: (value: string) => void
}) {
  const stationOptions = [...new Map(fixture.stations.filter((row) => row.station_code).map((row) => [row.station_code!, row])).values()]
  const heads = [...new Set(fixture.cells.flatMap((cell) => cell.top_crime_head ?? []))].sort()
  return (
    <div className="space-y-5">
      <label className="block">
        <span className="type-micro text-[--txt-3]">Search dominant attribute</span>
        <span className="mt-2 flex items-center gap-2 rounded-[--r-sm] border border-[--ink-500] bg-[--ink-800] px-3 py-2 text-[--txt-2]">
          <Search size={15} />
          <input aria-label="Search map" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[--txt-3]" onChange={(event) => onSearch(event.target.value)} placeholder="Station or crime head" value={search} />
        </span>
      </label>
      <label className="block text-xs text-[--txt-3]">
        STATION
        <span className="relative mt-2 block">
          <select aria-label="Map station" className="w-full appearance-none rounded-[--r-sm] border border-[--ink-500] bg-[--ink-800] px-3 py-2 pr-8 text-[--txt]" onChange={(event) => onStation(event.target.value)} value={station}>
            <option value="">All stations</option>
            {stationOptions.map((row) => <option key={row.station_code!} value={row.station_code!}>{row.unit_name}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-2.5" size={14} />
        </span>
      </label>
      <label className="block text-xs text-[--txt-3]">
        DOMINANT CRIME HEAD
        <span className="relative mt-2 block">
          <select aria-label="Map crime head" className="w-full appearance-none rounded-[--r-sm] border border-[--ink-500] bg-[--ink-800] px-3 py-2 pr-8 text-[--txt]" onChange={(event) => onCrimeHead(event.target.value)} value={crimeHead}>
            <option value="">All heads</option>
            {heads.map((head) => <option key={head}>{head}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-2.5" size={14} />
        </span>
      </label>
      <Panel title="Visible layer rules" eyebrow="TRUTH CONTRACT">
        <ul className="space-y-2 text-xs leading-5 text-[--txt-2]">
          <li><span className="text-[--cyan-400]">◆</span> H3 aggregates: reported + inferred</li>
          <li><span className="text-[--gold-400]">●</span> Point marks: eligible reported only</li>
          <li><span className="text-[--critical]">◎</span> Pulses: top six ranked alerts</li>
        </ul>
      </Panel>
      <div className="rounded-[--r-md] border border-[--ink-600] p-4">
        <p className="type-micro text-[--txt-3]">Fixed complete-window view</p>
        <p className="mt-2 flex items-center gap-2 text-xs"><Clock3 size={14} className="text-[--gold-400]" /> {fixture.window.start} → {fixture.window.end}</p>
        <p className="mt-2 text-[10px] text-[--txt-3]">{fixture.window.days_inclusive} days inclusive</p>
      </div>
    </div>
  )
}

function PulseRing({ fixture }: { readonly fixture: CommandMapFixture }) {
  const maximum = Math.max(1, ...fixture.pulse_ring.hourly.map((row) => row.count))
  return (
    <svg aria-label="24-hour derived occurrence pulse with generated roster overlay" className="mx-auto mt-4 h-[250px] w-[250px]" role="img" viewBox="0 0 280 280">
      {[0, 1, 2, 3, 4].map((ring) => <circle cx="140" cy="140" fill="none" key={ring} r={42 + ring * 18} stroke="#2B3849" />)}
      {fixture.pulse_ring.hourly.map((row) => {
        const ring = fixture.pulse_ring.crime_heads.indexOf(row.crime_head)
        if (ring < 0) return null
        const angle = row.estimated_occurrence_hour * 15 - 90
        const radius = 42 + ring * 18
        const length = 5 + (row.count / maximum) * 13
        const radians = (angle * Math.PI) / 180
        const startX = 140 + Math.cos(radians) * (radius - length / 2)
        const startY = 140 + Math.sin(radians) * (radius - length / 2)
        const endX = 140 + Math.cos(radians) * (radius + length / 2)
        const endY = 140 + Math.sin(radians) * (radius + length / 2)
        return <line key={`${row.crime_head}-${row.estimated_occurrence_hour}`} stroke={MAGMA[ring + 1]} strokeLinecap="round" strokeWidth="5" x1={startX} x2={endX} y1={startY} y2={endY} />
      })}
      {fixture.pulse_ring.generated_roster_strength.map((strength, hour) => {
        const angle = hour * 15 - 90
        const radians = (angle * Math.PI) / 180
        return <circle cx={140 + Math.cos(radians) * 128} cy={140 + Math.sin(radians) * 128} fill="#FFC53D" key={hour} opacity={0.15 + strength / 16} r="2.5" />
      })}
      <text fill="#94A3B8" fontSize="9" textAnchor="middle" x="140" y="136">DERIVED HOURS</text>
      <text fill="#FFC53D" fontSize="9" textAnchor="middle" x="140" y="151">GOLD · GENERATED ROSTER</text>
      {[0, 6, 12, 18].map((hour) => {
        const angle = hour * 15 - 90
        const radians = (angle * Math.PI) / 180
        return <text fill="#64748B" fontSize="8" key={hour} textAnchor="middle" x={140 + Math.cos(radians) * 136} y={143 + Math.sin(radians) * 136}>{String(hour).padStart(2, '0')}</text>
      })}
    </svg>
  )
}

function InspectorContent({
  fixture,
  selected,
}: {
  readonly fixture: CommandMapFixture
  readonly selected: Cell
}) {
  const explanation = fixture.explanations.find((row) => row.h3 === selected.h3_r9)
  return (
    <div className="space-y-4">
      <ProvenanceChip provenance={fixture.provenance} derivation="H3 r9 aggregate over a fixed 90-day complete-window slice. Point marks require map_pin_eligible=true." />
      <Panel title="Why here?" eyebrow={`${selected.h3_r9.slice(0, 8)}… · ${explanation?.confidence ?? 'computed'} confidence`}>
        <p className="text-sm leading-6 text-[--txt-2]">
          {explanation?.paragraph ??
            `${selected.top_station_name ?? 'Selected cell'} contains ${format(selected.count)} records. ${selected.top_crime_head ?? 'No dominant head'} is the largest category (${format(selected.top_crime_head_count)}).`}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[--ink-600] pt-4 text-xs">
          <div><dt className="text-[--txt-3]">90-day records</dt><dd className="mt-1 font-mono">{format(selected.count)}</dd></div>
          <div><dt className="text-[--txt-3]">Top-head share</dt><dd className="mt-1 font-mono">{selected.count ? ((selected.top_crime_head_count / selected.count) * 100).toFixed(1) : '0.0'}%</dd></div>
          <div><dt className="text-[--txt-3]">Dominant station</dt><dd className="mt-1 truncate" title={selected.top_station_name ?? ''}>{selected.top_station_name ?? 'Not resolved'}</dd></div>
          <div><dt className="text-[--txt-3]">Station records</dt><dd className="mt-1 font-mono">{format(selected.top_station_count)}</dd></div>
        </dl>
      </Panel>
      {selected.h3_r9 === fixture.pulse_ring.h3_r9 ? (
        <Panel title="Pulse Ring" eyebrow="24-HOUR HEARTBEAT">
          <PulseRing fixture={fixture} />
          <p className="mt-3 text-[10px] leading-4 text-[--txt-3]">Occurrence hours are derived. Gold roster strength is a generated demonstration overlay, never source fact.</p>
        </Panel>
      ) : (
        <Panel title="Pulse Ring" eyebrow="ON-DEMAND">
          <p className="text-xs leading-5 text-[--txt-2]">The compact offline snapshot precomputes the 24-hour ring for the top-ranked cell only. Select {fixture.pulse_ring.h3_r9.slice(0, 8)}… to inspect it.</p>
        </Panel>
      )}
      {explanation ? (
        <Panel title="Evidence rows" eyebrow="COMPUTED SLOTS">
          <div className="space-y-2 text-xs">
            {explanation.evidence.crime_heads.slice(0, 3).map((row) => <div className="flex justify-between gap-3" key={row.value}><span className="truncate text-[--txt-2]">{row.value}</span><span className="font-mono">{format(row.count)}</span></div>)}
          </div>
        </Panel>
      ) : null}
    </div>
  )
}

function MapCanvas({
  fixture,
  cells,
  selected,
  onSelect,
}: {
  readonly fixture: CommandMapFixture
  readonly cells: readonly Cell[]
  readonly selected: Cell
  readonly onSelect: (cell: Cell) => void
}) {
  const [zoom, setZoom] = useState(1)
  const maximum = Math.max(1, ...cells.map((cell) => cell.count))
  const visibleIds = new Set(cells.map((cell) => cell.h3_r9))
  return (
    <div className="relative h-full overflow-hidden bg-[--ink-900]">
      <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgb(56_189_248_/_0.06)_1px,transparent_1px),linear-gradient(90deg,rgb(56_189_248_/_0.06)_1px,transparent_1px)] [background-size:42px_42px]" />
      <svg aria-label="Interactive H3 command map" className="absolute inset-0 h-full w-full" role="img" viewBox="0 0 1000 700">
        <g style={{ transform: `scale(${zoom})`, transformOrigin: `${x(selected.longitude)}px ${y(selected.latitude)}px`, transition: 'transform 180ms ease' }}>
          {cells.map((cell) => {
            const boundary = cellToBoundary(cell.h3_r9)
            const points = boundary.map(([lat, lon]) => `${x(lon)},${y(lat)}`).join(' ')
            const colour = MAGMA[Math.min(MAGMA.length - 1, Math.floor((cell.count / maximum) * MAGMA.length))]
            return (
              <polygon
                aria-label={`${cell.top_station_name ?? 'Cell'}: ${cell.count} records`}
                fill={colour}
                fillOpacity={cell.h3_r9 === selected.h3_r9 ? 0.98 : 0.72}
                key={cell.h3_r9}
                onClick={() => onSelect(cell)}
                points={points}
                stroke={cell.h3_r9 === selected.h3_r9 ? '#FFC53D' : '#17263A'}
                strokeWidth={cell.h3_r9 === selected.h3_r9 ? 2.4 : 0.7}
                style={{ cursor: 'pointer' }}
              />
            )
          })}
          {fixture.reported_points.filter((point) => point.longitude && point.latitude).map((point) => (
            <circle cx={x(point.longitude)} cy={y(point.latitude)} fill="#FFC53D" key={point.incident_id} opacity=".68" r="1.8" />
          ))}
          {fixture.alerts.filter((alert) => {
            const nearest = cells.find((cell) => cell.top_station_name === alert.station_name)
            return !nearest || visibleIds.has(nearest.h3_r9)
          }).map((alert) => (
            <g key={alert.id} transform={`translate(${x(alert.geography.longitude)} ${y(alert.geography.latitude)})`}>
              <circle className="command-pulse" fill="none" r="12" stroke="#F04438" strokeWidth="2" />
              <circle fill="#F04438" r="4" />
            </g>
          ))}
        </g>
      </svg>
      <div className="absolute left-5 top-5 flex items-center gap-2 rounded-[--r-sm] border border-[--ink-500] bg-[rgb(10_15_22_/_0.94)] px-3 py-2 text-[10px] text-[--txt-2]">
        <Layers3 size={14} className="text-[--cyan-400]" /> {cells.length} H3 cells · {fixture.reported_points.length} eligible point marks
      </div>
      <div className="absolute right-5 top-5 flex flex-col gap-2">
        <button aria-label="Zoom in" className="icon-button bg-[--ink-800]" onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))} type="button"><Plus size={15} /></button>
        <button aria-label="Zoom out" className="icon-button bg-[--ink-800]" onClick={() => setZoom((value) => Math.max(1, value - 0.25))} type="button"><Minus size={15} /></button>
        <button aria-label="Reset map" className="icon-button bg-[--ink-800]" onClick={() => setZoom(1)} type="button"><Crosshair size={15} /></button>
      </div>
      <div className="absolute bottom-5 left-5 max-w-sm rounded-[--r-md] border border-[--ink-500] bg-[rgb(10_15_22_/_0.95)] p-4">
        <p className="type-micro text-[--gold-400]">Selected H3 cell</p>
        <p className="mt-2 text-base font-semibold">{selected.top_station_name ?? selected.h3_r9}</p>
        <p className="mt-1 text-xs text-[--txt-2]">{selected.top_crime_head ?? 'No dominant category'} · {format(selected.count)} records</p>
        <p className="mt-3 flex items-center gap-2 text-[10px] text-[--txt-3]"><LocateFixed size={12} /> Aggregate cell; inferred rows are never rendered as precise pins</p>
      </div>
    </div>
  )
}

function Timeline({ fixture }: { readonly fixture: CommandMapFixture }) {
  const rows = fixture.weekly_histogram
  const maximum = Math.max(...rows.map((row) => row.count))
  return (
    <div className="flex h-full items-center gap-4 px-6">
      <span className="type-micro whitespace-nowrap text-[--txt-3]">2019 — 2023</span>
      <div className="flex h-11 flex-1 items-end gap-px">
        {rows.map((row) => <span className="min-w-0 flex-1 bg-[--cyan-400] opacity-50" key={row.iso_week} style={{ height: `${Math.max(5, (row.count / maximum) * 100)}%` }} title={`${row.iso_week}: ${row.count}`} />)}
      </div>
      <span className="rounded-[--r-sm] border border-[--ink-500] px-3 py-2 text-xs text-[--txt-2]">90-day window</span>
    </div>
  )
}

export function CommandMap() {
  const [fixture, setFixture] = useState<CommandMapFixture | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [station, setStation] = useState('')
  const [crimeHead, setCrimeHead] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/data/scenarios/command_map.json')
      .then((response) => {
        if (!response.ok) throw new Error(`Command Map snapshot failed (${response.status})`)
        return response.json() as Promise<CommandMapFixture>
      })
      .then((data) => {
        setFixture(data)
        const parameters = new URLSearchParams(window.location.search)
        const inboundStation = parameters.get('station') ?? ''
        const inboundHead = parameters.get('crime_head') ?? ''
        const inboundCell = data.cells.find((cell) => cell.top_station_code === inboundStation && (!inboundHead || cell.top_crime_head === inboundHead))
        setSelectedId(inboundCell?.h3_r9 ?? data.cells[0]?.h3_r9 ?? '')
        if (inboundStation) setStation(inboundStation)
        if (inboundHead && data.cells.some((cell) => cell.top_crime_head === inboundHead)) setCrimeHead(inboundHead)
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Command Map unavailable'))
  }, [])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (fixture?.cells ?? []).filter(
      (cell) =>
        (!station || cell.top_station_code === station) &&
        (!crimeHead || cell.top_crime_head === crimeHead) &&
        (!query || cell.top_station_name?.toLowerCase().includes(query) || cell.top_crime_head?.toLowerCase().includes(query)),
    )
  }, [crimeHead, fixture, search, station])
  const selected = fixture?.cells.find((cell) => cell.h3_r9 === selectedId) ?? visible[0] ?? fixture?.cells[0]
  useEffect(() => {
    if (selected && visible.length && !visible.some((cell) => cell.h3_r9 === selected.h3_r9)) setSelectedId(visible[0]!.h3_r9)
  }, [selected, visible])

  if (error) return <div className="grid h-screen place-items-center bg-[--ink-900] text-[--critical]"><AlertTriangle /> {error}</div>
  if (!fixture || !selected) return <div className="grid h-screen place-items-center bg-[--ink-900] text-[--txt-2]">Loading H3 command picture…</div>

  return (
    <OpsShell
      context={<Context crimeHead={crimeHead} fixture={fixture} onCrimeHead={setCrimeHead} onSearch={setSearch} onStation={setStation} search={search} station={station} />}
      eyebrow="DETECT · EXPLAIN"
      inspector={<InspectorContent fixture={fixture} selected={selected} />}
      inspectorEyebrow="WHY HERE?"
      inspectorTitle={selected.top_station_name ?? 'Selected H3 cell'}
      timeline={<Timeline fixture={fixture} />}
      title="Command Map"
    >
      {visible.length ? <MapCanvas cells={visible} fixture={fixture} onSelect={(cell) => setSelectedId(cell.h3_r9)} selected={selected} /> : (
        <div className="grid h-full place-items-center bg-[--ink-900] text-center"><div><Sparkles className="mx-auto text-[--gold-400]" /><p className="mt-3">No dominant-cell matches</p><button className="mt-3 text-xs text-[--cyan-400]" onClick={() => { setStation(''); setCrimeHead(''); setSearch('') }} type="button">Clear filters</button></div></div>
      )}
    </OpsShell>
  )
}
