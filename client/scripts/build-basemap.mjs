#!/usr/bin/env node
/**
 * Build the self-hosted Bengaluru basemap (BUILD_SPEC §3.4).
 *
 *   node client/scripts/build-basemap.mjs
 *
 * Produces:
 *   client/public/tiles/bengaluru.pmtiles   ~37 MB, clipped to BLR_BBOX
 *   client/public/basemap/fonts/**          glyph PBFs
 *   client/public/basemap/sprites/**        dark sprite sheet
 *
 * Both directories are gitignored — they are build artifacts, like
 * client/public/data. This script is the reproduction recipe. It needs network
 * access ONCE; the running application never does.
 *
 * Requires the `pmtiles` CLI (`brew install pmtiles`).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tilesDir = resolve(clientRoot, 'public/tiles')
const basemapDir = resolve(clientRoot, 'public/basemap')

/** Identical to the §3.3 OSRM extract bbox and etl/lib/geo.ts BLR_BBOX. */
const BBOX = '77.35,12.70,77.85,13.20'
const MAXZOOM = 15
const ASSETS = 'https://protomaps.github.io/basemaps-assets'
const FONTSTACKS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic']
/** Latin, Latin Extended, Kannada (U+0C80–0CFF), General Punctuation. */
const RANGES = ['0-255', '256-511', '512-767', '768-1023', '3072-3327', '8192-8447']
const SPRITES = ['dark.json', 'dark.png', 'dark@2x.json', 'dark@2x.png']

/** Protomaps publishes a dated planet build; pick the newest that answers. */
async function newestBuild() {
  const today = new Date()
  for (let back = 0; back < 21; back++) {
    const day = new Date(today.getTime() - back * 86_400_000)
    const stamp = day.toISOString().slice(0, 10).replaceAll('-', '')
    const url = `https://build.protomaps.com/${stamp}.pmtiles`
    const response = await fetch(url, { headers: { Range: 'bytes=0-16' } })
    if (response.status === 206) return url
  }
  throw new Error('No live Protomaps daily build found in the last 21 days')
}

async function download(url, destination) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()))
}

const archive = resolve(tilesDir, 'bengaluru.pmtiles')
if (existsSync(archive)) {
  process.stdout.write(`basemap · tiles already present, skipping extract\n`)
} else {
  const source = await newestBuild()
  process.stdout.write(`basemap · extracting ${BBOX} from ${source}\n`)
  mkdirSync(tilesDir, { recursive: true })
  execFileSync(
    'pmtiles',
    ['extract', source, archive, `--bbox=${BBOX}`, `--maxzoom=${MAXZOOM}`],
    { stdio: 'inherit' },
  )
}

for (const stack of FONTSTACKS) {
  for (const range of RANGES) {
    const destination = resolve(basemapDir, 'fonts', stack, `${range}.pbf`)
    if (existsSync(destination)) continue
    await download(`${ASSETS}/fonts/${encodeURIComponent(stack)}/${range}.pbf`, destination)
  }
}

for (const sprite of SPRITES) {
  const destination = resolve(basemapDir, 'sprites', sprite)
  if (existsSync(destination)) continue
  await download(`${ASSETS}/sprites/v4/${sprite}`, destination)
}

process.stdout.write(
  `basemap · ready · ${FONTSTACKS.length} fontstacks x ${RANGES.length} ranges · ${SPRITES.length} sprite files\n`,
)
