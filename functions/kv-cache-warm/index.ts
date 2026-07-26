/**
 * A4 Cache warm contract.
 *
 * The Catalyst Cron scaffold should call handleCacheWarm every 24 hours. Cache
 * entries expire after the Catalyst maximum of two days, leaving one missed
 * Cron run of safety margin.
 */
import { warmRuntimeCache } from '../shared/cache-warm.js'
import {
  createDataAdapter,
  type CreateDataAdapterOptions,
} from '../shared/data-access/index.js'

export async function handleCacheWarm(
  options: CreateDataAdapterOptions = {},
) {
  const adapter = createDataAdapter(options)
  try {
    const segment =
      process.env.KSPCID_CACHE_SEGMENT ??
      (adapter.mode === 'local' ? 'kspcid-hot' : '')
    if (!segment) {
      throw new Error('KSPCID_CACHE_SEGMENT must contain the provisioned Cache segment ID')
    }
    return await warmRuntimeCache(adapter, segment)
  } finally {
    await adapter.close()
  }
}
