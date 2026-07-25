/**
 * A19b — precomputed optimizer fallback and compact offline demo contract.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { optimizeDeployment } from '../client/src/lib/patrol/optimizer.js'
import type {
  HexIndex,
  PatrolData,
  PatrolScenario,
  RoutingRegion,
} from '../client/src/lib/patrol/types.js'
import { OUTPUT } from './00_config.js'
import { GENERATION_VERSION, sha256File } from './lib/hash.js'
import { recordOutput } from './lib/manifest.js'

const FALLBACK_PATH = resolve(OUTPUT.scenarios, 'optimizer_fallback.json')
const OFFLINE_DIR = resolve(OUTPUT.scenarios, '..', 'offline')
const SNAPSHOT_PATH = resolve(OFFLINE_DIR, 'demo_snapshot.json')
const REPORT_PATH = resolve(OUTPUT.reports, 'a19b_offline_fallback.md')

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function typed<T extends Float32Array | Uint32Array>(
  path: string,
  create: (buffer: ArrayBuffer) => T,
): Promise<T> {
  const bytes = await readFile(path)
  const copy = Uint8Array.from(bytes)
  return create(copy.buffer)
}

async function main(): Promise<void> {
  const regionPath = resolve(OUTPUT.routing, 'corridor_region.json')
  const hexPath = resolve(OUTPUT.routing, 'hex_index.json')
  const scenarioPath = resolve(OUTPUT.scenarios, 'demo_corridor_patrol.json')
  const durationPath = resolve(OUTPUT.routing, 'duration_matrix.bin')
  const coveragePath = resolve(OUTPUT.routing, 'coverage_bitsets.bin')
  const [region, hexIndex, scenario, durations, coverage] = await Promise.all([
    json<RoutingRegion>(regionPath),
    json<HexIndex>(hexPath),
    json<PatrolScenario>(scenarioPath),
    typed(durationPath, (buffer) => new Float32Array(buffer)),
    typed(coveragePath, (buffer) => new Uint32Array(buffer)),
  ])
  const data = { region, hexIndex, scenario, durations, coverage } as PatrolData
  const optimized = optimizeDeployment(
    data,
    scenario.planning_defaults.response_target_minutes,
    scenario.planning_defaults.reserve_units,
  )
  const [scenarioChecksum, regionChecksum, coverageChecksum] = await Promise.all([
    sha256File(scenarioPath),
    sha256File(regionPath),
    sha256File(coveragePath),
  ])
  const fallback = {
    schema_version: 1,
    fallback_id: 'demo-corridor-optimizer-default-v1',
    scenario_id: scenario.scenario_id,
    target_minutes: scenario.planning_defaults.response_target_minutes,
    reserve_units: scenario.planning_defaults.reserve_units,
    timeout_ms: 2_000,
    deployment: optimized.deployment,
    score: optimized.score,
    method: optimized.method,
    iterations: optimized.iterations,
    source: 'precomputed_fallback',
    provenance: {
      source_authority: 'generated_demo',
      transformation: 'generated',
      method: 'offline_precomputed_greedy_300_swap_equity_repair',
      source_checksum: scenarioChecksum,
      routing_source_checksum: coverageChecksum,
      generation_version: GENERATION_VERSION,
    },
  }
  await mkdir(OUTPUT.scenarios, { recursive: true })
  await writeFile(FALLBACK_PATH, `${JSON.stringify(fallback, null, 2)}\n`, 'utf8')
  const fallbackChecksum = await sha256File(FALLBACK_PATH)

  const artifactDefinitions = [
    ['feed', resolve(OUTPUT.scenarios, 'command_feed.json'), '/data/scenarios/command_feed.json'],
    ['command_map', resolve(OUTPUT.scenarios, 'command_map.json'), '/data/scenarios/command_map.json'],
    ['patrol_scenario', scenarioPath, '/data/scenarios/demo_corridor_patrol.json'],
    ['optimizer_fallback', FALLBACK_PATH, '/data/scenarios/optimizer_fallback.json'],
    ['similarity', resolve(OUTPUT.scenarios, 'similarity_demo.json'), '/data/scenarios/similarity_demo.json'],
    ['graph', resolve(OUTPUT.derived, 'graph_snapshot.json'), '/data/graph/graph_snapshot.json'],
    ['routing_region', regionPath, '/data/routing/corridor_region.json'],
    ['routing_hexes', hexPath, '/data/routing/hex_index.json'],
    ['routing_durations', durationPath, '/data/routing/duration_matrix.bin'],
    ['routing_coverage', coveragePath, '/data/routing/coverage_bitsets.bin'],
    ['justice_brief', resolve(OUTPUT.scenarios, 'justice_pipeline.json'), '/data/scenarios/justice_pipeline.json'],
    ['cyber_brief', resolve(OUTPUT.scenarios, 'cyber_wing.json'), '/data/scenarios/cyber_wing.json'],
  ] as const
  const artifacts = await Promise.all(
    artifactDefinitions.map(async ([id, path, url]) => ({
      id,
      url,
      sha256: await sha256File(path),
      bytes: (await readFile(path)).byteLength,
      required: true,
    })),
  )
  const snapshot = {
    schema_version: 1,
    snapshot_id: 'six-minute-offline-demo-v1',
    demo_mode: 'offline',
    routes: ['/feed/', '/map/', '/similarity/', '/network/', '/patrol/', '/justice/', '/cyber/'],
    artifacts,
    map_explanation: {
      signal: 'Of Automobiles - Of Two Wheelers',
      corridor: 'Kadugondana Halli → Banaswadi → Ramamurthy Nagar → K.R. Puram',
      routing_validation: 'PASS',
      transformation: 'derived',
      scenario_id: scenario.scenario_id,
    },
    brief_preview: {
      observed_records: 425_408,
      undetected: 92_874,
      cyber_records: 64_599,
      transformation: 'normalized',
    },
    service_worker: '/offline-sw.js',
    optimizer_contract: {
      live_timeout_ms: 2_000,
      fallback_url: '/data/scenarios/optimizer_fallback.json',
      fallback_sha256: fallbackChecksum,
    },
    provenance: {
      source_authority: 'generated_demo',
      transformation: 'generated',
      method: 'offline_demo_manifest_v1',
      source_checksum: regionChecksum,
      generation_version: GENERATION_VERSION,
    },
  }
  await mkdir(OFFLINE_DIR, { recursive: true })
  await writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  await recordOutput(
    '19b_optimizer_fallback',
    FALLBACK_PATH,
    Object.keys(fallback.deployment).length,
    [
      { path: scenarioPath, sha256: scenarioChecksum },
      { path: coveragePath, sha256: coverageChecksum },
    ],
    { target_minutes: fallback.target_minutes, reserve_units: fallback.reserve_units, score: fallback.score.total },
  )
  await recordOutput(
    '19b_offline_snapshot',
    SNAPSHOT_PATH,
    artifacts.length,
    artifacts.map((artifact, index) => ({
      path: artifactDefinitions[index]![1],
      sha256: artifact.sha256,
    })),
    { routes: snapshot.routes.length, demo_mode: snapshot.demo_mode },
  )
  const snapshotChecksum = await sha256File(SNAPSHOT_PATH)
  await mkdir(OUTPUT.reports, { recursive: true })
  await writeFile(
    REPORT_PATH,
    `# A19b Offline Fallback\n\n` +
      `- Precomputed plan score: **${fallback.score.total}**\n` +
      `- Units in stored deployment: **${Object.keys(fallback.deployment).length}**\n` +
      `- Live optimizer timeout: **${fallback.timeout_ms} ms**\n` +
      `- Offline routes: **${snapshot.routes.length}**\n` +
      `- Offline artifact contracts: **${artifacts.length}**\n` +
      `- Fallback SHA-256: \`${fallbackChecksum}\`\n` +
      `- Snapshot SHA-256: \`${snapshotChecksum}\`\n\n` +
      `The bundle is a same-schema static fallback. It contains no Catalyst credentials and makes no deployment claim.\n`,
    'utf8',
  )
  process.stdout.write(
    `A19b · stored score ${fallback.score.total} · ${artifacts.length} artifacts · ${snapshot.routes.length} routes\n`,
  )
}

await main()
