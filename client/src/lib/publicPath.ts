const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/+$/, '') ?? ''

/** Catalyst Web Client Hosting mounts the static export at this fixed path. */
export const isCatalystClientHosting = basePath === '/app'

/** Resolve a root-relative public asset against the deployment base path. */
export function publicPath(path: string): string {
  return `${basePath}/${path.replace(/^\/+/, '')}`
}

interface CatalystArtifact {
  readonly delivery: 'single' | 'parts'
  readonly compression: 'gzip' | 'shuffle4+gzip'
  readonly bytes: number
  readonly compressed_bytes: number
  readonly chunk_size?: number
  readonly parts?: number
  readonly sha256: string
}

interface CatalystManifest {
  readonly version: number
  readonly artifacts: Readonly<Record<string, CatalystArtifact>>
}

let manifestRequest: Promise<CatalystManifest> | null = null

function catalystManifest(): Promise<CatalystManifest> {
  manifestRequest ??= fetch(publicPath('/data/catalyst-manifest.json')).then(async (response) => {
    if (!response.ok) throw new Error(`Catalyst artifact manifest HTTP ${response.status}`)
    return response.json() as Promise<CatalystManifest>
  })
  return manifestRequest
}

/** Begin the one small manifest request while the landing page is visible. */
export function preloadCatalystArtifacts(): void {
  if (isCatalystClientHosting) void catalystManifest().catch(() => undefined)
}

function byteUnshuffle(buffer: ArrayBuffer, width = 4): ArrayBuffer {
  const shuffled = new Uint8Array(buffer)
  const items = Math.floor(shuffled.length / width)
  const restored = new Uint8Array(shuffled.length)
  for (let byte = 0; byte < width; byte += 1) {
    for (let index = 0; index < items; index += 1) {
      restored[index * width + byte] = shuffled[byte * items + index]!
    }
  }
  restored.set(shuffled.subarray(items * width), items * width)
  return restored.buffer
}

/**
 * Fetch a generated data artifact with explicit lossless compression on
 * Catalyst. JSON/GeoJSON stream through native gzip; four-byte binary matrices
 * also reverse the build-time byte shuffle that improves compression.
 */
export async function fetchPublicArtifact(path: string): Promise<Response> {
  const url = publicPath(path)
  if (!isCatalystClientHosting || typeof DecompressionStream === 'undefined') {
    return fetch(url)
  }

  let artifact: CatalystArtifact | undefined
  try {
    artifact = (await catalystManifest()).artifacts[path]
  } catch {
    return fetch(url)
  }
  if (!artifact) return fetch(url)

  let compressedBytes: Uint8Array
  if (artifact.delivery === 'single') {
    const response = await fetch(`${url}.catalyst.gz`)
    if (!response.ok) return fetch(url)
    compressedBytes = new Uint8Array(await response.arrayBuffer())
  } else {
    const count = artifact.parts ?? 0
    const parts = await Promise.all(
      Array.from({ length: count }, async (_, index) => {
        const response = await fetch(
          `${url}.catalyst-parts/${String(index).padStart(4, '0')}.bin`,
        )
        if (!response.ok) throw new Error(`Catalyst artifact part HTTP ${response.status}`)
        return new Uint8Array(await response.arrayBuffer())
      }),
    )
    compressedBytes = new Uint8Array(
      parts.reduce((total, part) => total + part.byteLength, 0),
    )
    let cursor = 0
    for (const part of parts) {
      compressedBytes.set(part, cursor)
      cursor += part.byteLength
    }
  }

  const compressedStream = new Blob([compressedBytes]).stream()
  const decompressed = compressedStream.pipeThrough(new DecompressionStream('gzip'))
  if (!path.endsWith('.bin')) return new Response(decompressed)

  const shuffled = await new Response(decompressed).arrayBuffer()
  return new Response(byteUnshuffle(shuffled))
}
