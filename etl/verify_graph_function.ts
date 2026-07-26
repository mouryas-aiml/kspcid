import assert from 'node:assert/strict'

import { handleGraph } from '../functions/kv-graph/index.js'

interface GraphSnapshot {
  readonly nodes: readonly unknown[]
  readonly edges: readonly unknown[]
  readonly settled_layout: boolean
}

const bytes = await handleGraph({ mode: 'local' })
const snapshot = JSON.parse(new TextDecoder().decode(bytes)) as GraphSnapshot
assert.equal(bytes.byteLength, 11_925_630)
assert.equal(snapshot.nodes.length, 5_112)
assert.equal(snapshot.edges.length, 10_074)
assert.equal(snapshot.settled_layout, true)
process.stdout.write(
  `verify:graph:function — PASS (${snapshot.nodes.length} nodes / ${snapshot.edges.length} edges)\n`,
)
