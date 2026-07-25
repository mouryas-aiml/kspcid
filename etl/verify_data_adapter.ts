import assert from 'node:assert/strict'

import { createDataAdapter } from '../functions/shared/data-access/index.js'

interface CountRow {
  readonly row_count: bigint
}

interface AdjacencyDocument {
  readonly adjacency?: Record<string, readonly string[]>
}

interface SignatureRow {
  readonly vector_document_id: string
}

interface VectorDocument {
  readonly id: string
  readonly dimensions: number | bigint
  readonly vector: readonly number[]
}

async function main(): Promise<void> {
  const adapter = createDataAdapter({ mode: 'local' })
  try {
    const counts = await adapter.queryTable<CountRow>({
      table: 'Incidents',
      aggregates: [{ fn: 'count', column: '*', as: 'row_count' }],
    })
    assert.equal(counts[0]?.row_count, 425_408n)

    const sample = await adapter.queryTable<Record<string, unknown>>({
      table: 'Stations',
      limit: 1,
    })
    assert.equal(sample.length, 1)

    const adjacency = await adapter.getDocument<AdjacencyDocument>({
      collection: 'derived',
      id: 'station_adjacency',
    })
    assert.ok(adjacency, 'station_adjacency.json must be readable in local mode')

    const signatures = await adapter.queryTable<SignatureRow>({
      table: 'MoSignatures',
      columns: ['vector_document_id'],
      limit: 1,
    })
    const documentId = signatures[0]?.vector_document_id
    assert.ok(documentId, 'MO signature must reference a vector document')
    const vector = await adapter.getDocument<VectorDocument>({
      collection: 'nosql/mo_vectors',
      id: documentId,
    })
    assert.ok(vector, 'NoSQL JSONL vector document must be readable in local mode')
    assert.equal(Number(vector.dimensions), 64)
    assert.equal(vector.vector.length, 64)

    process.stdout.write(
      'Data adapter verified: DuckDB Parquet, disk JSON, and NoSQL JSONL are functional.\n',
    )
  } finally {
    await adapter.close()
  }
}

await main()
