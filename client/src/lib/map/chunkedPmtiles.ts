import type { RangeResponse, Source } from 'pmtiles'

interface ChunkManifest {
  readonly version: number
  readonly bytes: number
  readonly chunk_size: number
  readonly chunk_count: number
  readonly sha256: string
}

/**
 * Range-compatible PMTiles source over ordinary static files.
 *
 * Catalyst Web Client Hosting ignores HTTP Range. The PMTiles archive is
 * therefore deployed as immutable 256 KiB pieces and only the pieces covering
 * a requested byte range are fetched. The PMTiles decoder still reads the
 * original byte stream, so no vector tile, label, zoom, or geometry is lost.
 */
export class ChunkedPmtilesSource implements Source {
  private readonly chunks = new Map<number, Promise<ArrayBuffer>>()
  private readonly manifest: Promise<ChunkManifest>

  constructor(
    private readonly key: string,
    private readonly baseUrl: string,
  ) {
    this.manifest = fetch(`${baseUrl}/manifest.json`, { cache: 'force-cache' }).then(
      async (response) => {
        if (!response.ok) throw new Error(`PMTiles manifest HTTP ${response.status}`)
        return response.json() as Promise<ChunkManifest>
      },
    )
    // These chunks contain the archive header/root directory and the tiles for
    // the default city view. Fetch them concurrently: waiting for PMTiles to
    // discover 2 and 3 after parsing 0 adds another full Catalyst round trip.
    void this.manifest.then(() =>
      Promise.all([0, 2, 3].map((index) => this.loadChunk(index))),
    )
  }

  getKey(): string {
    return this.key
  }

  private loadChunk(index: number): Promise<ArrayBuffer> {
    const existing = this.chunks.get(index)
    if (existing) return existing
    const request = fetch(`${this.baseUrl}/${String(index).padStart(4, '0')}.bin`, {
      cache: 'force-cache',
    }).then(async (response) => {
      if (!response.ok) throw new Error(`PMTiles chunk ${index} HTTP ${response.status}`)
      return response.arrayBuffer()
    })
    this.chunks.set(index, request)
    return request
  }

  async getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<RangeResponse> {
    const manifest = await this.manifest
    signal?.throwIfAborted()
    if (offset < 0 || length < 0 || offset + length > manifest.bytes) {
      throw new RangeError(`PMTiles range ${offset}+${length} exceeds ${manifest.bytes}`)
    }

    const first = Math.floor(offset / manifest.chunk_size)
    const last = Math.floor((offset + length - 1) / manifest.chunk_size)
    const indices = Array.from({ length: last - first + 1 }, (_, index) => first + index)
    const parts = await Promise.all(indices.map((index) => this.loadChunk(index)))
    signal?.throwIfAborted()

    const combined = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
    let cursor = 0
    for (const part of parts) {
      combined.set(new Uint8Array(part), cursor)
      cursor += part.byteLength
    }
    const relativeOffset = offset - first * manifest.chunk_size
    return {
      data: combined.buffer.slice(relativeOffset, relativeOffset + length),
      cacheControl: 'public, max-age=31536000, immutable',
    }
  }
}
