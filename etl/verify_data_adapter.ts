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

interface SearchRow {
  readonly incident_id: string
  readonly case_ref: string
  readonly act_section: string
  readonly place_of_offence: string
  readonly crime_head: string
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

    const searchable = await adapter.queryTable<SearchRow>({
      table: 'IncidentsTime',
      columns: [
        'incident_id',
        'case_ref',
        'act_section',
        'place_of_offence',
        'crime_head',
      ],
      filters: [{ column: 'act_section', operator: 'is_not_null' }],
      orderBy: [{ column: 'incident_id' }],
      limit: 1,
    })
    const target = searchable[0]
    assert.ok(target, 'An incident must be available for full-text verification')
    const caseHits = await adapter.searchText<SearchRow>({
      table: 'IncidentsTime',
      search: target.case_ref,
      searchColumns: ['case_ref'],
      selectColumns: ['incident_id', 'case_ref', 'act_section', 'place_of_offence', 'crime_head'],
      limit: 10,
    })
    assert.ok(
      caseHits.some((row) => row.incident_id === target.incident_id),
      'Full-text case reference search must return the source incident',
    )
    const sectionToken = target.act_section
      .split(/[^A-Za-z0-9]+/)
      .find((token) => token.length >= 3)
    assert.ok(sectionToken, 'Act/section sample must contain a searchable token')
    const sectionHits = await adapter.searchText<SearchRow>({
      table: 'IncidentsTime',
      search: `${sectionToken}*`,
      searchColumns: ['act_section'],
      selectColumns: ['incident_id', 'case_ref', 'act_section', 'place_of_offence', 'crime_head'],
      limit: 100,
    })
    assert.ok(
      sectionHits.some((row) =>
        row.act_section.toLowerCase().includes(sectionToken.toLowerCase()),
      ),
      'Full-text act/section search must return a matching incident',
    )

    process.stdout.write(
      'Data adapter verified: relational queries, FTS, disk JSON, and NoSQL JSONL are functional.\n',
    )
  } finally {
    await adapter.close()
  }
}

await main()
