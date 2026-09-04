import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { glob } from 'node:fs/promises'

import { buildTableQuery, quoteIdentifier } from './query.js'
import type {
  CacheKey,
  DataAdapter,
  DocumentKey,
  LocalAdapterOptions,
  PutCacheOptions,
  TableQuery,
  TextSearchQuery,
} from './types.js'

interface CacheEnvelope<T> {
  readonly expiresAt: number | null
  readonly value: T
}

function tableName(filePath: string): string {
  const stem = basename(filePath, '.parquet')
  return stem
    .split('_')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('')
}

function ensureInside(root: string, candidate: string): string {
  const normalizedRoot = resolve(root)
  const normalizedCandidate = resolve(candidate)
  const rel = relative(normalizedRoot, normalizedCandidate)
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.includes(`${sep}..${sep}`)) {
    throw new Error(`Data path escapes configured root: ${candidate}`)
  }
  return normalizedCandidate
}

function searchPattern(search: string): string {
  const value = search.trim()
  if (!value) throw new Error('Full-text search requires a non-empty term')
  let pattern = ''
  let hasWildcard = false
  for (const character of value) {
    if (character === '*') {
      pattern += '%'
      hasWildcard = true
    } else if (character === '?') {
      pattern += '_'
      hasWildcard = true
    } else if (character === '%' || character === '_' || character === '\\') {
      pattern += `\\${character}`
    } else {
      pattern += character
    }
  }
  if (!hasWildcard) pattern = `%${pattern}%`
  return pattern.replaceAll("'", "''")
}

async function writeAtomic(path: string, value: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, value)
  await rename(temporary, path)
}

export class LocalAdapter implements DataAdapter {
  readonly mode = 'local' as const
  readonly #dataRoot: string
  readonly #objectNames: Readonly<Record<string, string>>
  #instance: DuckDBInstance | null = null
  #connection: DuckDBConnection | null = null
  #ready: Promise<void> | null = null

  constructor(options: LocalAdapterOptions = {}) {
    this.#dataRoot = resolve(options.dataRoot ?? join(process.cwd(), 'data'))
    this.#objectNames = {
      'graph/graph_snapshot.json.br': 'derived/graph_snapshot.json.br',
      'state/state_intelligence.json': 'scenarios/state_intelligence.json',
      ...options.objectNames,
    }
  }

  async #initialize(): Promise<void> {
    this.#instance = await DuckDBInstance.create(':memory:')
    this.#connection = await this.#instance.connect()
    for await (const filePath of glob(join(this.#dataRoot, 'derived', '*.parquet'))) {
      const view = tableName(filePath)
      const safePath = filePath.replaceAll("'", "''")
      await this.#connection.run(
        `CREATE OR REPLACE VIEW ${quoteIdentifier(view)} AS SELECT * FROM read_parquet('${safePath}')`,
      )
    }
  }

  async #database(): Promise<DuckDBConnection> {
    this.#ready ??= this.#initialize()
    await this.#ready
    if (!this.#connection) throw new Error('Local DuckDB connection failed to initialize')
    return this.#connection
  }

  #path(...parts: string[]): string {
    return ensureInside(this.#dataRoot, join(this.#dataRoot, ...parts))
  }

  async queryTable<T extends object>(query: TableQuery): Promise<T[]> {
    const connection = await this.#database()
    const reader = await connection.runAndReadAll(buildTableQuery(query))
    return reader.getRowObjectsJS() as T[]
  }

  async searchText<T extends object>(query: TextSearchQuery): Promise<T[]> {
    if (query.searchColumns.length === 0) {
      throw new Error('Full-text search requires at least one indexed column')
    }
    const limit = query.limit ?? 100
    const offset = query.offset ?? 0
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('Full-text search limit must be an integer from 1 to 500')
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error('Full-text search offset must be a non-negative integer')
    }
    const selections =
      query.selectColumns && query.selectColumns.length > 0
        ? query.selectColumns.map(quoteIdentifier).join(', ')
        : '*'
    const pattern = searchPattern(query.search)
    const predicates = query.searchColumns.map(
      (column) =>
        `CAST(${quoteIdentifier(column)} AS VARCHAR) ILIKE '${pattern}' ESCAPE '\\'`,
    )
    const order =
      query.orderBy && query.orderBy.length > 0
        ? ` ORDER BY ${query.orderBy
            .map(
              (item) =>
                `${quoteIdentifier(item.column)} ${(item.direction ?? 'asc').toUpperCase()}`,
            )
            .join(', ')}`
        : ''
    const connection = await this.#database()
    const reader = await connection.runAndReadAll(
      `SELECT ${selections} FROM ${quoteIdentifier(query.table)} ` +
        `WHERE ${predicates.join(' OR ')}${order} LIMIT ${limit} OFFSET ${offset}`,
    )
    return reader.getRowObjectsJS() as T[]
  }

  async getDocument<T>(key: DocumentKey): Promise<T | null> {
    const path = this.#path(key.collection, `${key.id}.json`)
    try {
      return JSON.parse(await readFile(path, 'utf8')) as T
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const jsonlPath = this.#path(`${key.collection}.jsonl`)
      try {
        const connection = await this.#database()
        const keyField = quoteIdentifier(key.keyField ?? 'id')
        const safePath = jsonlPath.replaceAll("'", "''")
        const safeId = key.id.replaceAll("'", "''")
        const reader = await connection.runAndReadAll(
          `SELECT * FROM read_json_auto('${safePath}', format='newline_delimited') ` +
            `WHERE ${keyField} = '${safeId}' LIMIT 1`,
        )
        return (reader.getRowObjectsJS()[0] as T | undefined) ?? null
      } catch (jsonlError) {
        if ((jsonlError as NodeJS.ErrnoException).code === 'ENOENT') return null
        if (String(jsonlError).includes('No files found')) return null
        throw jsonlError
      }
    }
  }

  async putDocument<T extends object>(key: DocumentKey, value: T): Promise<void> {
    const path = this.#path(key.collection, `${key.id}.json`)
    const keyField = key.keyField ?? 'id'
    await writeAtomic(path, `${JSON.stringify({ [keyField]: key.id, ...value }, null, 2)}\n`)
  }

  async getObject(key: string): Promise<Uint8Array> {
    return readFile(this.#path(this.#objectNames[key] ?? key))
  }

  async putObject(key: string, value: Uint8Array): Promise<void> {
    await writeAtomic(this.#path(key), value)
  }

  async getCache<T>(key: CacheKey): Promise<T | null> {
    const path = this.#path('.cache', key.segment, `${key.key}.json`)
    try {
      const envelope = JSON.parse(await readFile(path, 'utf8')) as CacheEnvelope<T>
      if (envelope.expiresAt !== null && envelope.expiresAt <= Date.now()) return null
      return envelope.value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async putCache<T>(
    key: CacheKey,
    value: T,
    options: PutCacheOptions = {},
  ): Promise<void> {
    const expiresAt =
      options.ttlSeconds === undefined ? null : Date.now() + options.ttlSeconds * 1000
    const envelope: CacheEnvelope<T> = { expiresAt, value }
    await writeAtomic(
      this.#path('.cache', key.segment, `${key.key}.json`),
      JSON.stringify(envelope),
    )
  }

  async close(): Promise<void> {
    this.#connection?.closeSync()
    this.#connection = null
    this.#instance?.closeSync()
    this.#instance = null
    this.#ready = null
  }
}
