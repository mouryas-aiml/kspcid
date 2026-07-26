/**
 * Cache warmer runner. Local mode is the default acceptance path; --apply uses
 * the Catalyst adapter and therefore mutates the provisioned Cache segment.
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { handleCacheWarm } from '../functions/kv-cache-warm/index.js'

const ROOT = resolve(import.meta.dirname, '..')
const APPLY = process.argv.includes('--apply')

async function main(): Promise<void> {
  const result = await handleCacheWarm({ mode: APPLY ? 'catalyst' : 'local' })
  const output = resolve(ROOT, '.staging', 'cloud', 'cache-warm.json')
  await mkdir(resolve(ROOT, '.staging', 'cloud'), { recursive: true })
  await writeFile(
    output,
    `${JSON.stringify({ applied: APPLY, ...result }, null, 2)}\n`,
    'utf8',
  )
  process.stdout.write(
    `${APPLY ? 'Warmed' : 'Validated'} ${result.keys} Cache keys: ` +
      `${result.station_aggregates} station aggregates, ` +
      `${result.bitset_scenarios} bitset scenario / ${result.bitset_chunks} chunks, ` +
      `${result.feed_cards} feed cards; ` +
      `largest value ${result.largest_serialized_value} characters.\n`,
  )
}

await main()
