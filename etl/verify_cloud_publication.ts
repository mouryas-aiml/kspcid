import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  pollPublicationImports,
  publishPublication,
  smokePublication,
  startPublicationImports,
  validatePublication,
  verifyPublicationStratus,
  warmPublicationCache,
  PUBLICATION_DATASET_SHA256,
  type ImportJob,
  type ImportJobStatus,
  type PublicationInput,
  type PublicationPlatform,
} from '../functions/shared/cloud-publication.js'

const ROOT = resolve(import.meta.dirname, '..')

interface Allowlist {
  readonly objects: readonly { readonly object_key: string; readonly bytes: number }[]
  readonly ephemeral_publication_inputs: readonly PublicationInput[]
}

class FakePlatform implements PublicationPlatform {
  readonly #sizes: Map<string, number>
  readonly #rows: Map<string, number>
  jobs: ImportJob[] | null = null
  status: ImportJobStatus['status'] = 'in_progress'
  starts = 0
  marker = new Uint8Array()

  constructor(allowlist: Allowlist) {
    this.#sizes = new Map(
      [...allowlist.objects, ...allowlist.ephemeral_publication_inputs].map(
        (item) => [item.object_key, item.bytes],
      ),
    )
    this.#rows = new Map(
      allowlist.ephemeral_publication_inputs.map((item) => [item.table, item.rows]),
    )
  }

  async objectSize(key: string): Promise<number> {
    const value = this.#sizes.get(key)
    if (value === undefined) throw new Error(`missing ${key}`)
    return value
  }

  async rangeBytes(_key: string, start: number, end: number): Promise<Uint8Array> {
    return new Uint8Array(end - start + 1)
  }

  async existingJobs(): Promise<readonly ImportJob[] | null> {
    return this.jobs
  }

  async saveJobs(_dataset: string, jobs: readonly ImportJob[]): Promise<void> {
    this.jobs = [...jobs]
  }

  async startImport(input: PublicationInput): Promise<ImportJob> {
    this.starts += 1
    return { table: input.table, job_id: `job-${input.table}` }
  }

  async importStatus(job: ImportJob): Promise<ImportJobStatus> {
    return {
      ...job,
      status: this.status,
      records_processed:
        this.status === 'completed' ? (this.#rows.get(job.table) ?? 0) : 0,
    }
  }

  async warmCache(): Promise<unknown> {
    return { keys: 148 }
  }

  async smokeChecks(): Promise<unknown> {
    return { routes: 6 }
  }

  async putMarker(
    _key: string,
    value: Uint8Array,
    _contentType: string,
  ): Promise<void> {
    this.marker = value
  }

  async getObject(): Promise<Uint8Array> {
    return this.marker
  }
}

const allowlist = JSON.parse(
  await readFile(resolve(ROOT, 'etl', 'cloud', 'allowlist.json'), 'utf8'),
) as Allowlist
const platform = new FakePlatform(allowlist)

const invalid = await validatePublication(
  { dataset_sha256: 'wrong' },
  platform,
)
assert.equal(invalid.valid, false)
await assert.rejects(() => startPublicationImports(invalid, platform))

const validated = await validatePublication(
  { dataset_sha256: PUBLICATION_DATASET_SHA256 },
  platform,
)
assert.equal(validated.valid, true)
const started = await startPublicationImports(validated, platform)
assert.equal(started.jobs?.length, 4)
assert.equal(platform.starts, 4)
await startPublicationImports(validated, platform)
assert.equal(platform.starts, 4, 'retry must reuse the checksummed job set')

const waiting = await pollPublicationImports(started, platform)
assert.equal(waiting.status, 'in_progress')
platform.status = 'completed'
const imported = await pollPublicationImports(started, platform)
assert.equal(imported.status, 'completed')
const stratus = await verifyPublicationStratus(imported, platform)
assert.equal(stratus['pmtiles_range_bytes'], 128)
const warmed = await warmPublicationCache(stratus, platform)
assert.deepEqual(warmed['cache'], { keys: 148 })
const smoked = await smokePublication(warmed, platform)
assert.equal(smoked.passed, true)
const published = await publishPublication(smoked, platform)
assert.equal(published['published'], true)
assert.equal(platform.marker.byteLength, 126)

process.stdout.write(
  'verify:cloud-publication — PASS (validation failure branch, idempotent imports, wait/poll, Stratus, Cache, smoke, marker)\n',
)
