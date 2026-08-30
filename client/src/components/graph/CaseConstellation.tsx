'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  CircleHelp,
  Focus,
  GitBranch,
  LocateFixed,
  Network,
  Route,
  Search,
  Sparkles,
  Waypoints,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Panel } from '@/components/primitives/Panel'
import { ProvenanceChip } from '@/components/primitives/ProvenanceChip'
import { OpsShell } from '@/components/shell/OpsShell'
import type {
  GraphPath,
  GraphSnapshot,
  SnapshotEdge,
  SnapshotNode,
} from '@/lib/graph/types'
import type { Provenance } from '@/lib/provenance'
import { fetchPublicArtifact } from '@/lib/publicPath'

const GraphCanvas = dynamic(() => import('./GraphCanvas'), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center font-mono text-xs text-[--txt-3]">
      INITIALIZING WEBGL GRAPH…
    </div>
  ),
})

const scenarioLabels: Record<string, string> = {
  all: 'All six scenarios',
  vehicle_theft_ring: 'Vehicle-theft ring',
  cyber_mule_network: 'Cyber mule accounts',
  repeat_burglary_group: 'Repeat burglary',
  cross_jurisdiction_chain_snatching: 'Chain snatching',
  repeat_domestic_abuse: 'Domestic-abuse pattern',
  ndps_supply_chain: 'NDPS supply chain',
}

const nodeColours: Record<SnapshotNode['type'], string> = {
  incident: '#38BDF8',
  person: '#FFC53D',
  vehicle: '#2DD4BF',
  phone: '#A78BFA',
  account: '#FB7185',
}

function adjacency(
  edges: readonly SnapshotEdge[],
  allowed?: ReadonlySet<string>,
): Map<string, Array<{ node: string; edge: string }>> {
  const map = new Map<string, Array<{ node: string; edge: string }>>()
  for (const edge of edges) {
    if (allowed && (!allowed.has(edge.source) || !allowed.has(edge.target))) continue
    const left = map.get(edge.source) ?? []
    const right = map.get(edge.target) ?? []
    left.push({ node: edge.target, edge: edge.id })
    right.push({ node: edge.source, edge: edge.id })
    map.set(edge.source, left)
    map.set(edge.target, right)
  }
  return map
}

function nodesWithinHops(
  seed: string,
  depth: number,
  edges: readonly SnapshotEdge[],
): Set<string> {
  const graph = adjacency(edges)
  const visited = new Set([seed])
  let frontier = [seed]
  for (let hop = 0; hop < depth; hop += 1) {
    const next: string[] = []
    for (const node of frontier) {
      for (const neighbour of graph.get(node) ?? []) {
        if (visited.has(neighbour.node)) continue
        visited.add(neighbour.node)
        next.push(neighbour.node)
      }
    }
    frontier = next
  }
  return visited
}

function shortestPath(
  start: string,
  end: string,
  edges: readonly SnapshotEdge[],
  allowed: ReadonlySet<string>,
): GraphPath | null {
  if (start === end) return { nodes: new Set([start]), edges: new Set() }
  const graph = adjacency(edges, allowed)
  const queue = [start]
  const visited = new Set([start])
  const parent = new Map<string, { node: string; edge: string }>()
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const neighbour of graph.get(current) ?? []) {
      if (visited.has(neighbour.node)) continue
      visited.add(neighbour.node)
      parent.set(neighbour.node, { node: current, edge: neighbour.edge })
      if (neighbour.node === end) {
        const nodes = new Set([end])
        const pathEdges = new Set<string>()
        let cursor = end
        while (cursor !== start) {
          const step = parent.get(cursor)
          if (!step) return null
          pathEdges.add(step.edge)
          nodes.add(step.node)
          cursor = step.node
        }
        return { nodes, edges: pathEdges }
      }
      queue.push(neighbour.node)
    }
  }
  return null
}

function ContextPanel({
  snapshot,
  scenario,
  setScenario,
  reveal,
  setReveal,
  revealDepth,
  setRevealDepth,
  search,
  setSearch,
  onSearch,
  visibleNodes,
  visibleEdges,
}: {
  readonly snapshot: GraphSnapshot
  readonly scenario: string
  readonly setScenario: (value: string) => void
  readonly reveal: boolean
  readonly setReveal: (value: boolean) => void
  readonly revealDepth: number
  readonly setRevealDepth: (value: number) => void
  readonly search: string
  readonly setSearch: (value: string) => void
  readonly onSearch: () => void
  readonly visibleNodes: number
  readonly visibleEdges: number
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2">
        <Link href="/similarity/" className="rounded-[--r-sm] border border-[--ink-600] px-3 py-2 text-center text-xs text-[--txt-2]">
          Similarity
        </Link>
        <span className="rounded-[--r-sm] border border-[--cyan-400] bg-[color-mix(in_srgb,var(--cyan-400)_8%,transparent)] px-3 py-2 text-center text-xs text-[--cyan-400]">
          Constellation
        </span>
      </div>
      <div>
        <p className="type-micro text-[--txt-3]">Scenario layer</p>
        <select
          value={scenario}
          onChange={(event) => setScenario(event.target.value)}
          className="mt-2 w-full rounded-[--r-sm] border border-[--ink-500] bg-[--ink-800] px-3 py-2 text-xs"
        >
          <option value="all">All six scenarios · 5,076 nodes</option>
          {snapshot.scenarios.map(({ scenario_id }) => (
            <option key={scenario_id} value={scenario_id}>
              {scenarioLabels[scenario_id] ?? scenario_id}
            </option>
          ))}
        </select>
      </div>
      <label className="block">
        <span className="type-micro text-[--txt-3]">Find case reference</span>
        <span className="mt-2 flex items-center gap-2 rounded-[--r-sm] border border-[--ink-500] bg-[--ink-800] px-3 py-2">
          <Search size={14} className="text-[--txt-3]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSearch()
            }}
            placeholder="DEMO-BLR-…"
            className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-[--txt-3]"
          />
        </span>
      </label>
      <div>
        <div className="flex items-center justify-between">
          <p className="type-micro text-[--txt-3]">Reveal mode</p>
          <button
            type="button"
            className="rounded-full border border-[--ink-500] px-2 py-1 text-[10px] text-[--txt-2]"
            onClick={() => setReveal(!reveal)}
          >
            {reveal ? 'ACTIVE' : 'START'}
          </button>
        </div>
        <p className="mt-2 text-xs leading-5 text-[--txt-2]">
          Begin at one source case and expand a generated network one hop at a time.
        </p>
        <div className="mt-3 grid grid-cols-[36px_1fr_36px] items-center gap-2">
          <button
            type="button"
            className="icon-button"
            onClick={() => setRevealDepth(Math.max(0, revealDepth - 1))}
            disabled={!reveal}
            aria-label="Reveal previous hop"
          >
            <ArrowLeft size={15} />
          </button>
          <div className="text-center">
            <strong className="font-mono text-lg text-[--gold-400]">{revealDepth}</strong>
            <span className="ml-1 text-[10px] text-[--txt-3]">/ 4 hops</span>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => setRevealDepth(Math.min(4, revealDepth + 1))}
            disabled={!reveal}
            aria-label="Reveal next hop"
          >
            <ArrowRight size={15} />
          </button>
        </div>
        <p className="mt-2 text-center font-mono text-[9px] text-[--txt-3]">
          ← / → keyboard
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-[--r-sm] border border-[--ink-600] bg-[--ink-800] p-3">
          <p className="type-micro text-[--txt-3]">Nodes</p>
          <p className="mt-1 font-mono text-lg">{visibleNodes.toLocaleString()}</p>
        </div>
        <div className="rounded-[--r-sm] border border-[--ink-600] bg-[--ink-800] p-3">
          <p className="type-micro text-[--txt-3]">Edges</p>
          <p className="mt-1 font-mono text-lg">{visibleEdges.toLocaleString()}</p>
        </div>
      </div>
      <div>
        <p className="type-micro text-[--txt-3]">Node legend</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-[--txt-2]">
          {(Object.entries(nodeColours) as Array<[SnapshotNode['type'], string]>).map(
            ([type, colour]) => (
              <span key={type} className="flex items-center gap-2">
                <i className="h-2 w-2 rounded-full" style={{ backgroundColor: colour }} />
                {type}
              </span>
            ),
          )}
        </div>
      </div>
      <div className="rounded-[--r-sm] border border-[--prov-generated] bg-[color-mix(in_srgb,var(--prov-generated)_6%,transparent)] p-3 text-[10px] leading-5 text-[--txt-2]">
        <Sparkles size={14} className="mb-2 text-[--prov-generated]" />
        Names and connections in this view are demonstration data. FIR details keep their own data-source label.
      </div>
    </div>
  )
}

function GraphInspector({
  node,
  edge,
  pathStart,
  pathEnd,
  onPathStart,
  onPathEnd,
  onClearPath,
}: {
  readonly node: SnapshotNode | null
  readonly edge: SnapshotEdge | null
  readonly pathStart: string | null
  readonly pathEnd: string | null
  readonly onPathStart: (id: string) => void
  readonly onPathEnd: (id: string) => void
  readonly onClearPath: () => void
}) {
  if (edge) {
    const provenance: Provenance = {
      source_authority:
        edge.provenance.source_authority === 'generated_demo'
          ? 'generated_demo'
          : 'third_party_mirror',
      transformation:
        edge.provenance.transformation === 'generated' ? 'generated' : 'inferred',
      method: edge.provenance.method,
      source_checksum: edge.provenance.source_checksum,
      generation_version: edge.provenance.generation_version,
    }
    return (
      <div className="space-y-4">
        <Panel title="Why are these connected?" eyebrow={edge.support_type.replaceAll('_', ' ')}>
          <p className="text-sm leading-6 text-[--txt-2]">{edge.explanation}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[--ink-600] pt-4 text-xs">
            <div><dt className="text-[--txt-3]">Relation</dt><dd className="mt-1">{edge.relation}</dd></div>
            <div><dt className="text-[--txt-3]">Weight</dt><dd className="mt-1 font-mono">{edge.weight.toFixed(2)}</dd></div>
            <div className="col-span-2"><dt className="text-[--txt-3]">Scenario</dt><dd className="mt-1">{scenarioLabels[edge.scenario_id]}</dd></div>
          </dl>
        </Panel>
        <ProvenanceChip
          provenance={provenance}
          derivation="Shows whether a relationship is demonstration structure or a similarity suggested by the model. A demonstration link is never presented as a recorded connection."
        />
      </div>
    )
  }
  if (!node) {
    return (
      <div className="space-y-4">
        <CircleHelp className="text-[--txt-3]" />
        <p className="text-sm leading-6 text-[--txt-2]">
          Select a node to inspect source attributes, generated structure, and path controls. Select an edge for its exact connection explanation.
        </p>
      </div>
    )
  }
  const provenance: Provenance = {
    source_authority:
      node.provenance.source_authority === 'generated_demo'
        ? 'generated_demo'
        : 'third_party_mirror',
    transformation:
      node.provenance.transformation === 'generated' ? 'generated' : 'normalized',
    method: node.provenance.method,
    source_checksum: node.provenance.source_checksum,
    generation_version: node.provenance.generation_version,
  }
  return (
    <div className="space-y-4">
      <div>
        <p className="type-micro text-[--txt-3]">{node.type} · community {node.community}</p>
        <h2 className="mt-2 break-all font-mono text-base text-[--txt-hi]">{node.label}</h2>
        <p className="mt-1 text-xs text-[--txt-3]">{scenarioLabels[node.scenario_id]}</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div><dt className="text-[--txt-3]">Degree</dt><dd className="mt-1 font-mono">{node.degree}</dd></div>
        <div><dt className="text-[--txt-3]">Bridge score</dt><dd className="mt-1 font-mono">{node.bridge_score.toFixed(2)}</dd></div>
        {node.attributes.unit_name ? (
          <div className="col-span-2"><dt className="text-[--txt-3]">Station</dt><dd className="mt-1">{node.attributes.unit_name}</dd></div>
        ) : null}
        {node.attributes.registered_on ? (
          <div><dt className="text-[--txt-3]">Registered</dt><dd className="mt-1 font-mono">{node.attributes.registered_on}</dd></div>
        ) : null}
        {node.attributes.geo_origin ? (
          <div><dt className="text-[--txt-3]">Geo origin</dt><dd className="mt-1 font-mono">{node.attributes.geo_origin}</dd></div>
        ) : null}
      </dl>
      <Panel title="Path finder" eyebrow="SHORTEST PATH">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="end-secondary justify-center" onClick={() => onPathStart(node.id)}>
            <LocateFixed size={13} /> {pathStart === node.id ? 'Start set' : 'Set start'}
          </button>
          <button type="button" className="end-secondary justify-center" onClick={() => onPathEnd(node.id)}>
            <Route size={13} /> {pathEnd === node.id ? 'End set' : 'Set end'}
          </button>
        </div>
        {pathStart || pathEnd ? (
          <button type="button" onClick={onClearPath} className="mt-2 w-full text-center text-[10px] text-[--txt-3]">
            Clear path
          </button>
        ) : null}
      </Panel>
      <ProvenanceChip
        provenance={provenance}
        derivation={
          node.type === 'incident'
            ? 'Incident attributes are normalized from the third-party FIR mirror; the generated case reference remains visibly prefixed DEMO.'
            : 'This entity identity exists only inside the named generated demonstration scenario.'
        }
      />
    </div>
  )
}

function GraphTimeline({
  year,
  setYear,
  nodes,
  edges,
  communities,
}: {
  readonly year: number
  readonly setYear: (value: number) => void
  readonly nodes: number
  readonly edges: number
  readonly communities: number
}) {
  return (
    <div className="flex h-full items-center gap-4 px-5">
      <span className="type-micro whitespace-nowrap text-[--txt-3]">Graph through</span>
      <strong className="w-10 font-mono text-[--gold-400]">{year}</strong>
      <input
        type="range"
        min={2016}
        max={2023}
        value={year}
        onChange={(event) => setYear(Number(event.target.value))}
        className="patrol-range min-w-0 flex-1"
        aria-label="Graph registration-year cutoff"
      />
      <span className="hidden font-mono text-[10px] text-[--txt-3] xl:inline">
        {nodes.toLocaleString()} N · {edges.toLocaleString()} E · {communities} communities
      </span>
    </div>
  )
}

export function CaseConstellation() {
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scenario, setScenario] = useState('vehicle_theft_ring')
  const [year, setYear] = useState(2023)
  const [reveal, setReveal] = useState(false)
  const [revealDepth, setRevealDepth] = useState(0)
  const [search, setSearch] = useState('')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null)
  const [pathStart, setPathStart] = useState<string | null>(null)
  const [pathEnd, setPathEnd] = useState<string | null>(null)

  useEffect(() => {
    const offline = (process.env.NEXT_PUBLIC_DEMO_MODE ?? 'offline') === 'offline'
    const apiBase = process.env.NEXT_PUBLIC_CATALYST_API_BASE?.replace(/\/+$/, '')
    if (!offline && !apiBase) {
      setError('NEXT_PUBLIC_CATALYST_API_BASE is required in cloud mode')
      return
    }
    const snapshotRequest = offline
      ? fetchPublicArtifact('/data/graph/graph_snapshot.json')
      : fetch(`${apiBase}/graph`)
    void snapshotRequest
      .then((response) => {
        if (!response.ok) throw new Error(`Graph snapshot HTTP ${response.status}`)
        return response.json() as Promise<GraphSnapshot>
      })
      .then(setSnapshot)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Unable to load graph snapshot'),
      )
  }, [])

  const seed = snapshot?.nodes.find(
    (node) => node.scenario_id === 'vehicle_theft_ring' && node.type === 'incident',
  )
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!reveal) return
      if (event.key === 'ArrowRight') setRevealDepth((depth) => Math.min(4, depth + 1))
      if (event.key === 'ArrowLeft') setRevealDepth((depth) => Math.max(0, depth - 1))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [reveal])

  const scenarioNodes = useMemo(() => {
    if (!snapshot) return []
    const base = snapshot.nodes.filter(
      (node) =>
        (scenario === 'all' || node.scenario_id === scenario) &&
        (node.type !== 'incident' ||
          Number(node.attributes.registered_on?.slice(0, 4) ?? 0) <= year),
    )
    if (!reveal || !seed) return base
    const scenarioEdges = snapshot.edges.filter(
      (edge) => edge.scenario_id === seed.scenario_id,
    )
    const visible = nodesWithinHops(seed.id, revealDepth, scenarioEdges)
    return snapshot.nodes.filter((node) => visible.has(node.id))
  }, [reveal, revealDepth, scenario, seed, snapshot, year])
  const visibleIds = useMemo(
    () => new Set(scenarioNodes.map((node) => node.id)),
    [scenarioNodes],
  )
  const scenarioEdges = useMemo(
    () =>
      snapshot?.edges.filter(
        (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
      ) ?? [],
    [snapshot, visibleIds],
  )
  const nodeById = useMemo(
    () => new Map(snapshot?.nodes.map((node) => [node.id, node]) ?? []),
    [snapshot],
  )
  const edgeById = useMemo(
    () => new Map(snapshot?.edges.map((edge) => [edge.id, edge]) ?? []),
    [snapshot],
  )
  const path = useMemo(
    () =>
      pathStart && pathEnd && snapshot
        ? shortestPath(pathStart, pathEnd, snapshot.edges, visibleIds)
        : null,
    [pathEnd, pathStart, snapshot, visibleIds],
  )
  const selectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId)
    setSelectedEdgeId(null)
  }, [])
  const selectEdge = useCallback((edgeId: string) => {
    setSelectedEdgeId(edgeId)
    setSelectedNodeId(null)
  }, [])
  const clearSelection = useCallback(() => {
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
  }, [])

  if (error) return <div className="grid min-h-screen place-items-center bg-[--ink-900] text-[--critical]">{error}</div>
  if (!snapshot) return <div className="grid min-h-screen place-items-center bg-[--ink-900] font-mono text-xs text-[--txt-3]">LOADING SETTLED GRAPH SNAPSHOT…</div>

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null
  const selectedEdge = selectedEdgeId ? edgeById.get(selectedEdgeId) ?? null : null
  const searchGraph = () => {
    const needle = search.trim().toLowerCase()
    if (!needle) return
    const found = snapshot.nodes.find(
      (node) =>
        node.type === 'incident' &&
        node.label.toLowerCase().includes(needle) &&
        (scenario === 'all' || node.scenario_id === scenario),
    )
    if (!found) return
    setReveal(false)
    setYear(2023)
    setSelectedNodeId(found.id)
    setSelectedEdgeId(null)
    setFocusNodeId(found.id)
  }

  return (
    <OpsShell
      title="Case Constellation"
      eyebrow="CONNECT · REVEAL"
      inspectorTitle={selectedEdge ? 'Edge evidence' : 'Node evidence'}
      inspectorEyebrow="GENERATED NETWORK"
      context={
        <ContextPanel
          snapshot={snapshot}
          scenario={scenario}
          setScenario={(value) => {
            setScenario(value)
            setReveal(false)
            clearSelection()
          }}
          reveal={reveal}
          setReveal={(value) => {
            setReveal(value)
            setScenario('vehicle_theft_ring')
            setRevealDepth(0)
            setFocusNodeId(seed?.id ?? null)
          }}
          revealDepth={revealDepth}
          setRevealDepth={setRevealDepth}
          search={search}
          setSearch={setSearch}
          onSearch={searchGraph}
          visibleNodes={scenarioNodes.length}
          visibleEdges={scenarioEdges.length}
        />
      }
      inspector={
        <GraphInspector
          node={selectedNode}
          edge={selectedEdge}
          pathStart={pathStart}
          pathEnd={pathEnd}
          onPathStart={setPathStart}
          onPathEnd={setPathEnd}
          onClearPath={() => {
            setPathStart(null)
            setPathEnd(null)
          }}
        />
      }
      timeline={
        <GraphTimeline
          year={year}
          setYear={setYear}
          nodes={scenarioNodes.length}
          edges={scenarioEdges.length}
          communities={snapshot.communities}
        />
      }
    >
      <div className="relative h-full bg-[--ink-900]">
        <GraphCanvas
          nodes={scenarioNodes}
          edges={scenarioEdges}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          path={path}
          focusNodeId={focusNodeId}
          onNode={selectNode}
          onEdge={selectEdge}
          onClear={clearSelection}
        />
        <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap gap-2">
          <span className="map-badge"><Network size={13} /> settled ForceAtlas2</span>
          <span className="map-badge"><GitBranch size={13} /> Louvain {snapshot.communities}</span>
          <span className="map-badge"><Waypoints size={13} /> modularity {snapshot.modularity}</span>
        </div>
        {reveal ? (
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[--gold-500] bg-[rgb(10_15_22_/_0.94)] px-4 py-2 shadow-2xl">
            <Focus size={14} className="text-[--gold-400]" />
            <span className="text-xs">Reveal hop {revealDepth} · {scenarioNodes.length} nodes</span>
            <button type="button" onClick={() => setRevealDepth(Math.min(4, revealDepth + 1))} className="text-[--gold-400]">
              <ArrowRight size={16} />
            </button>
          </div>
        ) : null}
      </div>
    </OpsShell>
  )
}
