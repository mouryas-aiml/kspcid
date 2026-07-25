export type DataScalar = string | number | boolean | bigint | null

export type FilterOperator =
  | 'eq'
  | 'ne'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'in'
  | 'is_null'
  | 'is_not_null'

export interface QueryFilter {
  readonly column: string
  readonly operator: FilterOperator
  readonly value?: DataScalar | readonly DataScalar[]
}

export interface QueryOrder {
  readonly column: string
  readonly direction?: 'asc' | 'desc'
}

export interface QueryAggregate {
  readonly fn: 'count' | 'sum' | 'avg' | 'min' | 'max'
  readonly column: string
  readonly as: string
}

/**
 * Deliberately small query language shared by DuckDB and Catalyst ZCQL.
 * Keeping SQL construction here prevents downstream Functions from coupling
 * themselves to either engine or interpolating request input into SQL.
 */
export interface TableQuery {
  readonly table: string
  readonly columns?: readonly string[]
  readonly aggregates?: readonly QueryAggregate[]
  readonly filters?: readonly QueryFilter[]
  readonly groupBy?: readonly string[]
  readonly orderBy?: readonly QueryOrder[]
  readonly limit?: number
  readonly offset?: number
}

export interface DocumentKey {
  readonly collection: string
  readonly id: string
  readonly keyField?: string
}

export interface CacheKey {
  readonly segment: string
  readonly key: string
}

export interface PutCacheOptions {
  readonly ttlSeconds?: number
}

export interface DataAdapter {
  readonly mode: 'local' | 'catalyst'

  queryTable<T extends object>(query: TableQuery): Promise<T[]>

  getDocument<T>(key: DocumentKey): Promise<T | null>
  putDocument<T extends object>(key: DocumentKey, value: T): Promise<void>

  getObject(key: string): Promise<Uint8Array>
  putObject(key: string, value: Uint8Array, contentType?: string): Promise<void>

  getCache<T>(key: CacheKey): Promise<T | null>
  putCache<T>(key: CacheKey, value: T, options?: PutCacheOptions): Promise<void>

  close(): Promise<void>
}

export interface LocalAdapterOptions {
  readonly dataRoot?: string
}

export interface CatalystAdapterOptions {
  /**
   * Catalyst Function request/context object passed to SDK initialize().
   * Omit only when the SDK environment variables contain admin credentials.
   */
  readonly context?: Record<string, unknown>
  readonly stratusBucket?: string
}

export interface CreateDataAdapterOptions {
  readonly mode?: 'local' | 'catalyst'
  readonly local?: LocalAdapterOptions
  readonly catalyst?: CatalystAdapterOptions
}
