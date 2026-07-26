'use client'

import {
  CalendarDays,
  ChevronRight,
  CircleDotDashed,
  GitCompareArrows,
  MapPin,
  Network,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import { Panel } from '@/components/primitives/Panel'
import { ProvenanceChip } from '@/components/primitives/ProvenanceChip'
import { OpsShell } from '@/components/shell/OpsShell'
import type { Provenance } from '@/lib/provenance'
import { publicPath } from '@/lib/publicPath'

interface Weights {
  readonly sections: number
  readonly premise: number
  readonly geography: number
  readonly time: number
  readonly victim: number
  readonly weapon: number
}

interface CaseRecord {
  readonly incident_id: string
  readonly case_ref: string
  readonly registered_on: string
  readonly unit_name: string
  readonly station_code: string
  readonly police_division: string
  readonly geo_origin: string
  readonly time_origin: string
  readonly hour_confidence: number
  readonly sections: readonly string[]
  readonly premise_tokens: readonly string[]
  readonly time_band: string | null
  readonly victim_profile: readonly string[]
  readonly weapon_hints: readonly string[]
}

interface Candidate extends CaseRecord {
  readonly components: Weights
  readonly distance_km: number
  readonly days_earlier: number
  readonly shared_sections: readonly string[]
  readonly shared_premise_tokens: readonly string[]
}

interface SimilarityFixture {
  readonly fixture_id: string
  readonly scope: string
  readonly weights: Weights
  readonly cases: readonly {
    readonly target: CaseRecord
    readonly candidates: readonly Candidate[]
  }[]
  readonly provenance: {
    readonly source_checksum: string
    readonly generation_version: string
  }
}

const weightLabels: Record<keyof Weights, string> = {
  sections: 'Section overlap',
  premise: 'Premise wording',
  geography: 'Geography',
  time: 'Time pattern',
  victim: 'Victim profile',
  weapon: 'Weapon signal',
}

function normalized(weights: Weights): Weights {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0)
  if (total === 0) return { sections: 1, premise: 0, geography: 0, time: 0, victim: 0, weapon: 0 }
  return Object.fromEntries(
    Object.entries(weights).map(([key, value]) => [key, value / total]),
  ) as unknown as Weights
}

function similarity(candidate: Candidate, weights: Weights): number {
  const active = normalized(weights)
  return (Object.keys(active) as Array<keyof Weights>).reduce(
    (score, key) => score + active[key] * candidate.components[key],
    0,
  )
}

function explanation(candidate: Candidate): string {
  const clauses: string[] = []
  if (candidate.shared_sections.length) {
    clauses.push(`Same ${candidate.shared_sections.slice(0, 2).map((section) => section.split('::').at(-1)).join(' + ')} sections`)
  }
  if (candidate.shared_premise_tokens.length) {
    clauses.push(`${candidate.shared_premise_tokens.slice(0, 2).join(' / ')} premise wording`)
  }
  if (candidate.distance_km < 5) clauses.push(`${candidate.distance_km.toFixed(1)} km away`)
  if (candidate.components.time >= 0.99 && candidate.time_band) {
    clauses.push(`same ${candidate.time_band.replaceAll('_', ' ')} band`)
  }
  return clauses.slice(0, 4).join(' · ') || 'Similar hashed MO feature pattern'
}

function SimilarityContext({
  fixture,
  selectedIncident,
  onSelect,
  weights,
  onWeight,
}: {
  readonly fixture: SimilarityFixture
  readonly selectedIncident: string
  readonly onSelect: (incidentId: string) => void
  readonly weights: Weights
  readonly onWeight: (key: keyof Weights, value: number) => void
}) {
  const [query, setQuery] = useState('')
  const targets = fixture.cases
    .map(({ target }) => target)
    .filter((target) =>
      `${target.case_ref} ${target.unit_name}`.toLowerCase().includes(query.toLowerCase()),
    )
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="rounded-[--r-sm] border border-[--cyan-400] bg-[color-mix(in_srgb,var(--cyan-400)_8%,transparent)] px-3 py-2 text-xs text-[--cyan-400]">
          Similarity
        </button>
        <Link href="/network/" className="rounded-[--r-sm] border border-[--ink-600] px-3 py-2 text-center text-xs text-[--txt-2]">
          Constellation
        </Link>
      </div>
      <label className="block">
        <span className="type-micro text-[--txt-3]">Fixture cases</span>
        <span className="mt-2 flex items-center gap-2 rounded-[--r-sm] border border-[--ink-500] bg-[--ink-800] px-3 py-2">
          <Search size={14} className="text-[--txt-3]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Case ref or station"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[--txt-3]"
          />
        </span>
      </label>
      <div className="max-h-56 overflow-y-auto rounded-[--r-md] border border-[--ink-600]">
        {targets.map((target) => (
          <button
            type="button"
            key={target.incident_id}
            onClick={() => onSelect(target.incident_id)}
            data-active={selectedIncident === target.incident_id}
            className="similarity-target"
          >
            <span className="truncate font-mono text-[10px]">{target.case_ref}</span>
            <span className="mt-0.5 block text-[10px] text-[--txt-3]">{target.unit_name}</span>
          </button>
        ))}
      </div>
      <div>
        <div className="mb-3 flex items-center gap-2">
          <SlidersHorizontal size={14} className="text-[--gold-400]" />
          <p className="type-micro text-[--txt-3]">Published weights</p>
        </div>
        <div className="space-y-3">
          {(Object.keys(weights) as Array<keyof Weights>).map((key) => (
            <label key={key} className="block">
              <span className="flex justify-between text-[10px] text-[--txt-2]">
                <span>{weightLabels[key]}</span>
                <span className="font-mono">{Math.round(normalized(weights)[key] * 100)}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={50}
                value={weights[key] * 100}
                onChange={(event) => onWeight(key, Number(event.target.value) / 100)}
                className="patrol-range mt-1 w-full"
              />
            </label>
          ))}
        </div>
      </div>
      <div className="rounded-[--r-sm] border border-[--ink-600] bg-[--ink-800] p-3 text-[10px] leading-5 text-[--txt-3]">
        <Network size={14} className="mb-2 text-[--teal-400]" />
        This feature is vector arithmetic over NoSQL documents. It has no graph-service dependency.
      </div>
    </div>
  )
}

function SimilarityInspector({
  fixture,
  selected,
}: {
  readonly fixture: SimilarityFixture
  readonly selected: Candidate | null
}) {
  const provenance: Provenance = {
    source_authority: 'third_party_mirror',
    transformation: 'derived',
    method: 'weighted_component_cosine_v1',
    source_checksum: fixture.provenance.source_checksum,
    generation_version: fixture.provenance.generation_version,
  }
  if (!selected) {
    return <p className="text-sm text-[--txt-3]">Select a similarity result to inspect its evidence.</p>
  }
  return (
    <div className="space-y-4">
      <div>
        <p className="type-micro text-[--txt-3]">Selected match</p>
        <p className="mt-2 break-all font-mono text-sm text-[--cyan-300]">{selected.case_ref}</p>
        <p className="mt-1 text-xs text-[--txt-2]">{selected.unit_name} · {selected.police_division}</p>
      </div>
      <Panel title="Why connected?" eyebrow="COMPONENT EVIDENCE">
        <div className="space-y-3">
          {(Object.keys(selected.components) as Array<keyof Weights>).map((key) => (
            <div key={key}>
              <div className="flex justify-between text-[10px]">
                <span className="text-[--txt-2]">{weightLabels[key]}</span>
                <span className="font-mono">{Math.round(selected.components[key] * 100)}%</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-[--ink-700]">
                <div className="h-full rounded-full bg-[--teal-400]" style={{ width: `${selected.components[key] * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div><dt className="text-[--txt-3]">Earlier by</dt><dd className="mt-1 font-mono">{selected.days_earlier} days</dd></div>
        <div><dt className="text-[--txt-3]">H3 distance</dt><dd className="mt-1 font-mono">{selected.distance_km.toFixed(2)} km</dd></div>
        <div><dt className="text-[--txt-3]">Geo origin</dt><dd className="mt-1 font-mono">{selected.geo_origin}</dd></div>
        <div><dt className="text-[--txt-3]">Time origin</dt><dd className="mt-1 font-mono">{selected.time_origin}</dd></div>
      </dl>
      <ProvenanceChip
        provenance={provenance}
        derivation="Each result is a weighted combination of separately inspectable section, premise, geography, inferred-time, victim and weapon feature similarities. The displayed identifier is explicitly a generated case reference."
      />
    </div>
  )
}

export function CaseSimilarity() {
  const [fixture, setFixture] = useState<SimilarityFixture | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedIncident, setSelectedIncident] = useState('')
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null)
  const [weights, setWeights] = useState<Weights>({
    sections: 0.3,
    premise: 0.2,
    geography: 0.2,
    time: 0.15,
    victim: 0.1,
    weapon: 0.05,
  })

  useEffect(() => {
    void fetch(publicPath('/data/scenarios/similarity_demo.json'))
      .then((response) => {
        if (!response.ok) throw new Error(`Similarity fixture HTTP ${response.status}`)
        return response.json() as Promise<SimilarityFixture>
      })
      .then((value) => {
        setFixture(value)
        setWeights(value.weights)
        setSelectedIncident(value.cases[0]?.target.incident_id ?? '')
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Unable to load similarity fixture'),
      )
  }, [])

  const selectedCase = fixture?.cases.find(({ target }) => target.incident_id === selectedIncident)
  const matches = useMemo(
    () =>
      [...(selectedCase?.candidates ?? [])]
        .map((candidate) => ({ candidate, score: similarity(candidate, weights) }))
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.candidate.incident_id.localeCompare(right.candidate.incident_id),
        )
        .slice(0, 10),
    [selectedCase, weights],
  )
  const activeMatch =
    matches.find(({ candidate }) => candidate.incident_id === selectedMatch)?.candidate ??
    matches[0]?.candidate ??
    null

  if (error) return <div className="grid min-h-screen place-items-center bg-[--ink-900] text-[--critical]">{error}</div>
  if (!fixture || !selectedCase) return <div className="grid min-h-screen place-items-center bg-[--ink-900] font-mono text-xs text-[--txt-3]">LOADING MO SIGNATURES…</div>

  return (
    <OpsShell
      title="Case Similarity"
      eyebrow="CONNECT · EXPLAIN"
      inspectorTitle="Match evidence"
      inspectorEyebrow="SELECTED RECORD"
      context={
        <SimilarityContext
          fixture={fixture}
          selectedIncident={selectedIncident}
          onSelect={(incidentId) => {
            setSelectedIncident(incidentId)
            setSelectedMatch(null)
          }}
          weights={weights}
          onWeight={(key, value) => setWeights((current) => ({ ...current, [key]: value }))}
        />
      }
      inspector={<SimilarityInspector fixture={fixture} selected={activeMatch} />}
    >
      <div className="h-full overflow-y-auto bg-[--ink-900] p-6">
        <header className="mx-auto max-w-5xl border-b border-[--ink-600] pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="type-micro text-[--gold-400]">SOURCE CASE · GENERATED REFERENCE</p>
              <h2 className="mt-2 font-mono text-xl text-[--txt-hi]">{selectedCase.target.case_ref}</h2>
              <p className="mt-2 text-sm text-[--txt-2]">
                {selectedCase.target.unit_name} · {selectedCase.target.registered_on} · {selectedCase.target.time_band?.replaceAll('_', ' ')}
              </p>
            </div>
            <div className="flex gap-2">
              <span className="map-badge"><CircleDotDashed size={13} /> 64D MO vector</span>
              <span className="map-badge"><GitCompareArrows size={13} /> 38,024 candidates</span>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {selectedCase.target.sections.slice(0, 4).map((section) => (
              <span key={section} className="rounded-full border border-[--ink-500] px-2 py-1 font-mono text-[10px] text-[--txt-2]">
                {section.split('::').at(-1)}
              </span>
            ))}
          </div>
        </header>
        <div className="mx-auto mt-5 max-w-5xl space-y-2">
          <div className="mb-3 flex items-center justify-between">
            <p className="type-micro text-[--txt-3]">Top 10 prior records · weights update live</p>
            <span className="font-mono text-[10px] text-[--txt-3]">GRAPH INDEPENDENT</span>
          </div>
          {matches.map(({ candidate, score }, index) => (
            <button
              type="button"
              key={candidate.incident_id}
              onClick={() => setSelectedMatch(candidate.incident_id)}
              data-active={activeMatch?.incident_id === candidate.incident_id}
              className="similarity-result"
            >
              <span className="similarity-rank">{String(index + 1).padStart(2, '0')}</span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <strong className="font-mono text-sm text-[--txt-hi]">{Math.round(score * 100)}%</strong>
                  <span className="truncate font-mono text-xs text-[--cyan-300]">{candidate.case_ref}</span>
                  <span className="flex items-center gap-1 text-[10px] text-[--txt-3]"><CalendarDays size={11} /> {candidate.days_earlier}d earlier</span>
                  <span className="flex items-center gap-1 text-[10px] text-[--txt-3]"><MapPin size={11} /> {candidate.distance_km.toFixed(1)} km</span>
                </span>
                <span className="mt-1 block truncate text-xs text-[--txt-2]">{explanation(candidate)}</span>
              </span>
              <ChevronRight size={16} className="text-[--txt-3]" />
            </button>
          ))}
        </div>
      </div>
    </OpsShell>
  )
}
