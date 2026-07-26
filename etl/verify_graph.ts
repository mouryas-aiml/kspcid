/** Acceptance checks for A13 seeded graph and settled snapshot. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { OUTPUT } from './00_config.js'
import { sha256File } from './lib/hash.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main(): Promise<void> {
  const rawPath = resolve(OUTPUT.derived, 'entity_graph_raw.json')
  const snapshotPath = resolve(OUTPUT.derived, 'graph_snapshot.json')
  const compressedPath = resolve(OUTPUT.derived, 'graph_snapshot.json.br')
  const [raw, snapshot, nodeLines, edgeLines] = await Promise.all([
    readFile(rawPath, 'utf8').then(JSON.parse) as Promise<{
      nodes: Array<{ id: string; type: string; provenance: Record<string, unknown> }>
      edges: Array<{
        id: string
        source: string
        target: string
        provenance: Record<string, unknown>
      }>
      scenarios: unknown[]
    }>,
    readFile(snapshotPath, 'utf8').then(JSON.parse) as Promise<{
      settled_layout: boolean
      layout_method: string
      community_method: string
      bridge_method: string
      communities: number
      gds_similar_to_computed: number
      gds_similar_to_shipped: number
      gds_similar_to_ship_threshold: number
      nodes: Array<{
        id: string
        type: string
        x: number
        y: number
        community: number
        bridge_score: number
        provenance: Record<string, unknown>
      }>
      edges: Array<{
        id: string
        source: string
        target: string
        explanation: string
        scenario_id: string
      }>
    }>,
    readFile(resolve(OUTPUT.nosql, 'graph_nodes.jsonl'), 'utf8'),
    readFile(resolve(OUTPUT.nosql, 'graph_edges.jsonl'), 'utf8'),
  ])
  assert(raw.nodes.length >= 5_000, 'Graph snapshot must contain at least 5,000 nodes')
  assert(raw.edges.length > raw.nodes.length, 'Graph needs more edges than nodes')
  assert(raw.scenarios.length === 6, 'Expected six seeded graph scenarios')
  const incidentNodes = raw.nodes.filter((node) => node.type === 'incident')
  const generatedNodes = raw.nodes.filter((node) => node.type !== 'incident')
  assert(incidentNodes.length === 4_320, 'Expected 720 incident nodes per scenario')
  assert(
    incidentNodes.every(
      (node) =>
        node.provenance['source_authority'] === 'third_party_mirror' &&
        node.provenance['transformation'] === 'normalized',
    ),
    'Incident-node provenance drift',
  )
  assert(
    generatedNodes.every(
      (node) =>
        node.provenance['source_authority'] === 'generated_demo' &&
        node.provenance['transformation'] === 'generated',
    ),
    'Generated entity provenance drift',
  )
  assert(
    raw.edges.every(
      (edge) =>
        ['generated', 'inferred'].includes(String(edge.provenance['transformation'])) &&
        typeof edge.provenance['method'] === 'string',
    ),
    'Every relationship must disclose generated/inferred method',
  )
  const nodeIds = new Set(raw.nodes.map(({ id }) => id))
  assert(
    raw.edges.every((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
    'Graph contains an orphan edge',
  )
  assert(snapshot.settled_layout, 'Snapshot must ship settled coordinates')
  assert(snapshot.nodes.length === raw.nodes.length, 'Snapshot node conservation failed')

  // The snapshot carries step 07's seeded edges plus the SIMILAR_TO edges that
  // Neo4j GDS kNN discovered and that cleared the export threshold. Asserting
  // strict equality with the raw edge set would force 09 to suppress genuine
  // GDS output, so the delta is checked explicitly instead.
  const shippedKnn = snapshot.gds_similar_to_shipped ?? 0
  assert(
    snapshot.edges.length === raw.edges.length + shippedKnn,
    `Snapshot edge conservation failed: ${snapshot.edges.length} != ` +
      `${raw.edges.length} seeded + ${shippedKnn} GDS kNN`,
  )
  assert(
    snapshot.gds_similar_to_computed >= shippedKnn,
    'GDS kNN shipped more edges than it computed',
  )
  assert(
    snapshot.edges.filter((edge) => edge.scenario_id === 'gds_knn').length === shippedKnn,
    'GDS kNN edge count does not match the declared shipped total',
  )
  assert(
    /neo4j_gds_/.test(snapshot.community_method) && /neo4j_gds_/.test(snapshot.bridge_method),
    'Communities and bridge scores must come from Neo4j GDS (§2.2)',
  )
  assert(snapshot.communities > 6, 'Community analysis did not partition the graph')
  assert(
    snapshot.nodes.every((node) => node.bridge_score >= 0 && node.bridge_score <= 1),
    'gds.betweenness must be normalised into [0,1]',
  )
  assert(
    snapshot.nodes.every(
      (node) =>
        Number.isFinite(node.x) &&
        Number.isFinite(node.y) &&
        node.x >= -1 &&
        node.x <= 1 &&
        node.y >= -1 &&
        node.y <= 1 &&
        Number.isInteger(node.community),
    ),
    'Settled node coordinate/community contract failed',
  )
  assert(
    snapshot.edges.every((edge) => edge.explanation.length > 0),
    'Every edge needs a working explanation',
  )
  assert(
    nodeLines.trimEnd().split('\n').length === raw.nodes.length,
    'NoSQL node JSONL row count mismatch',
  )
  assert(
    edgeLines.trimEnd().split('\n').length === snapshot.edges.length,
    'NoSQL edge JSONL row count mismatch',
  )
  const [rawChecksum, snapshotChecksum, compressedChecksum] = await Promise.all([
    sha256File(rawPath),
    sha256File(snapshotPath),
    sha256File(compressedPath),
  ])
  process.stdout.write(
    `verify:graph — PASS\n` +
      `  nodes / edges       ${raw.nodes.length} / ${snapshot.edges.length}\n` +
      `  seeded + GDS kNN    ${raw.edges.length} + ${shippedKnn} ` +
      `(of ${snapshot.gds_similar_to_computed} computed, >= ${snapshot.gds_similar_to_ship_threshold})\n` +
      `  incident/generated  ${incidentNodes.length} / ${generatedNodes.length}\n` +
      `  compiler            ${snapshot.community_method}\n` +
      `  communities         ${snapshot.communities}\n` +
      `  raw sha256          ${rawChecksum}\n` +
      `  snapshot sha256     ${snapshotChecksum}\n` +
      `  brotli sha256       ${compressedChecksum}\n`,
  )
}

await main()
