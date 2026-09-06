#!/usr/bin/env node
/**
 * Copy the Next static export into `.catalyst-client` the same way the last
 * working Catalyst deploy was packaged.
 *
 *   CATALYST_CLIENT_HOSTING=1 npm run build
 *   npm run stage:catalyst
 *
 * Catalyst's zip sanitizer rejects the upload past a few hundred files
 * (`ZIPSANITIZER_FILES_COUNT_EXCEEDED`). The hosted app already routes
 * station codes through `/station/?code=` (and catalyst-404.html), so the
 * 106 pre-rendered `/station/<code>/` pages stay in `client/out` for local
 * export and are dropped from the zip only.
 */
import { cp, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(clientRoot, 'out')
const destination = path.resolve(clientRoot, '..', '.catalyst-client')
const zipEntryLimit = 500

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name)
      return entry.isDirectory() ? walk(entryPath) : [entryPath]
    }),
  )
  return paths.flat()
}

async function pruneStationPages() {
  const stationRoot = path.join(destination, 'station')
  let entries
  try {
    entries = await readdir(stationRoot, { withFileTypes: true })
  } catch {
    return 0
  }
  let removed = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    await rm(path.join(stationRoot, entry.name), { recursive: true, force: true })
    removed += 1
  }
  return removed
}

async function pruneOriginalPmtiles() {
  const archive = path.join(destination, 'tiles', 'bengaluru.pmtiles')
  const chunks = path.join(destination, 'tiles', 'bengaluru-pmtiles', 'manifest.json')
  try {
    await stat(chunks)
    await rm(archive, { force: true })
    return 1
  } catch {
    return 0
  }
}

try {
  await stat(path.join(source, 'client-package.json'))
} catch {
  throw new Error(`Catalyst export missing at ${source}. Run CATALYST_CLIENT_HOSTING=1 npm run build first.`)
}

await rm(destination, { recursive: true, force: true })
await cp(source, destination, { recursive: true })

const stations = await pruneStationPages()
const pmtiles = await pruneOriginalPmtiles()
const files = await walk(destination)

if (files.length >= zipEntryLimit) {
  throw new Error(
    `Catalyst client still has ${files.length} files (limit ${zipEntryLimit}).`,
  )
}

process.stdout.write(
  `Staged ${files.length} files into .catalyst-client · removed ${stations} station dirs` +
    `${pmtiles ? ', original PMTiles archive' : ''}\n`,
)
