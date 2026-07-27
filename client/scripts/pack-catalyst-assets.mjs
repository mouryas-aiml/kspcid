import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'public', 'tiles', 'bengaluru.pmtiles')
const output = path.join(root, 'public', 'tiles', 'bengaluru-pmtiles')
const manifestPath = path.join(output, 'manifest.json')
const dataRoot = path.join(root, 'public', 'data')
const dataManifestPath = path.join(dataRoot, 'catalyst-manifest.json')
const chunkSize = 256 * 1024
const compressedSuffix = '.catalyst.gz'
const partsSuffix = '.catalyst-parts'

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

function byteShuffle(buffer, width = 4) {
  const items = Math.floor(buffer.length / width)
  const shuffled = Buffer.allocUnsafe(buffer.length)
  for (let byte = 0; byte < width; byte += 1) {
    for (let index = 0; index < items; index += 1) {
      shuffled[byte * items + index] = buffer[index * width + byte]
    }
  }
  buffer.copy(shuffled, items * width, items * width)
  return shuffled
}

function byteUnshuffle(buffer, width = 4) {
  const items = Math.floor(buffer.length / width)
  const restored = Buffer.allocUnsafe(buffer.length)
  for (let byte = 0; byte < width; byte += 1) {
    for (let index = 0; index < items; index += 1) {
      restored[index * width + byte] = buffer[byte * items + index]
    }
  }
  buffer.copy(restored, items * width, items * width)
  return restored
}

async function cleanPackedData(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.name.endsWith(partsSuffix)) {
      await rm(entryPath, { recursive: true, force: true })
    } else if (entry.isDirectory()) {
      await cleanPackedData(entryPath)
    } else if (
      entry.name.endsWith(compressedSuffix) ||
      entryPath === dataManifestPath
    ) {
      await rm(entryPath, { force: true })
    }
  }
}

if (process.env.CATALYST_CLIENT_HOSTING !== '1') {
  await rm(output, { recursive: true, force: true })
  await cleanPackedData(dataRoot)
  process.exit(0)
}

const archive = await readFile(source)
const sha256 = createHash('sha256').update(archive).digest('hex')
const chunkCount = Math.ceil(archive.length / chunkSize)

let chunksReady = false
try {
  const current = JSON.parse(await readFile(manifestPath, 'utf8'))
  const finalChunk = path.join(output, `${String(chunkCount - 1).padStart(4, '0')}.bin`)
  if (
    current.sha256 === sha256 &&
    current.chunk_size === chunkSize &&
    current.chunk_count === chunkCount &&
    (await stat(finalChunk)).isFile()
  ) {
    chunksReady = true
    console.log(`Catalyst PMTiles chunks ready · ${chunkCount} × ${chunkSize} bytes`)
  }
} catch {
  // Missing or stale output is rebuilt below.
}

if (!chunksReady) {
  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })

  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * chunkSize
    const filename = `${String(index).padStart(4, '0')}.bin`
    await writeFile(path.join(output, filename), archive.subarray(start, start + chunkSize))
  }

  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        version: 1,
        archive: 'bengaluru.pmtiles',
        bytes: archive.length,
        chunk_size: chunkSize,
        chunk_count: chunkCount,
        sha256,
      },
      null,
      2,
    )}\n`,
  )

  console.log(
    `Catalyst PMTiles packed · ${archive.length.toLocaleString('en-IN')} bytes · ${chunkCount} chunks`,
  )
}

await cleanPackedData(dataRoot)
const dataFiles = await walk(dataRoot)
let sourceBytes = 0
let compressedBytes = 0
const artifacts = {}
for (const file of dataFiles) {
  const original = await readFile(file)
  const shuffled = file.endsWith('.bin')
  const compressionInput = shuffled ? byteShuffle(original) : original
  const compressed = gzipSync(compressionInput, { level: 9 })
  const roundTrip = gunzipSync(compressed)
  const restored = shuffled ? byteUnshuffle(roundTrip) : roundTrip
  if (!restored.equals(original)) throw new Error(`Lossless round-trip failed: ${file}`)

  const artifactPath = `/${path.relative(path.join(root, 'public'), file).split(path.sep).join('/')}`
  const sha256 = createHash('sha256').update(original).digest('hex')
  if (compressed.length <= chunkSize) {
    await writeFile(`${file}${compressedSuffix}`, compressed)
    artifacts[artifactPath] = {
      delivery: 'single',
      compression: shuffled ? 'shuffle4+gzip' : 'gzip',
      bytes: original.length,
      compressed_bytes: compressed.length,
      sha256,
    }
  } else {
    const partsDirectory = `${file}${partsSuffix}`
    const parts = Math.ceil(compressed.length / chunkSize)
    await mkdir(partsDirectory, { recursive: true })
    for (let index = 0; index < parts; index += 1) {
      const start = index * chunkSize
      await writeFile(
        path.join(partsDirectory, `${String(index).padStart(4, '0')}.bin`),
        compressed.subarray(start, start + chunkSize),
      )
    }
    artifacts[artifactPath] = {
      delivery: 'parts',
      compression: shuffled ? 'shuffle4+gzip' : 'gzip',
      bytes: original.length,
      compressed_bytes: compressed.length,
      chunk_size: chunkSize,
      parts,
      sha256,
    }
  }
  sourceBytes += original.length
  compressedBytes += compressed.length
}
await writeFile(
  dataManifestPath,
  `${JSON.stringify({ version: 1, artifacts }, null, 2)}\n`,
)
console.log(
  `Catalyst data packed · ${sourceBytes.toLocaleString('en-IN')} → ${compressedBytes.toLocaleString('en-IN')} bytes · lossless`,
)
