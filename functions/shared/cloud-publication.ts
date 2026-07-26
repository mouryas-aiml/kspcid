import allowlistJson from '../../etl/cloud/allowlist.json' with { type: 'json' }
import publicationManifestJson from '../../etl/cloud/publication-manifest.json' with { type: 'json' }
import { createHash } from 'node:crypto'

interface PublicationFile {
  readonly table: string
  readonly path: string
  readonly rows: number
  readonly bytes: number
  readonly sha256: string
}

interface PublicationManifest {
  readonly dataset_sha256: string
  readonly files: readonly PublicationFile[]
}

export interface PublicationInput {
  readonly source: string
  readonly object_key: string
  readonly table: string
  readonly operation: 'upsert'
  readonly find_by: string
  readonly rows: number
  readonly bytes: number
  readonly sha256: string
}

interface RuntimeObject {
  readonly object_key: string
  readonly bytes: number
  readonly sha256: string
}

interface ControlObject extends RuntimeObject {
  readonly content_type: string
}

interface CloudAllowlist {
  readonly allowlist_version: string
  readonly bucket: string
  readonly publication_dataset_sha256: string
  readonly objects: readonly RuntimeObject[]
  readonly ephemeral_publication_inputs: readonly PublicationInput[]
  readonly control_objects: readonly ControlObject[]
}

export interface ImportJob {
  readonly table: string
  readonly job_id: string
}

export interface ImportJobStatus extends ImportJob {
  readonly status: 'completed' | 'in_progress' | 'failed'
  readonly records_processed: number
  readonly description?: string
}

export interface PublicationPlatform {
  objectSize(key: string): Promise<number>
  rangeBytes(key: string, start: number, end: number): Promise<Uint8Array>
  existingJobs(datasetSha256: string): Promise<readonly ImportJob[] | null>
  saveJobs(datasetSha256: string, jobs: readonly ImportJob[]): Promise<void>
  startImport(input: PublicationInput): Promise<ImportJob>
  importStatus(job: ImportJob): Promise<ImportJobStatus>
  warmCache(): Promise<unknown>
  smokeChecks(): Promise<unknown>
  putMarker(key: string, value: Uint8Array, contentType: string): Promise<void>
  getObject(key: string): Promise<Uint8Array>
}

export interface PublicationState extends Record<string, unknown> {
  readonly dataset_sha256: string
  readonly valid?: boolean
  readonly jobs?: readonly ImportJob[]
  readonly status?: 'completed' | 'in_progress' | 'failed'
  readonly passed?: boolean
}

const manifest = publicationManifestJson as PublicationManifest
const allowlist = allowlistJson as CloudAllowlist
function publicationMarker(): ControlObject {
  const value = allowlist.control_objects[0]
  if (!value) {
    throw new Error('Publication control marker is missing from allowlist 0.2')
  }
  return value
}
const marker = publicationMarker()

export const PUBLICATION_DATASET_SHA256 = manifest.dataset_sha256
export const PUBLICATION_MARKER_KEY = marker.object_key

function state(
  input: Readonly<Record<string, unknown>>,
  update: Readonly<Record<string, unknown>>,
): PublicationState {
  return {
    ...input,
    dataset_sha256: manifest.dataset_sha256,
    ...update,
  } as PublicationState
}

export async function validatePublication(
  input: Readonly<Record<string, unknown>>,
  platform: PublicationPlatform,
): Promise<PublicationState> {
  const errors: string[] = []
  if (input['dataset_sha256'] !== manifest.dataset_sha256) {
    errors.push('Circuit input dataset_sha256 does not match the committed manifest')
  }
  if (allowlist.publication_dataset_sha256 !== manifest.dataset_sha256) {
    errors.push('Allowlist publication hash does not match the committed manifest')
  }
  for (const publicationInput of allowlist.ephemeral_publication_inputs) {
    const file = manifest.files.find(
      (candidate) => candidate.path === publicationInput.source,
    )
    if (
      !file ||
      file.rows !== publicationInput.rows ||
      file.bytes !== publicationInput.bytes ||
      file.sha256 !== publicationInput.sha256
    ) {
      errors.push(`${publicationInput.table} manifest entry does not reconcile`)
    }
    try {
      const size = await platform.objectSize(publicationInput.object_key)
      if (size !== publicationInput.bytes) {
        errors.push(
          `${publicationInput.object_key} has ${size} bytes; expected ${publicationInput.bytes}`,
        )
      }
    } catch (error) {
      errors.push(
        `${publicationInput.object_key} unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
  return state(input, { valid: errors.length === 0, validation_errors: errors })
}

export async function startPublicationImports(
  input: PublicationState,
  platform: PublicationPlatform,
): Promise<PublicationState> {
  if (!input.valid) throw new Error('Manifest validation did not pass')
  const existing = await platform.existingJobs(manifest.dataset_sha256)
  const jobs =
    existing ??
    (await Promise.all(
      allowlist.ephemeral_publication_inputs.map((item) =>
        platform.startImport(item),
      ),
    ))
  if (!existing) await platform.saveJobs(manifest.dataset_sha256, jobs)
  return state(input, { jobs, imports_reused: Boolean(existing) })
}

export async function pollPublicationImports(
  input: PublicationState,
  platform: PublicationPlatform,
): Promise<PublicationState> {
  const jobs =
    input.jobs ?? (await platform.existingJobs(manifest.dataset_sha256))
  if (!jobs || jobs.length !== allowlist.ephemeral_publication_inputs.length) {
    throw new Error('Publication import job set is missing or incomplete')
  }
  const job_statuses = await Promise.all(jobs.map((job) => platform.importStatus(job)))
  const status = job_statuses.some((job) => job.status === 'failed')
    ? 'failed'
    : job_statuses.every((job) => job.status === 'completed')
      ? 'completed'
      : 'in_progress'
  if (status === 'completed') {
    for (const item of allowlist.ephemeral_publication_inputs) {
      const completed = job_statuses.find((job) => job.table === item.table)
      if (completed?.records_processed !== item.rows) {
        throw new Error(
          `${item.table} processed ${completed?.records_processed ?? 0}; expected ${item.rows}`,
        )
      }
    }
  }
  return state(input, { status, job_statuses })
}

export async function verifyPublicationStratus(
  input: PublicationState,
  platform: PublicationPlatform,
): Promise<PublicationState> {
  if (input.status !== 'completed') throw new Error('Data Store imports are not complete')
  const verified: string[] = []
  for (const object of allowlist.objects) {
    const size = await platform.objectSize(object.object_key)
    if (size !== object.bytes) {
      throw new Error(`${object.object_key} has ${size} bytes; expected ${object.bytes}`)
    }
    verified.push(object.object_key)
  }
  const range = await platform.rangeBytes('tiles/bengaluru.pmtiles', 0, 127)
  if (range.byteLength !== 128) {
    throw new Error(`PMTiles SDK range returned ${range.byteLength} bytes; expected 128`)
  }
  return state(input, { stratus_verified: verified, pmtiles_range_bytes: 128 })
}

export async function warmPublicationCache(
  input: PublicationState,
  platform: PublicationPlatform,
): Promise<PublicationState> {
  return state(input, { cache: await platform.warmCache() })
}

export async function smokePublication(
  input: PublicationState,
  platform: PublicationPlatform,
): Promise<PublicationState> {
  const smoke = await platform.smokeChecks()
  return state(input, { passed: true, smoke })
}

export async function publishPublication(
  input: PublicationState,
  platform: PublicationPlatform,
): Promise<PublicationState> {
  if (!input.passed) throw new Error('Smoke checks did not pass')
  const value = new TextEncoder().encode(
    `${JSON.stringify({
      schema_version: 1,
      dataset_sha256: manifest.dataset_sha256,
      status: 'published',
    })}\n`,
  )
  if (value.byteLength !== marker.bytes) {
    throw new Error('Publication marker byte contract drift')
  }
  const checksum = createHash('sha256').update(value).digest('hex')
  if (checksum !== marker.sha256) {
    throw new Error('Publication marker checksum contract drift')
  }
  await platform.putMarker(marker.object_key, value, marker.content_type)
  const readBack = await platform.getObject(marker.object_key)
  if (!Buffer.from(readBack).equals(Buffer.from(value))) {
    throw new Error('Publication marker read-back mismatch')
  }
  return state(input, { published: true, marker: marker.object_key })
}
