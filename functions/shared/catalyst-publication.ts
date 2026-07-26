import catalyst from 'zcatalyst-sdk-node'
import type { CatalystApp } from 'zcatalyst-sdk-node/lib/catalyst-app.js'

import { CatalystAdapter } from './data-access/catalyst-adapter.js'
import {
  type ImportJob,
  type ImportJobStatus,
  type PublicationInput,
  type PublicationPlatform,
} from './cloud-publication.js'
import { warmRuntimeCache } from './cache-warm.js'
import { explainWithAdapter } from '../kv-explain/index.js'
import { graphSnapshotWithAdapter } from '../kv-graph/index.js'
import { hotspotsWithAdapter } from '../kv-hotspots/index.js'
import { incidentsWithAdapter } from '../kv-incidents/index.js'
import { optimizeWithAdapter } from '../kv-optimize/index.js'
import { similarWithAdapter } from '../kv-similar/index.js'

async function streamBytes(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

interface SimilarityFixture {
  readonly cases: readonly {
    readonly target: { readonly incident_id: string }
  }[]
}

export class CatalystPublicationPlatform implements PublicationPlatform {
  readonly #app: CatalystApp
  readonly #context: Record<string, unknown>
  readonly #bucketName: string
  readonly #cacheSegment: string

  constructor(context: Record<string, unknown>) {
    this.#context = context
    this.#app = catalyst.initialize(context, { scope: 'admin' })
    this.#bucketName = process.env.KSPCID_STRATUS_BUCKET ?? 'kspcid-data'
    this.#cacheSegment = process.env.KSPCID_CACHE_SEGMENT ?? ''
    if (!this.#cacheSegment) {
      throw new Error('KSPCID_CACHE_SEGMENT is required for cloud publication')
    }
  }

  #adapter(): CatalystAdapter {
    return new CatalystAdapter({
      context: this.#context,
      stratusBucket: this.#bucketName,
    })
  }

  async objectSize(key: string): Promise<number> {
    return (await this.#app.stratus().bucket(this.#bucketName).object(key).getDetails()).size
  }

  async rangeBytes(key: string, start: number, end: number): Promise<Uint8Array> {
    return streamBytes(
      await this.#app
        .stratus()
        .bucket(this.#bucketName)
        .getObject(key, { range: `${start}-${end}` }),
    )
  }

  async existingJobs(datasetSha256: string): Promise<readonly ImportJob[] | null> {
    try {
      const value = await this.#app
        .cache()
        .segment(this.#cacheSegment)
        .getValue(`publication:${datasetSha256}:jobs`)
      return JSON.parse(value) as ImportJob[]
    } catch (error) {
      const candidate = error as { code?: string; statusCode?: number }
      if (candidate.code === 'CACHE-2' || candidate.statusCode === 404) return null
      throw error
    }
  }

  async saveJobs(datasetSha256: string, jobs: readonly ImportJob[]): Promise<void> {
    await this.#app
      .cache()
      .segment(this.#cacheSegment)
      .put(`publication:${datasetSha256}:jobs`, JSON.stringify(jobs), 172_800)
  }

  async startImport(input: PublicationInput): Promise<ImportJob> {
    const job = await this.#app
      .datastore()
      .table(input.table)
      .bulkJob('write')
      .createJob(
        { bucket_name: this.#bucketName, object_key: input.object_key },
        { operation: input.operation, find_by: input.find_by },
      )
    return { table: input.table, job_id: job.job_id }
  }

  async importStatus(job: ImportJob): Promise<ImportJobStatus> {
    const result = await this.#app
      .datastore()
      .table(job.table)
      .bulkJob('write')
      .getStatus(job.job_id)
    const detail = result.results?.details?.[0]
    return {
      ...job,
      status:
        result.status === 'Completed'
          ? 'completed'
          : result.status === 'Failed'
            ? 'failed'
            : 'in_progress',
      records_processed: detail?.records_processed ?? 0,
      ...(result.results?.description
        ? { description: result.results.description }
        : {}),
    }
  }

  async warmCache(): Promise<unknown> {
    const adapter = this.#adapter()
    try {
      return await warmRuntimeCache(adapter, this.#cacheSegment)
    } finally {
      await adapter.close()
    }
  }

  async smokeChecks(): Promise<unknown> {
    const adapter = this.#adapter()
    try {
      const incidents = await incidentsWithAdapter({ limit: 1 }, adapter)
      const hotspots = await hotspotsWithAdapter(
        { startDate: '2023-07-01', endDate: '2023-12-31', limit: 1 },
        adapter,
      )
      const firstCell = hotspots.cells[0]
      if (!firstCell) throw new Error('Hotspot smoke check returned no cells')
      const explain = await explainWithAdapter(
        {
          h3: firstCell.h3_r9,
          startDate: '2023-07-01',
          endDate: '2023-12-31',
        },
        adapter,
      )
      const similarity = await adapter.getDocument<SimilarityFixture>({
        collection: 'scenarios',
        id: 'similarity_demo',
      })
      const similarityTarget = similarity?.cases[0]?.target.incident_id ?? ''
      if (!similarityTarget) throw new Error('Similarity smoke target is missing')
      const [similar, optimize, graph] = await Promise.all([
        similarWithAdapter({ incidentId: similarityTarget, limit: 1 }, adapter),
        optimizeWithAdapter(
          {
            scenarioId: 'demo-corridor-patrol-2021-2023-night',
            targetMinutes: 7,
            reserveUnits: 4,
          },
          adapter,
        ),
        graphSnapshotWithAdapter(adapter),
      ])
      return {
        incidents: incidents.items.length,
        hotspots: hotspots.cells.length,
        explain_total: explain.total,
        similar: similar.matches.length,
        optimize_units: Object.keys(optimize.deployment).length,
        graph_bytes: graph.byteLength,
      }
    } finally {
      await adapter.close()
    }
  }

  async putMarker(
    key: string,
    value: Uint8Array,
    contentType: string,
  ): Promise<void> {
    await this.#app
      .stratus()
      .bucket(this.#bucketName)
      .putObject(key, Buffer.from(value), {
        overwrite: true,
        contentType,
        metaData: { allowlist: '0.2' },
      })
  }

  async getObject(key: string): Promise<Uint8Array> {
    return streamBytes(
      await this.#app.stratus().bucket(this.#bucketName).getObject(key),
    )
  }
}
