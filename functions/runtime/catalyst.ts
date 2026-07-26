import type { IncomingMessage, ServerResponse } from 'node:http'

import { CatalystAdapter } from '../shared/data-access/catalyst-adapter.js'
import type { DataAdapter } from '../shared/data-access/types.js'

export interface CatalystContext extends Record<string, unknown> {
  readonly close?: () => void
  readonly closeWithSuccess?: () => void
  readonly closeWithFailure?: () => void
}

export interface BasicIO {
  readonly getAllArguments: () => Record<string, unknown>
  readonly setStatus: (statusCode: number) => void
  readonly write: (value: string) => void
}

export type BasicHandler = (
  context: CatalystContext,
  basicIO: BasicIO,
) => Promise<void>

export async function withCatalystAdapter<T>(
  context: Record<string, unknown>,
  operation: (adapter: DataAdapter) => Promise<T>,
): Promise<T> {
  const adapter = new CatalystAdapter({ context })
  try {
    return await operation(adapter)
  } finally {
    await adapter.close()
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected function failure'
}

export function stringValue(
  input: Record<string, unknown>,
  key: string,
  required = false,
): string | undefined {
  const value = input[key]
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${key} is required`)
    return undefined
  }
  if (typeof value !== 'string') return String(value)
  return value
}

export function numberValue(
  input: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = stringValue(input, key)
  if (value === undefined) return undefined
  const result = Number(value)
  if (!Number.isFinite(result)) throw new Error(`${key} must be a finite number`)
  return result
}

export function booleanValue(
  input: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = input[key]
  if (value === undefined || value === null || value === '') return undefined
  if (value === true || value === 'true' || value === '1') return true
  if (value === false || value === 'false' || value === '0') return false
  throw new Error(`${key} must be true or false`)
}

export function jsonValue<T>(
  input: Record<string, unknown>,
  key: string,
): T | undefined {
  const value = input[key]
  if (value === undefined || value === null || value === '') return undefined
  return (typeof value === 'string' ? JSON.parse(value) : value) as T
}

export function createBasicHandler(
  operation: (
    input: Record<string, unknown>,
    context: CatalystContext,
  ) => Promise<unknown>,
): BasicHandler {
  return async (context, basicIO) => {
    try {
      const result = await operation(basicIO.getAllArguments(), context)
      basicIO.write(JSON.stringify(result))
    } catch (error) {
      basicIO.setStatus(500)
      basicIO.write(JSON.stringify({ error: errorMessage(error) }))
    } finally {
      context.close?.()
    }
  }
}

export async function readJsonBody(
  request: IncomingMessage,
  maximumBytes = 1_048_576,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > maximumBytes) throw new Error('Request body exceeds 1 MiB')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Request body must be a JSON object')
  }
  return value as Record<string, unknown>
}

export function writeJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Readonly<Record<string, string | number>> = {},
): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers,
  })
  response.end(body)
}

export function writeAioError(response: ServerResponse, error: unknown): void {
  writeJson(response, 500, { error: errorMessage(error) })
}
