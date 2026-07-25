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
  ['data/scenarios/demo_corridor_patrol.json', 'public/data/scenarios/demo_corridor_patrol.json'],
]

for (const [source, destination] of files) {
  const sourcePath = resolve(appRoot, source)
  const destinationPath = resolve(clientRoot, destination)
  await mkdir(dirname(destinationPath), { recursive: true })
  await copyFile(sourcePath, destinationPath)
}

process.stdout.write(`Synced ${files.length} deterministic Patrol Lab artifacts.\n`)
