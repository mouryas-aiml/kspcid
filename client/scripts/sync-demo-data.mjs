import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appRoot = resolve(clientRoot, '..')
const files = [
  ['data/routing/corridor_region.json', 'public/data/routing/corridor_region.json'],
  ['data/routing/hex_index.json', 'public/data/routing/hex_index.json'],
  ['data/routing/duration_matrix.bin', 'public/data/routing/duration_matrix.bin'],
  ['data/routing/coverage_bitsets.bin', 'public/data/routing/coverage_bitsets.bin'],
  ['data/routing/dispatch_routes.json', 'public/data/routing/dispatch_routes.json'],
  ['data/scenarios/demo_corridor_patrol.json', 'public/data/scenarios/demo_corridor_patrol.json'],
  ['data/scenarios/similarity_demo.json', 'public/data/scenarios/similarity_demo.json'],
  ['data/scenarios/justice_pipeline.json', 'public/data/scenarios/justice_pipeline.json'],
  ['data/scenarios/command_feed.json', 'public/data/scenarios/command_feed.json'],
  ['data/scenarios/cyber_wing.json', 'public/data/scenarios/cyber_wing.json'],
  ['data/scenarios/optimizer_fallback.json', 'public/data/scenarios/optimizer_fallback.json'],
  ['data/offline/demo_snapshot.json', 'public/data/offline/demo_snapshot.json'],
  ['data/scenarios/command_map.json', 'public/data/scenarios/command_map.json'],
  ['data/scenarios/station_brief.json', 'public/data/scenarios/station_brief.json'],
  ['data/scenarios/state_intelligence.json', 'public/data/scenarios/state_intelligence.json'],
  ['data/derived/graph_snapshot.json', 'public/data/graph/graph_snapshot.json'],
  // 106 official station polygons — the §7.1 jurisdiction layer. Copied
  // verbatim: they are `official_polygon` provenance and simplifying them would
  // move a boundary the source actually asserts.
  ['reference/processed/jurisdictions.geojson', 'public/data/reference/jurisdictions.geojson'],
  ['reference/processed/karnataka_districts.geojson', 'public/data/reference/karnataka_districts.geojson'],
  ['reference/processed/karnataka_districts.geojson', 'public/data/reference/karnataka_districts.json'],
]

for (const [source, destination] of files) {
  const sourcePath = resolve(appRoot, source)
  const destinationPath = resolve(clientRoot, destination)
  await mkdir(dirname(destinationPath), { recursive: true })
  await copyFile(sourcePath, destinationPath)
}

process.stdout.write(`Synced ${files.length} deterministic application artifacts.\n`)
