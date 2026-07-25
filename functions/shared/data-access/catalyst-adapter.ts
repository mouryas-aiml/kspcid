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

  constructor(options: CatalystAdapterOptions = {}) {
    this.#app = options.context
      ? catalyst.initialize(options.context, { scope: 'admin' })
      : catalyst.initializeApp({})
    this.#bucketName =
      options.stratusBucket ?? process.env.KSPCID_STRATUS_BUCKET ?? 'kspcid-data'
  }

  async queryTable<T extends object>(query: TableQuery): Promise<T[]> {
    const rows = await this.#app.zcql().executeZCQLQuery(buildTableQuery(query))
    return rows.map((row) => flattenZcqlRow<T>(row as Record<string, unknown>))
  }

  async getDocument<T>(key: DocumentKey): Promise<T | null> {
    const keyField = key.keyField ?? 'id'
    const response = await this.#app.nosql().table(key.collection).fetchItem({
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
      .table(key.collection)
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
