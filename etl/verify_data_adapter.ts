import assert from 'node:assert/strict'

import { createDataAdapter } from '../functions/shared/data-access/index.js'

interface CountRow {
  readonly row_count: bigint
}

interface AdjacencyDocument {
  readonly adjacency?: Record<string, readonly string[]>
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

    process.stdout.write(
      'Data adapter verified: DuckDB Parquet tables and disk JSON are functional.\n',
    )
  } finally {
    await adapter.close()
  }
}

await main()
