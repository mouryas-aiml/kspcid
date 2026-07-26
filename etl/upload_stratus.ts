/**
 * Checksummed Stratus publisher for the 0.2 allowlist.
 *
 * Dry-run is the default. --apply is an explicit external mutation and is only
 * intended after the project owner provisions the named bucket.
 */
import catalyst from 'zcatalyst-sdk-node'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { sha256File } from './lib/hash.js'

const ROOT = resolve(import.meta.dirname, '..')
const APPLY = process.argv.includes('--apply')
const INCLUDE_PUBLICATION = process.argv.includes('--include-publication-inputs')

interface Allowlist {
  readonly allowlist_version: string
  readonly bucket: string
  readonly objects: readonly {
    readonly source: string
    readonly object_key: string
    readonly content_type: string
    readonly bytes: number
    readonly sha256: string
  }[]
  readonly ephemeral_publication_inputs: readonly {
    readonly source: string
    readonly object_key: string
    readonly table: string
    readonly bytes: number
    readonly sha256: string
    readonly ttl_seconds: number
  }[]
}

async function main(): Promise<void> {
  const allowlist = JSON.parse(
    await readFile(resolve(ROOT, 'etl', 'cloud', 'allowlist.json'), 'utf8'),
  ) as Allowlist
  const selected = INCLUDE_PUBLICATION
    ? [
        ...allowlist.objects,
        ...allowlist.ephemeral_publication_inputs.map((input) => ({
          ...input,
          content_type: 'text/csv',
        })),
      ]
    : allowlist.objects
  const verified = []
  for (const object of selected) {
    const path = resolve(ROOT, object.source)
    const [info, checksum] = await Promise.all([stat(path), sha256File(path)])
    if (info.size !== object.bytes || checksum !== object.sha256) {
      throw new Error(
        `Allowlist integrity failure for ${object.source}: ` +
          `${info.size}/${checksum} != ${object.bytes}/${object.sha256}`,
      )
    }
    verified.push({ ...object, verified: true })
  }

  if (APPLY) {
    const app = catalyst.initializeApp({})
    const bucket = app.stratus().bucket(
      process.env.KSPCID_STRATUS_BUCKET ?? allowlist.bucket,
    )
    for (const object of selected) {
      await bucket.putObject(object.object_key, createReadStream(resolve(ROOT, object.source)), {
        overwrite: true,
        ...('ttl_seconds' in object ? { ttl: String(object.ttl_seconds) } : {}),
        contentType: object.content_type,
        metaData: {
          sha256: object.sha256,
          allowlist: allowlist.allowlist_version,
        },
      })
      process.stdout.write(`uploaded ${object.object_key} (${object.bytes} bytes)\n`)
    }
  } else {
    process.stdout.write(
      `Validated ${verified.length} Stratus objects against allowlist ${allowlist.allowlist_version}` +
        `${INCLUDE_PUBLICATION ? ' including ephemeral publication inputs' : ''}; dry run only.\n`,
    )
  }

  const output = resolve(ROOT, '.staging', 'cloud', 'stratus-manifest.json')
  await mkdir(resolve(ROOT, '.staging', 'cloud'), { recursive: true })
  await writeFile(
    output,
    `${JSON.stringify(
      {
        allowlist_version: allowlist.allowlist_version,
        bucket: process.env.KSPCID_STRATUS_BUCKET ?? allowlist.bucket,
        applied: APPLY,
        objects: verified,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

await main()
