import { warmRuntimeCache } from '../shared/cache-warm.js'
import {
  type CatalystContext,
  withCatalystAdapter,
} from '../runtime/catalyst.js'

export default async function catalystCacheWarm(
  _cronDetails: unknown,
  context: CatalystContext,
): Promise<void> {
  try {
    const segment = process.env.KSPCID_CACHE_SEGMENT ?? ''
    if (!segment) throw new Error('KSPCID_CACHE_SEGMENT is required')
    const result = await withCatalystAdapter(context, (adapter) =>
      warmRuntimeCache(adapter, segment),
    )
    console.log(JSON.stringify({ event: 'cache-warm', ...result }))
    context.closeWithSuccess?.()
  } catch (error) {
    console.error(error)
    context.closeWithFailure?.()
  }
}
