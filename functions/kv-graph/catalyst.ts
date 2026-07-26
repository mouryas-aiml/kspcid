import type { IncomingMessage, ServerResponse } from 'node:http'

import { graphSnapshotWithAdapter } from './index.js'
import {
  withCatalystAdapter,
  writeAioError,
  writeJson,
} from '../runtime/catalyst.js'

const ETAG = '"2f7f98f106971bff1204a5e49f20d5cd2037ead5645f3992a9499224d1322b55"'

export default async function catalystGraph(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: 'GET required' }, { allow: 'GET' })
      return
    }
    if (request.headers['if-none-match'] === ETAG) {
      response.writeHead(304, { etag: ETAG })
      response.end()
      return
    }
    const bytes = await withCatalystAdapter(
      request as unknown as Record<string, unknown>,
      graphSnapshotWithAdapter,
    )
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': bytes.byteLength,
      'cache-control': 'public, max-age=86400, immutable',
      etag: ETAG,
    })
    response.end(Buffer.from(bytes))
  } catch (error) {
    writeAioError(response, error)
  }
}
