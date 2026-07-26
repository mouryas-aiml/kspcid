/**
 * `kv-graph` — Catalyst AIO snapshot path required by BUILD_SPEC §2.
 *
 * The canonical graph is already settled by the local Neo4j/GDS compiler. The
 * runtime does no traversal or graph mutation: it expands the checksummed
 * Brotli snapshot from Stratus and lets the AIO scaffold stream the returned
 * bytes with Content-Type application/json.
 */
import { brotliDecompress } from 'node:zlib'
import { promisify } from 'node:util'

import {
  createDataAdapter,
  type CreateDataAdapterOptions,
  type DataAdapter,
} from '../shared/data-access/index.js'

const decompress = promisify(brotliDecompress)

export async function graphSnapshotWithAdapter(
  adapter: DataAdapter,
): Promise<Uint8Array> {
  const compressed = await adapter.getObject('graph/graph_snapshot.json.br')
  const snapshot = new Uint8Array(await decompress(compressed))
  JSON.parse(new TextDecoder().decode(snapshot))
  return snapshot
}

/**
 * Request-scoped entry for the owner-generated Catalyst AIO wrapper.
 *
 * The wrapper must stream these bytes, set Content-Type application/json, and
 * apply a public immutable cache policy keyed by the allowlist checksum.
 */
export async function handleGraph(
  options: CreateDataAdapterOptions = {},
): Promise<Uint8Array> {
  const adapter = createDataAdapter(options)
  try {
    return await graphSnapshotWithAdapter(adapter)
  } finally {
    await adapter.close()
  }
}
