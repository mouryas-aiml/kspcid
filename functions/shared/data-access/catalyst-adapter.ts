import catalyst from 'zcatalyst-sdk-node'
import { NoSQLItem } from 'zcatalyst-sdk-node/lib/no-sql/index.js'
import type { CatalystApp } from 'zcatalyst-sdk-node/lib/catalyst-app.js'

import { buildTableQuery } from './query.js'
import type {
  CacheKey,
  CatalystAdapterOptions,
  DataAdapter,
  DocumentKey,
  PutCacheOptions,
  TableQuery,
  TextSearchQuery,
} from './types.js'

async function streamBytes(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function flattenZcqlRow<T extends object>(row: Record<string, unknown>): T {
  const values = Object.values(row)
  if (values.length === 1 && typeof values[0] === 'object' && values[0] !== null) {
    return values[0] as T
  }
  return row as T
}

export class CatalystAdapter implements DataAdapter {
  readonly mode = 'catalyst' as const
  readonly #app: CatalystApp
  readonly #bucketName: string
  readonly #tableNames: Readonly<Record<string, string>>
  readonly #collectionNames: Readonly<Record<string, string>>

  constructor(options: CatalystAdapterOptions = {}) {
    this.#app = options.context
      ? catalyst.initialize(options.context, { scope: 'admin' })
      : catalyst.initializeApp({})
    this.#bucketName =
      options.stratusBucket ?? process.env.KSPCID_STRATUS_BUCKET ?? 'kspcid-data'
    this.#tableNames = {
      IncidentsTime: 'Incidents',
      ...options.tableNames,
    }
    this.#collectionNames = {
      scenarios: 'Scenarios',
      graph_nodes: 'GraphNodes',
      graph_edges: 'GraphEdges',
      ...options.collectionNames,
    }
  }

  #table(logicalName: string): string {
    return this.#tableNames[logicalName] ?? logicalName
  }

  #collection(logicalName: string): string {
    return this.#collectionNames[logicalName] ?? logicalName
  }

  async queryTable<T extends object>(query: TableQuery): Promise<T[]> {
    const rows = await this.#app.zcql().executeZCQLQuery(
      buildTableQuery({ ...query, table: this.#table(query.table) }),
    )
    return rows.map((row) => flattenZcqlRow<T>(row as Record<string, unknown>))
  }

  async searchText<T extends object>(query: TextSearchQuery): Promise<T[]> {
    const table = this.#table(query.table)
    const limit = query.limit ?? 100
    const offset = query.offset ?? 0
    if (!query.search.trim()) throw new Error('Full-text search requires a non-empty term')
    if (query.searchColumns.length === 0) {
      throw new Error('Full-text search requires at least one indexed column')
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('Full-text search limit must be an integer from 1 to 500')
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error('Full-text search offset must be a non-negative integer')
    }
    const response = await this.#app.search().executeSearchQuery({
      search: query.search,
      search_table_columns: { [table]: [...query.searchColumns] },
      ...(query.selectColumns
        ? { select_table_columns: { [table]: [...query.selectColumns] } }
        : {}),
      ...(query.orderBy && query.orderBy.length > 0
        ? {
            order_by: Object.fromEntries(
              query.orderBy.map((order) => [
                order.column,
                (order.direction ?? 'asc').toUpperCase(),
              ]),
            ),
          }
        : {}),
      start: offset,
      end: offset + limit - 1,
    })
    return ((response[table] ?? []) as T[]).slice(0, limit)
  }

  async getDocument<T>(key: DocumentKey): Promise<T | null> {
    const keyField = key.keyField ?? 'id'
    const response = await this.#app.nosql().table(this.#collection(key.collection)).fetchItem({
      keys: NoSQLItem.from({ [keyField]: key.id }),
      consistent_read: true,
    })
    const item = response.getResponseData()[0]?.item
    return item ? (item.to() as T) : null
  }

  async putDocument<T extends object>(key: DocumentKey, value: T): Promise<void> {
    const keyField = key.keyField ?? 'id'
    await this.#app
      .nosql()
      .table(this.#collection(key.collection))
      .insertItems({ item: NoSQLItem.from({ [keyField]: key.id, ...value }) })
  }

  async getObject(key: string): Promise<Uint8Array> {
    const stream = await this.#app.stratus().bucket(this.#bucketName).getObject(key)
    return streamBytes(stream)
  }

  async putObject(key: string, value: Uint8Array, contentType?: string): Promise<void> {
    const options =
      contentType === undefined ? { overwrite: true } : { overwrite: true, contentType }
    await this.#app
      .stratus()
      .bucket(this.#bucketName)
      .putObject(key, Buffer.from(value), options)
  }

  async getCache<T>(key: CacheKey): Promise<T | null> {
    try {
      const value = await this.#app.cache().segment(key.segment).getValue(key.key)
      return JSON.parse(value) as T
    } catch (error) {
      const candidate = error as { code?: string; statusCode?: number }
      if (candidate.code === 'CACHE-2' || candidate.statusCode === 404) return null
      throw error
    }
  }

  async putCache<T>(
    key: CacheKey,
    value: T,
    options: PutCacheOptions = {},
  ): Promise<void> {
    await this.#app
      .cache()
      .segment(key.segment)
      .put(key.key, JSON.stringify(value), options.ttlSeconds)
  }

  async close(): Promise<void> {
    // Catalyst SDK clients are request-scoped and expose no close operation.
  }
}
