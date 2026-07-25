/**
 * 09 — offline graph-data-science compile.
 *
 * Runs deterministic Louvain community detection and ForceAtlas2 layout over
 * step 07's mixed-provenance graph, then emits a settled NoSQL/Stratus snapshot.
 * The online product opens coordinates directly; it never performs a force
 * simulation in the browser.
 */
import { brotliCompress, constants as zlibConstants } from 'node:zlib'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { UndirectedGraph } from 'graphology'
import louvain from 'graphology-communities-louvain'
import forceAtlas2 from 'graphology-layout-forceatlas2'

import { OUTPUT } from './00_config.js'
import { GENERATION_VERSION, sha256File, stableUint64 } from './lib/hash.js'
import { recordOutput } from './lib/manifest.js'

const INPUT_PATH = resolve(OUTPUT.derived, 'entity_graph_raw.json')
const SNAPSHOT_PATH = resolve(OUTPUT.derived, 'graph_snapshot.json')
const COMPRESSED_PATH = resolve(OUTPUT.derived, 'graph_snapshot.json.br')
const NODES_PATH = resolve(OUTPUT.nosql, 'graph_nodes.jsonl')
const EDGES_PATH = resolve(OUTPUT.nosql, 'graph_edges.jsonl')
const REPORT_PATH = resolve(OUTPUT.reports, 'a13_graph_compile.md')
const brotli = promisify(brotliCompress)

interface RawNode {
  readonly id: string
  readonly type: string
  readonly label: string
  readonly scenario_id: string
  readonly attributes: Readonly<Record<string, unknown>>
  readonly provenance: Readonly<Record<string, unknown>>
}

interface RawEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly relation: string
  readonly support_type: string
  readonly weight: number
  readonly scenario_id: string
  readonly explanation: string
  readonly provenance: Readonly<Record<string, unknown>>
}

interface RawGraph {
  readonly nodes: readonly RawNode[]
  readonly edges: readonly RawEdge[]
  readonly scenarios: readonly Record<string, unknown>[]
  readonly provenance: Readonly<Record<string, unknown>>
}

function initialCoordinate(nodeId: string, axis: string): number {
  const draw = stableUint64('graph_initial_position', nodeId, axis)
  return Number(draw >> 11n) / 9_007_199_254_740_992 - 0.5
}

function round(value: number): number {
  return Number(value.toFixed(6))
}

async function main(): Promise<void> {
  const inputChecksum = await sha256File(INPUT_PATH)
  const raw = JSON.parse(await readFile(INPUT_PATH, 'utf8')) as RawGraph
  const graph = new UndirectedGraph()
  for (const node of raw.nodes) {
    graph.addNode(node.id, {
      ...node,
      x: initialCoordinate(node.id, 'x'),
      y: initialCoordinate(node.id, 'y'),
      size: node.type === 'incident' ? 3 : 5,
    })
  }
  for (const edge of raw.edges) {
    graph.addEdgeWithKey(edge.id, edge.source, edge.target, edge)
  }
  if (graph.order !== raw.nodes.length || graph.size !== raw.edges.length) {
    throw new Error('Graphology import changed node or edge conservation')
  }

  process.stdout.write(
    `09 · offline graph analysis ${graph.order.toLocaleString()} nodes · ${graph.size.toLocaleString()} edges…\n`,
  )
  const communityResult = louvain.detailed(graph, {
    getEdgeWeight: 'weight',
    randomWalk: false,
    fastLocalMoves: true,
    resolution: 1,
  })
  for (const [nodeId, community] of Object.entries(communityResult.communities)) {
    graph.setNodeAttribute(nodeId, 'community', community)
  }

  forceAtlas2.assign(graph, {
    iterations: 160,
    getEdgeWeight: 'weight',
    settings: {
      barnesHutOptimize: true,
      barnesHutTheta: 0.6,
      gravity: 0.08,
      scalingRatio: 12,
      slowDown: 8,
      strongGravityMode: false,
      edgeWeightInfluence: 1,
    },
  })

  const xValues = graph.mapNodes((_node, attributes) => Number(attributes['x']))
  const yValues = graph.mapNodes((_node, attributes) => Number(attributes['y']))
  const minX = Math.min(...xValues)
  const maxX = Math.max(...xValues)
  const minY = Math.min(...yValues)
  const maxY = Math.max(...yValues)
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1

  const compiledNodes = raw.nodes.map((node) => {
    const attributes = graph.getNodeAttributes(node.id)
    const neighbours = graph.neighbors(node.id)
    const secondHop = new Set(neighbours.flatMap((neighbour) => graph.neighbors(neighbour)))
    secondHop.delete(node.id)
    const localNodes = new Set([...neighbours, ...secondHop])
    const stationCodes = new Set<string>()
    const communities = new Set<number>()
    for (const localNode of localNodes) {
      const localAttributes = graph.getNodeAttributes(localNode)
      const rawAttributes = localAttributes['attributes'] as Record<string, unknown>
      const stationCode = rawAttributes['station_code']
      if (typeof stationCode === 'string') stationCodes.add(stationCode)
      const community = localAttributes['community']
      if (typeof community === 'number') communities.add(community)
    }
    const bridgeScore = Math.min(
      1,
      Math.max(0, stationCodes.size - 1) * 0.18 +
        Math.max(0, communities.size - 1) * 0.12,
    )
    const degree = graph.degree(node.id)
    return {
      ...node,
      x: round(((Number(attributes['x']) - minX) / spanX) * 2 - 1),
      y: round(((Number(attributes['y']) - minY) / spanY) * 2 - 1),
      degree,
      size: round(Math.max(6, Math.min(28, 6 + Math.sqrt(degree) * 3))),
      community: Number(attributes['community']),
      bridge_score: round(bridgeScore),
      always_label: false,
    }
  })
  const bridgeThreshold =
    [...compiledNodes].sort((left, right) => left.bridge_score - right.bridge_score)[
      Math.floor(compiledNodes.length * 0.9)
    ]?.bridge_score ?? 1
  const labelledNodes = compiledNodes.map((node) => ({
    ...node,
    always_label: node.bridge_score > 0 && node.bridge_score >= bridgeThreshold,
  }))
  const compiledEdges = raw.edges.map((edge) => ({
    ...edge,
    style:
      edge.support_type === 'model_similarity'
        ? { line: 'dashed', width: 1, opacity: 0.7 }
        : { line: 'dotted', width: 0.75, opacity: 0.4 },
  }))
  const snapshot = {
    schema_version: 1,
    settled_layout: true,
    layout_method: 'forceatlas2_offline_160_iterations',
    community_method: 'louvain_deterministic_order_v1',
    modularity: round(communityResult.modularity),
    communities: communityResult.count,
    bridge_method: 'two_hop_station_and_community_span_v1',
    nodes: labelledNodes,
    edges: compiledEdges,
    scenarios: raw.scenarios,
    provenance: {
      ...raw.provenance,
      graph_transformation: 'derived_layout_and_communities',
      graph_source_checksum: inputChecksum,
      generation_version: GENERATION_VERSION,
    },
  }

  const snapshotText = `${JSON.stringify(snapshot)}\n`
  const nodesText = `${labelledNodes.map((node) => JSON.stringify(node)).join('\n')}\n`
  const edgesText = `${compiledEdges.map((edge) => JSON.stringify(edge)).join('\n')}\n`
  const compressed = await brotli(Buffer.from(snapshotText), {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 8,
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
    },
  })
  await Promise.all([
    mkdir(OUTPUT.derived, { recursive: true }),
    mkdir(OUTPUT.nosql, { recursive: true }),
  ])
  await Promise.all([
    writeFile(SNAPSHOT_PATH, snapshotText, 'utf8'),
    writeFile(COMPRESSED_PATH, compressed),
    writeFile(NODES_PATH, nodesText, 'utf8'),
    writeFile(EDGES_PATH, edgesText, 'utf8'),
  ])
  const inputs = [{ path: INPUT_PATH, sha256: inputChecksum }]
  await recordOutput('09_compile_graph', SNAPSHOT_PATH, labelledNodes.length, inputs, {
    edges: compiledEdges.length,
    communities: communityResult.count,
    modularity: round(communityResult.modularity),
  })
  await recordOutput('09_compile_graph', COMPRESSED_PATH, labelledNodes.length, inputs)
  await recordOutput('09_compile_graph', NODES_PATH, labelledNodes.length, inputs)
  await recordOutput('09_compile_graph', EDGES_PATH, compiledEdges.length, inputs)
  await mkdir(OUTPUT.reports, { recursive: true })
  await writeFile(
    REPORT_PATH,
    `# A13 graph compile\n\n` +
      `- Nodes: **${labelledNodes.length.toLocaleString()}**\n` +
      `- Edges: **${compiledEdges.length.toLocaleString()}**\n` +
      `- Louvain communities: **${communityResult.count}**\n` +
      `- Modularity: **${round(communityResult.modularity)}**\n` +
      `- ForceAtlas2: **160 offline iterations; settled coordinates shipped**\n` +
      `- Snapshot bytes: **${Buffer.byteLength(snapshotText).toLocaleString()}**\n` +
      `- Brotli bytes: **${compressed.byteLength.toLocaleString()}**\n\n` +
      `Generated entities and relationships retain generated provenance; incident nodes retain mirror provenance.\n`,
    'utf8',
  )
  process.stdout.write(
    `09 · ${labelledNodes.length.toLocaleString()} nodes · ${compiledEdges.length.toLocaleString()} edges · ` +
      `${communityResult.count} communities · modularity ${round(communityResult.modularity)}\n`,
  )
}

await main()
