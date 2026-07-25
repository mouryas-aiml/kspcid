/** Acceptance checks for A19b stored optimizer and offline demo snapshot. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { optimizeDeployment } from '../client/src/lib/patrol/optimizer.js'
import type {
  HexIndex,
  PatrolData,
  PatrolScenario,
  PrecomputedOptimizerFallback,
  RoutingRegion,
} from '../client/src/lib/patrol/types.js'
import { OUTPUT } from './00_config.js'
import { sha256File } from './lib/hash.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function main(): Promise<void> {
  const snapshotPath = resolve(OUTPUT.scenarios, '..', 'offline', 'demo_snapshot.json')
  const fallbackPath = resolve(OUTPUT.scenarios, 'optimizer_fallback.json')
  const [snapshot, fallback, region, hexIndex, scenario, durationBytes, coverageBytes, worker] =
    await Promise.all([
      json<{
        demo_mode: string
        routes: string[]
        artifacts: Array<{ id: string; url: string; sha256: string; bytes: number; required: boolean }>
        optimizer_contract: { live_timeout_ms: number; fallback_url: string; fallback_sha256: string }
      }>(snapshotPath),
      json<PrecomputedOptimizerFallback>(fallbackPath),
      json<RoutingRegion>(resolve(OUTPUT.routing, 'corridor_region.json')),
      json<HexIndex>(resolve(OUTPUT.routing, 'hex_index.json')),
      json<PatrolScenario>(resolve(OUTPUT.scenarios, 'demo_corridor_patrol.json')),
      readFile(resolve(OUTPUT.routing, 'duration_matrix.bin')),
      readFile(resolve(OUTPUT.routing, 'coverage_bitsets.bin')),
      readFile(resolve('client/public/offline-sw.js'), 'utf8'),
    ])
  assert(snapshot.demo_mode === 'offline', 'Snapshot mode must be offline')
  assert(snapshot.routes.length === 7, 'Expected the seven-screen offline path')
  assert(snapshot.artifacts.length === 11 && snapshot.artifacts.every((artifact) => artifact.required), 'Offline artifact contract incomplete')
  assert(snapshot.optimizer_contract.live_timeout_ms === 2_000, 'Optimizer timeout drift')
  assert(fallback.source === 'precomputed_fallback' && fallback.timeout_ms === 2_000, 'Stored fallback label/timeout drift')
  assert(Object.keys(fallback.deployment).length === scenario.roster.length, 'Stored deployment roster mismatch')
  assert(fallback.scenario_id === scenario.scenario_id, 'Stored deployment scenario mismatch')

  const localPath = (url: string): string => {
    if (url.startsWith('/data/graph/')) return resolve(OUTPUT.derived, url.slice('/data/graph/'.length))
    return resolve('data', url.slice('/data/'.length))
  }
  for (const artifact of snapshot.artifacts) {
    const path = localPath(artifact.url)
    const bytes = await readFile(path)
    assert(bytes.byteLength === artifact.bytes, `Offline artifact byte-size drift: ${artifact.id}`)
    assert((await sha256File(path)) === artifact.sha256, `Offline artifact checksum drift: ${artifact.id}`)
    assert(worker.includes(`'${artifact.url}'`), `Service worker does not pre-cache ${artifact.id}`)
  }
  for (const route of snapshot.routes) {
    assert(worker.includes(`'${route}'`), `Service worker does not pre-cache route ${route}`)
  }
  const durationCopy = Uint8Array.from(durationBytes)
  const coverageCopy = Uint8Array.from(coverageBytes)
  const data = {
    region,
    hexIndex,
    scenario,
    durations: new Float32Array(durationCopy.buffer),
    coverage: new Uint32Array(coverageCopy.buffer),
    fallback,
  } satisfies PatrolData
  const fresh = optimizeDeployment(data, fallback.target_minutes, fallback.reserve_units)
  assert(
    JSON.stringify(fresh.deployment) === JSON.stringify(fallback.deployment),
    'Stored deployment does not match deterministic optimizer',
  )
  assert(fresh.score.total === fallback.score.total && fallback.score.total === 913, 'Stored optimizer score drift')
  assert((await sha256File(fallbackPath)) === snapshot.optimizer_contract.fallback_sha256, 'Fallback checksum contract drift')
  process.stdout.write(
    `verify:offline — PASS\n` +
      `  stored score        ${fallback.score.total}\n` +
      `  fallback units      ${Object.keys(fallback.deployment).length}\n` +
      `  routes / artifacts  ${snapshot.routes.length} / ${snapshot.artifacts.length}\n` +
      `  live timeout        ${fallback.timeout_ms} ms\n` +
      `  service worker      cache contract complete\n`,
  )
}

await main()
