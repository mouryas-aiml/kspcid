import { CatalystAdapter } from './catalyst-adapter.js'
import { LocalAdapter } from './local-adapter.js'
import type { CreateDataAdapterOptions, DataAdapter } from './types.js'

export type {
  CacheKey,
  CatalystAdapterOptions,
  CreateDataAdapterOptions,
  DataAdapter,
  DataScalar,
  DocumentKey,
  FilterOperator,
  LocalAdapterOptions,
  PutCacheOptions,
  QueryAggregate,
  QueryFilter,
  QueryOrder,
  TableQuery,
} from './types.js'

export function createDataAdapter(options: CreateDataAdapterOptions = {}): DataAdapter {
  const configured = options.mode ?? process.env.KSPCID_DATA_ADAPTER ?? 'local'
  if (configured === 'local') return new LocalAdapter(options.local)
  if (configured === 'catalyst') return new CatalystAdapter(options.catalyst)
  throw new Error(
    `Invalid KSPCID_DATA_ADAPTER=${configured}; expected "local" or "catalyst"`,
  )
}
