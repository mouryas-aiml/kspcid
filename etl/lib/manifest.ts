/**
 * `data/manifest.json` — checksums and row counts for every derived file
 * (BUILD_SPEC §6.1, §12).
 *
 * The manifest is what makes "reproducible from a checksummed input by a
 * deterministic script" (§14.6) a checkable statement rather than a claim: each
 * entry records the inputs it was built from, their checksums, the row count
 * and the output checksum. Re-running a step must reproduce the output
 * checksum exactly.
 */
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, relative } from 'node:path'

import { APP_ROOT, OUTPUT, SOURCE_ROOT } from '../00_config.js'
import { sha256File, GENERATION_VERSION } from './hash.js'

export interface ManifestEntry {
  step: string
  path: string
  rows: number
  sha256: string
  bytes: number
  inputs: Array<{ path: string; sha256: string }>
  generation_version: string
  generated_at: string
  notes?: Record<string, unknown>
}

export interface Manifest {
  generation_version: string
  updated_at: string
  entries: Record<string, ManifestEntry>
}

/** Paths are stored relative to the archive root so the manifest is portable. */
function portable(absolute: string): string {
  const fromApp = relative(APP_ROOT, absolute)
  return fromApp.startsWith('..') ? relative(SOURCE_ROOT, absolute) : `app/${fromApp}`
}

export async function readManifest(): Promise<Manifest> {
  try {
    return JSON.parse(await readFile(OUTPUT.manifest, 'utf8')) as Manifest
  } catch {
    return { generation_version: GENERATION_VERSION, updated_at: '', entries: {} }
  }
}

async function acquireManifestLock(): Promise<() => Promise<void>> {
  const lockPath = `${OUTPUT.manifest}.lock`
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try {
      await mkdir(lockPath)
      return async () => {
        await rm(lockPath, { recursive: true, force: true })
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error(`Timed out acquiring manifest lock: ${lockPath}`)
}

/**
 * Record one output file. Reads the file to checksum it, so call after writing.
 */
export async function recordOutput(
  step: string,
  outputPath: string,
  rows: number,
  inputs: ReadonlyArray<{ path: string; sha256: string }>,
  notes?: Record<string, unknown>,
): Promise<ManifestEntry> {
  const { size } = await (await import('node:fs/promises')).stat(outputPath)
  const entry: ManifestEntry = {
    step,
    path: portable(outputPath),
    rows,
    sha256: await sha256File(outputPath),
    bytes: size,
    inputs: inputs.map((i) => ({ path: portable(i.path), sha256: i.sha256 })),
    generation_version: GENERATION_VERSION,
    generated_at: new Date().toISOString(),
    ...(notes ? { notes } : {}),
  }

  await mkdir(dirname(OUTPUT.manifest), { recursive: true })
  const release = await acquireManifestLock()
  try {
    // Re-read only after acquiring the lock so concurrent ETL workers merge
    // entries instead of replacing one another's just-written manifest.
    const manifest = await readManifest()
    manifest.generation_version = GENERATION_VERSION
    manifest.updated_at = entry.generated_at
    manifest.entries[entry.path] = entry
    const temporaryPath = `${OUTPUT.manifest}.${process.pid}.tmp`
    await writeFile(
      temporaryPath,
      `${JSON.stringify(
        { ...manifest, entries: Object.fromEntries(Object.entries(manifest.entries).sort()) },
        null,
        2,
      )}\n`,
      'utf8',
    )
    await rename(temporaryPath, OUTPUT.manifest)
  } finally {
    await release()
  }
  return entry
}
