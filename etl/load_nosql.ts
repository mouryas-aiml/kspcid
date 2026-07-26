/**
 * Owner-invoked NoSQL loader.
 *
 * Dry-run is the default. Pass --apply only after the GraphNodes, GraphEdges,
 * and Scenarios tables have been created from etl/nosql/collections.json.
 */
import catalyst from 'zcatalyst-sdk-node'
import { NoSQLItem } from 'zcatalyst-sdk-node/lib/no-sql/index.js'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { glob } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'

const ROOT = resolve(import.meta.dirname, '..')
const APPLY = process.argv.includes('--apply')
const FETCH_BATCH_SIZE = 100
const INSERT_BATCH_SIZE = 25
type NoSQLRecord = Parameters<typeof NoSQLItem.from>[0]

interface CollectionConfig {
  readonly tables: readonly {
    readonly table_name: string
    readonly sources?: readonly string[]
    readonly source_glob?: string
    readonly expected_items: number
  }[]
}

async function jsonLines(path: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(path, 'utf8')
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

async function sourceFiles(table: CollectionConfig['tables'][number]): Promise<string[]> {
  const result = (table.sources ?? []).map((path) => resolve(ROOT, path))
  if (table.source_glob) {
    for await (const path of glob(resolve(ROOT, table.source_glob))) result.push(path)
  }
  return result.sort()
}

async function main(): Promise<void> {
  const config = JSON.parse(
    await readFile(resolve(ROOT, 'etl', 'nosql', 'collections.json'), 'utf8'),
  ) as CollectionConfig
  const app = APPLY ? catalyst.initializeApp({}) : null
  for (const table of config.tables) {
    const items: Record<string, unknown>[] = []
    for (const path of await sourceFiles(table)) {
      if (path.endsWith('.jsonl')) {
        items.push(...(await jsonLines(path)))
      } else {
        const value = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
        items.push({ id: basename(path, '.json'), ...value })
      }
    }
    if (items.length !== table.expected_items) {
      throw new Error(
        `${table.table_name} item drift: expected ${table.expected_items}, found ${items.length}`,
      )
    }
    if (app) {
      const target = app.nosql().table(table.table_name)
      for (let index = 0; index < items.length; index += FETCH_BATCH_SIZE) {
        const batch = items.slice(index, index + FETCH_BATCH_SIZE)
        const response = await target.fetchItem({
          keys: batch.map((item) => NoSQLItem.from({ id: String(item.id) })),
          consistent_read: true,
        })
        const existing = new Map(
          response
            .getResponseData()
            .flatMap((entry) => (entry.item ? [[String(entry.item.to().id), entry.item.to()]] : [])),
        )
        const missing: Record<string, unknown>[] = []
        for (const item of batch) {
          const current = existing.get(String(item.id))
          if (!current) {
            missing.push(item)
          } else if (!isDeepStrictEqual(current, item)) {
            throw new Error(
              `${table.table_name}/${String(item.id)} already exists with different content`,
            )
          }
        }
        for (let insertIndex = 0; insertIndex < missing.length; insertIndex += INSERT_BATCH_SIZE) {
          await target.insertItems(
            ...missing
              .slice(insertIndex, insertIndex + INSERT_BATCH_SIZE)
              .map((item) => ({ item: NoSQLItem.from(item as NoSQLRecord) })),
          )
        }
      }
    }
    process.stdout.write(
      `${APPLY ? 'loaded' : 'validated'} ${table.table_name}: ${items.length.toLocaleString()}\n`,
    )
  }
  if (!APPLY) {
    process.stdout.write('Dry run only. Re-run with --apply after owner provisioning.\n')
  }
}

await main()
