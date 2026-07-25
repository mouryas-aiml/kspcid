/**
 * 08 — OSRM routing compiler (BUILD_SPEC §6.4 step 08, §8.4).
 *
 * The default `corridor` mode is A0a: the audited four-station demo spine plus
 * a 2 km buffer, compiled into:
 *   - H3 r9 index
 *   - free-flow Float32 duration matrix
 *   - five origin × budget coverage bitset tables
 *   - deterministic live-OSRM validation sample
 *
 * Congestion is deliberately absent from stored durations. Patrol Lab applies
 * its hour/rain/closure multipliers at runtime.
 *
 * This compiler talks to the already-running local OSRM container. It never
 * starts, rebuilds, or configures OSRM.
 *
 *   npm run etl:08:corridor
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  booleanPointInPolygon,
  buffer,
  featureCollection,
  point,
  union,
} from '@turf/turf'
import { cellToLatLng, polygonToCells } from 'h3-js'
import type {
  Feature,
  FeatureCollection as GeoFeatureCollection,
  MultiPolygon,
  Polygon,
} from 'geojson'

import { DEMO_SPINE, INPUT, OUTPUT } from './00_config.js'
import { GENERATION_VERSION, sha256File, stableIndex } from './lib/hash.js'
import { recordOutput } from './lib/manifest.js'

const OSRM_URL = process.env.KSPCID_OSRM_URL ?? 'http://localhost:5001'
const RESOLUTION = 9
const BUFFER_KM = Number(process.env.KSPCID_ROUTING_BUFFER_KM ?? 2)
const RESPONSE_BUDGETS_SECONDS = [180, 300, 420, 600, 900] as const
const SOURCE_CHUNK = 64
const DESTINATION_CHUNK = 512
const VALIDATION_PAIRS = Number(process.env.KSPCID_ROUTING_VALIDATION_PAIRS ?? 100)
const REGION_ID = process.env.KSPCID_ROUTING_REGION_ID ?? 'demo_corridor'
const REGION_NAME =
  process.env.KSPCID_ROUTING_REGION_NAME ??
  'Kadugondana Halli → Banaswadi → Ramamurthy Nagar → K.R. Puram'
const REGION_SCOPE =
  process.env.KSPCID_ROUTING_SCOPE ?? 'A0a_one_corridor_fixture'
const REGION_STATION_CODES = new Set(
  (process.env.KSPCID_ROUTING_STATION_CODES ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
)
const ROUTING_DIR = resolve(
  process.env.KSPCID_ROUTING_OUTPUT_DIR ?? OUTPUT.routing,
)

const HEX_INDEX_PATH = resolve(ROUTING_DIR, 'hex_index.json')
const MATRIX_PATH = resolve(ROUTING_DIR, 'duration_matrix.bin')
const BITSETS_PATH = resolve(ROUTING_DIR, 'coverage_bitsets.bin')
const REGION_PATH = resolve(
  ROUTING_DIR,
  process.env.KSPCID_ROUTING_OUTPUT_DIR ? 'region.json' : 'corridor_region.json',
)
const VALIDATION_PATH = resolve(ROUTING_DIR, 'validation.json')
const REPORT_PATH = resolve(
  OUTPUT.reports,
  REGION_SCOPE === 'A0a_one_corridor_fixture'
    ? 'a0a_routing_fixture.md'
    : `routing_${REGION_ID}.md`,
)

interface StationProperties {
  readonly station_name: string
  readonly station_code: string
  readonly police_division: string
  readonly subdivision: string
}

type StationFeature = Feature<Polygon | MultiPolygon, StationProperties>
type FeatureCollection = GeoFeatureCollection<Polygon | MultiPolygon, StationProperties>

interface OsrmWaypoint {
  readonly distance: number
  readonly name: string
  readonly location: readonly [number, number]
}

interface TableResponse {
  readonly code: string
  readonly durations: Array<Array<number | null>>
  readonly sources: OsrmWaypoint[]
  readonly destinations: OsrmWaypoint[]
  readonly message?: string
}

interface RouteResponse {
  readonly code: string
  readonly routes: Array<{ duration: number; distance: number }>
  readonly waypoints: OsrmWaypoint[]
  readonly message?: string
}

interface HexEntry {
  readonly index: number
  readonly h3: string
  readonly latitude: number
  readonly longitude: number
  readonly core_station_code: string | null
  readonly core_station_name: string | null
}

interface ValidationPair {
  readonly from: number
  readonly to: number
  readonly from_h3: string
  readonly to_h3: string
  readonly from_station: string | null
  readonly to_station: string | null
  readonly matrix_seconds: number
  readonly live_seconds: number
  readonly error_percent: number
  readonly route_distance_m: number
  readonly max_snap_distance_m: number
}

function coordinateText(entry: HexEntry): string {
  return `${entry.longitude.toFixed(6)},${entry.latitude.toFixed(6)}`
}

function coordinatePairText(coordinate: readonly [number, number]): string {
  return `${coordinate[0].toFixed(6)},${coordinate[1].toFixed(6)}`
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`OSRM HTTP ${response.status}: ${await response.text()}`)
  return (await response.json()) as T
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0)
}

function coreStation(
  longitude: number,
  latitude: number,
  features: readonly StationFeature[],
): StationFeature | null {
  const candidate = point([longitude, latitude])
  return (
    features.find((feature) =>
      booleanPointInPolygon(candidate, feature as Parameters<typeof booleanPointInPolygon>[1]),
    ) ?? null
  )
}

function makeValidationPairs(cells: number): Array<readonly [number, number]> {
  const pairs: Array<readonly [number, number]> = []
  const seen = new Set<string>()
  let probe = 0
  while (pairs.length < Math.min(VALIDATION_PAIRS, cells * (cells - 1))) {
    const from = stableIndex('routing_validation', REGION_ID, `from:${probe}`, cells)
    const to = stableIndex('routing_validation', REGION_ID, `to:${probe}`, cells)
    probe++
    if (from === to) continue
    const key = `${from}:${to}`
    if (seen.has(key)) continue
    seen.add(key)
    pairs.push([from, to])
  }
  return pairs
}

async function compileMatrix(entries: readonly HexEntry[]): Promise<{
  matrix: Float32Array
  maxSnapDistance: number
  snappedCoordinates: Array<readonly [number, number]>
}> {
  const size = entries.length
  const matrix = new Float32Array(size * size)
  let maxSnapDistance = 0
  const snappedCoordinates: Array<readonly [number, number]> = entries.map(
    (entry) => [entry.longitude, entry.latitude] as const,
  )

  for (let start = 0; start < size; start += SOURCE_CHUNK) {
    const end = Math.min(size, start + SOURCE_CHUNK)
    const sourceEntries = entries.slice(start, end)
    for (
      let destinationStart = 0;
      destinationStart < size;
      destinationStart += DESTINATION_CHUNK
    ) {
      const destinationEnd = Math.min(size, destinationStart + DESTINATION_CHUNK)
      const destinationEntries = entries.slice(destinationStart, destinationEnd)
      const coordinates = [...sourceEntries, ...destinationEntries]
        .map(coordinateText)
        .join(';')
      const sources = Array.from(
        { length: sourceEntries.length },
        (_, offset) => offset,
      ).join(';')
      const destinations = Array.from(
        { length: destinationEntries.length },
        (_, offset) => sourceEntries.length + offset,
      ).join(';')
      const url =
        `${OSRM_URL}/table/v1/driving/${coordinates}` +
        `?annotations=duration&sources=${sources}&destinations=${destinations}`
      const response = await fetchJson<TableResponse>(url)
      if (response.code !== 'Ok') {
        throw new Error(`OSRM table failed: ${response.code} ${response.message ?? ''}`)
      }
      for (const waypoint of [...response.sources, ...response.destinations]) {
        if (!Number.isFinite(waypoint.distance)) {
          throw new Error('OSRM failed to snap a grid cell')
        }
        maxSnapDistance = Math.max(maxSnapDistance, waypoint.distance)
      }
      response.sources.forEach((waypoint, index) => {
        snappedCoordinates[start + index] = waypoint.location
      })
      response.destinations.forEach((waypoint, index) => {
        snappedCoordinates[destinationStart + index] = waypoint.location
      })
      for (let local = 0; local < response.durations.length; local++) {
        const row = response.durations[local]
        if (!row || row.length !== destinationEntries.length) {
          throw new Error('OSRM returned a truncated matrix row')
        }
        const origin = start + local
        for (let destinationOffset = 0; destinationOffset < row.length; destinationOffset++) {
          const duration = row[destinationOffset]
          const destination = destinationStart + destinationOffset
          if (duration === null || duration === undefined || !Number.isFinite(duration)) {
            throw new Error(`Disconnected OSRM pair ${origin} → ${destination}`)
          }
          matrix[origin * size + destination] = duration
        }
      }
    }
    process.stdout.write(`  … matrix origins ${end.toLocaleString()} / ${size.toLocaleString()}\n`)
  }
  return { matrix, maxSnapDistance, snappedCoordinates }
}

function compileBitsets(matrix: Float32Array, cells: number): {
  readonly bitsets: Uint32Array
  readonly words: number
} {
  const words = Math.ceil(cells / 32)
  const bitsets = new Uint32Array(cells * RESPONSE_BUDGETS_SECONDS.length * words)
  for (let origin = 0; origin < cells; origin++) {
    for (let destination = 0; destination < cells; destination++) {
      const duration = matrix[origin * cells + destination] ?? Number.POSITIVE_INFINITY
      for (let budget = 0; budget < RESPONSE_BUDGETS_SECONDS.length; budget++) {
        if (duration > RESPONSE_BUDGETS_SECONDS[budget]!) continue
        const base = (origin * RESPONSE_BUDGETS_SECONDS.length + budget) * words
        const wordIndex = base + (destination >>> 5)
        bitsets[wordIndex] = (bitsets[wordIndex] ?? 0) | (1 << (destination & 31))
      }
    }
  }
  return { bitsets, words }
}

async function validate(
  entries: readonly HexEntry[],
  matrix: Float32Array,
  snappedCoordinates: ReadonlyArray<readonly [number, number]>,
): Promise<{
  readonly pairs: ValidationPair[]
  readonly medianErrorPercent: number
  readonly maxErrorPercent: number
  readonly oneWayAsymmetryPairs: number
  readonly crossBoundaryPairs: number
}> {
  const pairs: ValidationPair[] = []
  let oneWayAsymmetryPairs = 0
  let crossBoundaryPairs = 0
  for (const [from, to] of makeValidationPairs(entries.length)) {
    const fromEntry = entries[from]!
    const toEntry = entries[to]!
    const url =
      `${OSRM_URL}/route/v1/driving/${coordinatePairText(snappedCoordinates[from]!)};` +
      `${coordinatePairText(snappedCoordinates[to]!)}` +
      '?overview=false&steps=false&alternatives=false'
    const response = await fetchJson<RouteResponse>(url)
    if (response.code !== 'Ok' || !response.routes[0]) {
      throw new Error(`OSRM validation route failed for ${from} → ${to}`)
    }
    const matrixSeconds = matrix[from * entries.length + to]!
    const liveSeconds = response.routes[0].duration
    const errorPercent =
      liveSeconds > 0 ? (100 * Math.abs(matrixSeconds - liveSeconds)) / liveSeconds : 0
    if (
      Math.abs(
        matrix[from * entries.length + to]! - matrix[to * entries.length + from]!,
      ) > 1
    ) {
      oneWayAsymmetryPairs++
    }
    if (
      fromEntry.core_station_code !== null &&
      toEntry.core_station_code !== null &&
      fromEntry.core_station_code !== toEntry.core_station_code
    ) {
      crossBoundaryPairs++
    }
    pairs.push({
      from,
      to,
      from_h3: fromEntry.h3,
      to_h3: toEntry.h3,
      from_station: fromEntry.core_station_code,
      to_station: toEntry.core_station_code,
      matrix_seconds: matrixSeconds,
      live_seconds: liveSeconds,
      error_percent: errorPercent,
      route_distance_m: response.routes[0].distance,
      max_snap_distance_m: Math.max(...response.waypoints.map(({ distance }) => distance)),
    })
  }
  const errors = pairs.map(({ error_percent }) => error_percent)
  return {
    pairs,
    medianErrorPercent: median(errors),
    maxErrorPercent: Math.max(...errors),
    oneWayAsymmetryPairs,
    crossBoundaryPairs,
  }
}

async function main(): Promise<void> {
  const started = Date.now()
  const raw = await readFile(INPUT.jurisdictions, 'utf8')
  const collection = JSON.parse(raw) as FeatureCollection
  const names = new Set<string>(DEMO_SPINE.stations)
  const core = collection.features.filter(({ properties }) =>
    REGION_STATION_CODES.size > 0
      ? REGION_STATION_CODES.has(properties.station_code)
      : names.has(properties.station_name),
  )
  const expected = REGION_STATION_CODES.size || DEMO_SPINE.stations.length
  if (core.length !== expected) {
    throw new Error(`Expected ${expected} region polygons, found ${core.length}`)
  }

  // Turf's union operation intentionally rejects a collection with fewer than
  // two geometries. Local A0b regions contain exactly one jurisdiction, so use
  // that source feature verbatim; multi-station regions still require a union.
  const merged =
    core.length === 1
      ? core[0]!
      : union(featureCollection(core) as Parameters<typeof union>[0])
  if (!merged) throw new Error('Corridor polygon union is empty')
  const buffered = buffer(merged, BUFFER_KM, { units: 'kilometers' })
  if (!buffered) throw new Error('Corridor buffer is empty')
  const cells = [
    ...new Set(
      buffered.geometry.type === 'Polygon'
        ? polygonToCells(buffered.geometry.coordinates, RESOLUTION, true)
        : buffered.geometry.coordinates.flatMap((polygon) =>
            polygonToCells(polygon, RESOLUTION, true),
          ),
    ),
  ].sort()
  const entries: HexEntry[] = cells.map((h3, index) => {
    const [latitude, longitude] = cellToLatLng(h3)
    const station = coreStation(longitude, latitude, core)
    return {
      index,
      h3,
      latitude,
      longitude,
      core_station_code: station?.properties.station_code ?? null,
      core_station_name: station?.properties.station_name ?? null,
    }
  })

  process.stdout.write(
    `08 ${REGION_ID} · ${entries.length.toLocaleString()} H3 r${RESOLUTION} cells · ` +
      `OSRM ${OSRM_URL}\n`,
  )
  const { matrix, maxSnapDistance, snappedCoordinates } = await compileMatrix(entries)
  const disconnected = [...matrix].filter((duration) => !Number.isFinite(duration)).length
  if (disconnected > 0) throw new Error(`${disconnected} matrix entries are disconnected`)
  const { bitsets, words } = compileBitsets(matrix, entries.length)
  process.stdout.write(`08 ${REGION_ID} · validating ${VALIDATION_PAIRS} live pairs…\n`)
  const validation = await validate(entries, matrix, snappedCoordinates)
  const requiresCrossBoundary = core.length > 1
  const pass =
    validation.medianErrorPercent < 5 &&
    validation.maxErrorPercent < 20 &&
    validation.oneWayAsymmetryPairs > 0 &&
    (!requiresCrossBoundary || validation.crossBoundaryPairs > 0)
  if (!pass) {
    throw new Error(
      `Routing validation failed: median=${validation.medianErrorPercent}, ` +
        `max=${validation.maxErrorPercent}, oneWay=${validation.oneWayAsymmetryPairs}, ` +
        `crossBoundary=${validation.crossBoundaryPairs}`,
    )
  }

  await mkdir(ROUTING_DIR, { recursive: true })
  const inputChecksum = await sha256File(INPUT.jurisdictions)
  const region = {
    id: REGION_ID,
    name: REGION_NAME,
    scope: REGION_SCOPE,
    station_codes: core.map(({ properties }) => properties.station_code),
    station_names: core.map(({ properties }) => properties.station_name),
    h3_resolution: RESOLUTION,
    cells: entries.length,
    buffer_km: BUFFER_KM,
    response_budgets_seconds: RESPONSE_BUDGETS_SECONDS,
    words_per_bitset: words,
    duration_storage: {
      format: 'Float32Array',
      order: 'origin-major row-major',
      unit: 'seconds',
      conditions: 'free_flow',
      congestion_baked_in: false,
      endianness: 'little',
    },
    bitset_storage: {
      format: 'Uint32Array',
      order: 'origin-major, budget-major, word-major',
      endianness: 'little',
    },
    source_authority: 'open_reference',
    transformation: 'derived',
    method: 'osrm_mld_free_flow_v1',
    source_checksum: inputChecksum,
    generation_version: GENERATION_VERSION,
  }
  const hexIndex = {
    region_id: region.id,
    h3_resolution: RESOLUTION,
    cells: entries,
    source_authority: 'open_reference',
    transformation: 'derived',
    method: 'h3_corridor_buffer_v1',
    source_checksum: inputChecksum,
    generation_version: GENERATION_VERSION,
  }
  const validationDocument = {
    status: 'PASS',
    region_id: region.id,
    osrm_url: OSRM_URL,
    osrm_host_port_deviation: {
      expected_default: 5000,
      actual: 5001,
      reason: 'macOS ControlCenter AirPlay Receiver binds host port 5000',
    },
    samples: validation.pairs.length,
    median_duration_error_percent: validation.medianErrorPercent,
    max_duration_error_percent: validation.maxErrorPercent,
    disconnected_pairs: disconnected,
    max_table_snap_distance_m: maxSnapDistance,
    one_way_asymmetry_pairs: validation.oneWayAsymmetryPairs,
    cross_boundary_pairs: validation.crossBoundaryPairs,
    cross_boundary_required: requiresCrossBoundary,
    pairs: validation.pairs,
    source_authority: 'open_reference',
    transformation: 'derived',
    method: 'osrm_live_requery_validation_v1',
    generation_version: GENERATION_VERSION,
  }

  await Promise.all([
    writeFile(HEX_INDEX_PATH, `${JSON.stringify(hexIndex, null, 2)}\n`, 'utf8'),
    writeFile(MATRIX_PATH, Buffer.from(matrix.buffer)),
    writeFile(BITSETS_PATH, Buffer.from(bitsets.buffer)),
    writeFile(REGION_PATH, `${JSON.stringify(region, null, 2)}\n`, 'utf8'),
    writeFile(
      VALIDATION_PATH,
      `${JSON.stringify(validationDocument, null, 2)}\n`,
      'utf8',
    ),
  ])

  const inputs = [{ path: INPUT.jurisdictions, sha256: inputChecksum }]
  const manifestStep = `08_routing_matrix_${REGION_SCOPE.replace(/[^A-Za-z0-9_]+/g, '_')}`
  await recordOutput(manifestStep, HEX_INDEX_PATH, entries.length, inputs)
  await recordOutput(
    manifestStep,
    MATRIX_PATH,
    entries.length * entries.length,
    inputs,
    { cells: entries.length, scalar: 'float32_seconds', conditions: 'free_flow' },
  )
  await recordOutput(
    manifestStep,
    BITSETS_PATH,
    entries.length * RESPONSE_BUDGETS_SECONDS.length,
    inputs,
    { cells: entries.length, budgets_seconds: RESPONSE_BUDGETS_SECONDS, words },
  )
  await recordOutput(manifestStep, REGION_PATH, 1, inputs)
  await recordOutput(
    manifestStep,
    VALIDATION_PATH,
    validation.pairs.length,
    inputs,
    {
      status: 'PASS',
      median_error_percent: validation.medianErrorPercent,
      max_error_percent: validation.maxErrorPercent,
    },
  )

  await mkdir(OUTPUT.reports, { recursive: true })
  await writeFile(
    REPORT_PATH,
    [
      `# Routing fixture — ${REGION_NAME}`,
      '',
      '**PASS** — free-flow OSRM matrix and coverage bitsets compiled.',
      '',
      `- H3 r${RESOLUTION} cells: **${entries.length.toLocaleString()}**`,
      `- Duration entries: **${(entries.length * entries.length).toLocaleString()}**`,
      `- Coverage tables: **${(entries.length * RESPONSE_BUDGETS_SECONDS.length).toLocaleString()}**`,
      `- Live validation pairs: **${validation.pairs.length}**`,
      `- Median duration error: **${validation.medianErrorPercent.toFixed(4)}%**`,
      `- Maximum duration error: **${validation.maxErrorPercent.toFixed(4)}%**`,
      `- Cross-boundary sample pairs: **${validation.crossBoundaryPairs}**`,
      `- Directionally asymmetric pairs (one-way evidence): **${validation.oneWayAsymmetryPairs}**`,
      '',
      'Stored durations are free-flow. Congestion is a runtime multiplier and is',
      'not baked into the matrix.',
      '',
      '## Environment deviation',
      '',
      `OSRM was reached at \`${OSRM_URL}\`, not host port 5000, because macOS`,
      'ControlCenter/AirPlay Receiver owns port 5000. The container still listens',
      'on 5000 internally. This is the owner-documented deviation.',
      '',
    ].join('\n'),
    'utf8',
  )

  process.stdout.write(
    `08 ${REGION_ID} complete in ${((Date.now() - started) / 1000).toFixed(1)}s — ` +
      `${entries.length.toLocaleString()} cells · validation PASS\n`,
  )
}

main().catch((error: unknown) => {
  process.stderr.write(`08 routing failed: ${String(error)}\n`)
  process.exitCode = 1
})
