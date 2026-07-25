/**
 * A0b — detached full routing build orchestrator.
 *
 * Builds, sequentially and resumably:
 *   - 10 named regional scenario zones (anchor station + neighbours + 2 km)
 *   - local matrices for every station not serving as a scenario anchor
 *   - 3 superzones for central, north/airport, and east/ORR event operations
 *   - 500 live OSRM validation re-queries for every output region
 *
 * Each region invokes the same compiler as A0a. A failed region is logged and
 * the build continues; the aggregate validation is marked FAIL at the end.
 *
 * Run detached via `scripts/start-full-routing.mjs`; never wait for it in the
 * foreground while frontend work can proceed.
 */
import { spawn } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { APP_ROOT, INPUT, OUTPUT } from './00_config.js'
import { GENERATION_VERSION, sha256File } from './lib/hash.js'
import { recordOutput } from './lib/manifest.js'

interface StationFeature {
  readonly properties: {
    readonly station_code: string
    readonly station_name: string
  }
}

interface Adjacency {
  readonly [stationCode: string]: readonly string[]
}

interface RegionDefinition {
  readonly id: string
  readonly name: string
  readonly tier: 'regional' | 'local' | 'superzone'
  readonly stationCodes: readonly string[]
  readonly bufferKm: number
}

interface RegionValidation {
  readonly status: 'PASS' | 'FAIL'
  readonly samples: number
  readonly median_duration_error_percent: number
  readonly max_duration_error_percent: number
  readonly disconnected_pairs: number
}

const VALIDATION_PAIRS = 500
const FULL_ROOT = resolve(OUTPUT.routing, 'full')
const PLAN_PATH = resolve(FULL_ROOT, 'build_plan.json')
const VALIDATION_PATH = resolve(FULL_ROOT, 'validation.json')
const FORCE = process.env.KSPCID_ROUTING_FORCE === '1'

const REGIONAL_SEEDS: ReadonlyArray<{
  id: string
  name: string
  anchors: readonly string[]
}> = [
  {
    id: 'demo_corridor',
    name: 'Kadugondana Halli → Banaswadi → Ramamurthy Nagar → K.R. Puram',
    anchors: ['PSB-92', 'PSB-89', 'PSB-93', 'PSB-741'],
  },
  { id: 'chinnaswamy', name: 'Chinnaswamy event zone', anchors: ['PSB-79'] },
  { id: 'mg_brigade', name: 'MG Road / Brigade Road', anchors: ['PSB-795'] },
  { id: 'majestic', name: 'Majestic / KSR', anchors: ['PSB-157'] },
  { id: 'kr_market', name: 'KR Market / Chickpet', anchors: ['PSB-154'] },
  { id: 'electronic_city', name: 'Electronic City corridor', anchors: ['PSB-144'] },
  { id: 'whitefield', name: 'Whitefield corridor', anchors: ['PSB-744'] },
  { id: 'airport_approach', name: 'Yelahanka / Airport approach', anchors: ['PSB-128'] },
  { id: 'tumakuru_road', name: 'Peenya / Tumakuru Road', anchors: ['PSB-111'] },
  { id: 'hosur_road', name: 'Madiwala / Hosur Road', anchors: ['PSB-151-01'] },
]

function expandWithNeighbours(
  anchors: readonly string[],
  adjacency: Adjacency,
): string[] {
  const codes = new Set(anchors)
  for (const anchor of anchors) {
    for (const neighbour of adjacency[anchor] ?? []) codes.add(neighbour)
  }
  return [...codes].sort()
}

async function alreadyPassed(outputDir: string): Promise<boolean> {
  if (FORCE) return false
  try {
    await access(resolve(outputDir, 'duration_matrix.bin'))
    const [validation, region] = await Promise.all([
      readFile(resolve(outputDir, 'validation.json'), 'utf8').then(
        (value) => JSON.parse(value) as RegionValidation,
      ),
      readFile(resolve(outputDir, 'region.json'), 'utf8').then(
        (value) => JSON.parse(value) as { cells: number },
      ),
    ])
    const expectedSamples = Math.min(
      VALIDATION_PAIRS,
      region.cells * (region.cells - 1),
    )
    return validation.status === 'PASS' && validation.samples === expectedSamples
  } catch {
    return false
  }
}

function runRegion(definition: RegionDefinition, outputDir: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', resolve(APP_ROOT, 'etl/08_routing_matrix.ts')],
      {
        cwd: APP_ROOT,
        env: {
          ...process.env,
          KSPCID_ROUTING_REGION_ID: definition.id,
          KSPCID_ROUTING_REGION_NAME: definition.name,
          KSPCID_ROUTING_SCOPE: `A0b_full_${definition.tier}`,
          KSPCID_ROUTING_STATION_CODES: definition.stationCodes.join(','),
          KSPCID_ROUTING_BUFFER_KM: String(definition.bufferKm),
          KSPCID_ROUTING_VALIDATION_PAIRS: String(VALIDATION_PAIRS),
          KSPCID_ROUTING_OUTPUT_DIR: outputDir,
        },
        stdio: 'inherit',
      },
    )
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${definition.id} exited ${code ?? signal ?? 'unknown'}`))
    })
  })
}

async function main(): Promise<void> {
  const geoRaw = await readFile(INPUT.jurisdictions, 'utf8')
  const adjacencyPath = resolve(OUTPUT.derived, 'station_adjacency.json')
  const adjacencyRaw = await readFile(adjacencyPath, 'utf8')
  const collection = JSON.parse(geoRaw) as { features: StationFeature[] }
  const adjacency = JSON.parse(adjacencyRaw) as Adjacency
  const byCode = new Map(
    collection.features.map(({ properties }) => [
      properties.station_code,
      properties.station_name,
    ]),
  )

  const anchorCodes = new Set(REGIONAL_SEEDS.flatMap(({ anchors }) => anchors))
  const regional: RegionDefinition[] = REGIONAL_SEEDS.map((seed) => ({
    id: seed.id,
    name: seed.name,
    tier: 'regional',
    stationCodes: expandWithNeighbours(seed.anchors, adjacency),
    bufferKm: 2,
  }))
  const local: RegionDefinition[] = [...byCode.entries()]
    .filter(([code]) => !anchorCodes.has(code))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, name]) => ({
      id: `local_${code.toLowerCase().replaceAll('-', '_')}`,
      name: `${name} local routing region`,
      tier: 'local',
      stationCodes: [code],
      bufferKm: 0,
    }))
  const superzones: RegionDefinition[] = [
    {
      id: 'superzone_central_events',
      name: 'Central events superzone',
      tier: 'superzone',
      stationCodes: expandWithNeighbours(['PSB-79', 'PSB-795', 'PSB-154'], adjacency),
      bufferKm: 2,
    },
    {
      id: 'superzone_north_airport',
      name: 'North / airport superzone',
      tier: 'superzone',
      stationCodes: expandWithNeighbours(['PSB-128', 'PSB-127-02'], adjacency),
      bufferKm: 2,
    },
    {
      id: 'superzone_east_orr',
      name: 'East / ORR superzone',
      tier: 'superzone',
      stationCodes: expandWithNeighbours(
        ['PSB-92', 'PSB-89', 'PSB-93', 'PSB-741', 'PSB-744'],
        adjacency,
      ),
      bufferKm: 2,
    },
  ]
  const definitions = [...regional, ...superzones, ...local]
  const covered = new Set(definitions.flatMap(({ stationCodes }) => stationCodes))
  const missing = [...byCode.keys()].filter((code) => !covered.has(code))
  if (missing.length > 0) throw new Error(`Routing plan misses stations: ${missing.join(', ')}`)

  await mkdir(FULL_ROOT, { recursive: true })
  const plan = {
    mode: 'full',
    validation_pairs_per_region: VALIDATION_PAIRS,
    osrm_url: process.env.KSPCID_OSRM_URL ?? 'http://localhost:5001',
    tiers: {
      regional: regional.length,
      local: local.length,
      superzone: superzones.length,
    },
    all_106_station_polygons_covered: covered.size >= byCode.size,
    definitions,
    source_authority: 'official_open_data',
    transformation: 'derived',
    method: 'routing_region_plan_v1',
    generation_version: GENERATION_VERSION,
  }
  await writeFile(PLAN_PATH, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
  const inputs = [
    { path: INPUT.jurisdictions, sha256: await sha256File(INPUT.jurisdictions) },
    { path: adjacencyPath, sha256: await sha256File(adjacencyPath) },
  ]
  await recordOutput('08_full_routing_plan', PLAN_PATH, definitions.length, inputs)

  const results: Array<{
    id: string
    tier: RegionDefinition['tier']
    status: 'PASS' | 'FAIL'
    message?: string
    validation?: RegionValidation
  }> = []

  for (let index = 0; index < definitions.length; index++) {
    const definition = definitions[index]!
    const outputDir = resolve(FULL_ROOT, definition.tier, definition.id)
    process.stdout.write(
      `\nA0b ${index + 1}/${definitions.length} · ${definition.tier}/${definition.id}\n`,
    )
    if (await alreadyPassed(outputDir)) {
      const validation = JSON.parse(
        await readFile(resolve(outputDir, 'validation.json'), 'utf8'),
      ) as RegionValidation
      results.push({ id: definition.id, tier: definition.tier, status: 'PASS', validation })
      process.stdout.write('  resume: existing PASS retained\n')
      continue
    }
    await mkdir(outputDir, { recursive: true })
    try {
      await runRegion(definition, outputDir)
      const validation = JSON.parse(
        await readFile(resolve(outputDir, 'validation.json'), 'utf8'),
      ) as RegionValidation
      results.push({ id: definition.id, tier: definition.tier, status: 'PASS', validation })
    } catch (error) {
      const message = String(error)
      results.push({ id: definition.id, tier: definition.tier, status: 'FAIL', message })
      process.stderr.write(`A0b region failed; continuing: ${definition.id}: ${message}\n`)
    }
  }

  const failures = results.filter(({ status }) => status === 'FAIL')
  const aggregate = {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    regions_total: definitions.length,
    regions_passed: results.length - failures.length,
    regions_failed: failures.length,
    validation_pairs_per_region: VALIDATION_PAIRS,
    results,
    generation_version: GENERATION_VERSION,
  }
  await writeFile(VALIDATION_PATH, `${JSON.stringify(aggregate, null, 2)}\n`, 'utf8')
  await recordOutput(
    '08_full_routing_validation',
    VALIDATION_PATH,
    results.length,
    inputs,
    {
      status: aggregate.status,
      regions_passed: aggregate.regions_passed,
      regions_failed: aggregate.regions_failed,
    },
  )

  await mkdir(OUTPUT.reports, { recursive: true })
  await writeFile(
    resolve(OUTPUT.reports, 'a0b_full_routing.md'),
    [
      '# A0b — Full routing build',
      '',
      `**${aggregate.status}**`,
      '',
      `- Regional zones: **${regional.length}**`,
      `- Local regions: **${local.length}**`,
      `- Superzones: **${superzones.length}**`,
      `- Passed: **${aggregate.regions_passed} / ${aggregate.regions_total}**`,
      `- Validation per region: **up to 500 live pairs; exhaustive when fewer exist**`,
      '',
      'The build is resumable; existing 500-sample PASS regions are retained.',
      '',
      ...(failures.length > 0
        ? ['## Failures', '', ...failures.map(({ id, message }) => `- ${id}: ${message}`), '']
        : []),
    ].join('\n'),
    'utf8',
  )

  if (failures.length > 0) process.exitCode = 1
}

main().catch((error: unknown) => {
  process.stderr.write(`A0b full routing failed: ${String(error)}\n`)
  process.exitCode = 1
})
