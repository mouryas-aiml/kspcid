/**
 * Post-upload Stratus verifier.
 *
 * KSPCID_STRATUS_BASE_URL must be the bucket URL, for example
 * https://<bucket>-development.zohostratus.com. A real HTTP Range request is
 * mandatory because PMTiles cannot operate through a 200/full-object fallback.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

interface Allowlist {
  readonly objects: readonly {
    readonly object_key: string
    readonly bytes: number
    readonly sha256: string
  }[]
}

async function main(): Promise<void> {
  const configured = process.env.KSPCID_STRATUS_BASE_URL
  if (!configured) {
    throw new Error('KSPCID_STRATUS_BASE_URL is required for the post-upload verifier')
  }
  const base = configured.replace(/\/+$/, '')
  const allowlist = JSON.parse(
    await readFile(resolve(ROOT, 'etl', 'cloud', 'allowlist.json'), 'utf8'),
  ) as Allowlist
  for (const object of allowlist.objects) {
    const response = await fetch(`${base}/${object.object_key}`, { method: 'HEAD' })
    if (!response.ok) {
      throw new Error(`HEAD ${object.object_key} failed with HTTP ${response.status}`)
    }
    const length = Number(response.headers.get('content-length'))
    if (length !== object.bytes) {
      throw new Error(
        `${object.object_key} length mismatch: expected ${object.bytes}, found ${length}`,
      )
    }
  }

  const range = await fetch(`${base}/tiles/bengaluru.pmtiles`, {
    headers: { Range: 'bytes=0-127' },
  })
  const body = new Uint8Array(await range.arrayBuffer())
  const contentRange = range.headers.get('content-range')
  if (
    range.status !== 206 ||
    body.byteLength !== 128 ||
    contentRange !== 'bytes 0-127/39135099'
  ) {
    throw new Error(
      `PMTiles range contract failed: HTTP ${range.status}, ` +
        `${body.byteLength} bytes, Content-Range=${contentRange ?? '<missing>'}`,
    )
  }
  process.stdout.write(
    `Stratus verified: ${allowlist.objects.length} objects and PMTiles HTTP 206 range response.\n`,
  )
}

await main()
