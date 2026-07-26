import type { IncomingMessage, ServerResponse } from 'node:http'

import { optimizeWithAdapter } from './index.js'
import {
  readJsonBody,
  writeAioError,
  writeJson,
  withCatalystAdapter,
} from '../runtime/catalyst.js'

export default async function catalystOptimize(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: 'POST required' }, { allow: 'POST' })
      return
    }
    const input = await readJsonBody(request)
    const result = await withCatalystAdapter(
      request as unknown as Record<string, unknown>,
      (adapter) =>
        optimizeWithAdapter(
          {
            scenarioId: String(input['scenarioId']) as 'demo-corridor-patrol-2021-2023-night',
            targetMinutes: Number(input['targetMinutes']) as 3 | 5 | 7 | 10 | 15,
            reserveUnits: Number(input['reserveUnits']),
          },
          adapter,
        ),
    )
    writeJson(response, 200, result, { 'cache-control': 'no-store' })
  } catch (error) {
    writeAioError(response, error)
  }
}
