/**
 * 10 — Deterministic patrol-lab scenario compiler (BUILD_SPEC §7.9–§7.11).
 *
 * The scenario is a replay/planning fixture, not an operational roster. Demand
 * comes only from observed corridor records, spatially aggregated to H3 r9 and
 * recency weighted inside a declared complete three-year window. Unit identities
 * and starting posts are explicitly generated demonstration inputs.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { ANALYSIS_CUTOFF, DEMO_SPINE, OUTPUT } from './00_config.js'
import { GENERATION_VERSION, sha256File, stableIndex } from './lib/hash.js'
import { recordOutput } from './lib/manifest.js'
import { query } from './lib/parquet.js'

const INCIDENTS_PATH = resolve(OUTPUT.derived, 'incidents_time.parquet')
const HEX_INDEX_PATH = resolve(OUTPUT.routing, 'hex_index.json')
const OUTPUT_PATH = resolve(OUTPUT.scenarios, 'demo_corridor_patrol.json')
const REPORT_PATH = resolve(OUTPUT.reports, 'a9_patrol_fixture.md')
const WINDOW_START = '2021-01-01'
const SHIFT_HOURS = [20, 21, 22, 23] as const

interface HexCell {
  readonly index: number
  readonly h3: string
  readonly latitude: number
  readonly longitude: number
  readonly core_station_code: string | null
  readonly core_station_name: string | null
}

interface HexIndex {
  readonly region_id: string
  readonly h3_resolution: number
  readonly cells: readonly HexCell[]
}

interface IncidentRow {
  readonly incident_id: string
  readonly case_ref: string
  readonly station_code: string
  readonly unit_name: string
  readonly registered_on: string
  readonly beat_name: string | null
  readonly h3_r9: string
  readonly estimated_occurrence_hour: number
  readonly hour_confidence: number
  readonly geo_origin: string
  readonly time_origin: string
}

interface DemandAccumulator {
  incidents: number
  weight: number
  beats: Map<string, { incidents: number; weight: number }>
}

const UNIT_TYPES = [
  ...Array.from({ length: 3 }, () => 'Hoysala'),
  ...Array.from({ length: 4 }, () => 'Cheetah'),
  ...Array.from({ length: 6 }, () => 'Foot patrol'),
  'Pink Hoysala',
  ...Array.from({ length: 2 }, () => 'Traffic'),
] as const

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits))
}

function daysBetween(date: string, end: string): number {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000
}

async function main(): Promise<void> {
  const [incidentChecksum, hexChecksum, hexText] = await Promise.all([
    sha256File(INCIDENTS_PATH),
    sha256File(HEX_INDEX_PATH),
    readFile(HEX_INDEX_PATH, 'utf8'),
  ])
  const hexIndex = JSON.parse(hexText) as HexIndex
  const cellByH3 = new Map(hexIndex.cells.map((cell) => [cell.h3, cell]))
  const units = DEMO_SPINE.stations.map((station) => `${station} PS`)
  const quotedUnits = units.map((unit) => `'${unit.replace(/'/g, "''")}'`).join(', ')
  const rows = (await query(
    `SELECT incident_id, case_ref, station_code, unit_name,
            strftime(registered_on, '%Y-%m-%d') AS registered_on,
            beat_name, h3_r9, estimated_occurrence_hour, hour_confidence,
            geo_origin, time_origin
       FROM read_parquet('${INCIDENTS_PATH.replace(/'/g, "''")}')
      WHERE within_complete_window
        AND registered_on >= DATE '${WINDOW_START}'
        AND registered_on <= DATE '${ANALYSIS_CUTOFF}'
        AND crime_group = '${DEMO_SPINE.crimeGroup}'
        AND crime_head = '${DEMO_SPINE.crimeHead.replace(/'/g, "''")}'
        AND unit_name IN (${quotedUnits})
        AND estimated_occurrence_hour IN (${SHIFT_HOURS.join(', ')})
      ORDER BY registered_on, incident_id`,
  )) as unknown as IncidentRow[]

  const demandByCell = new Map<number, DemandAccumulator>()
  const usableRows: Array<IncidentRow & { hex_index: number; recency_weight: number }> = []
  for (const row of rows) {
    const cell = cellByH3.get(row.h3_r9)
    if (!cell) continue
    const recencyWeight = 0.5 ** (daysBetween(row.registered_on, ANALYSIS_CUTOFF) / 365.25)
    const demand = demandByCell.get(cell.index) ?? {
      incidents: 0,
      weight: 0,
      beats: new Map<string, { incidents: number; weight: number }>(),
    }
    demand.incidents += 1
    demand.weight += recencyWeight
    const beatLabel = `${row.station_code} · ${row.beat_name?.trim() || 'Beat not recorded'}`
    const beat = demand.beats.get(beatLabel) ?? { incidents: 0, weight: 0 }
    beat.incidents += 1
    beat.weight += recencyWeight
    demand.beats.set(beatLabel, beat)
    demandByCell.set(cell.index, demand)
    usableRows.push({ ...row, hex_index: cell.index, recency_weight: recencyWeight })
  }

  if (usableRows.length === 0) throw new Error('Patrol fixture has no routable corridor incidents')

  const demand = [...demandByCell]
    .map(([hexIndexValue, value]) => ({
      hex_index: hexIndexValue,
      incident_count: value.incidents,
      recency_weighted_demand: round(value.weight),
      beat_demand: [...value.beats]
        .map(([beat, measure]) => ({
          beat,
          incident_count: measure.incidents,
          recency_weighted_demand: round(measure.weight),
        }))
        .sort((a, b) => a.beat.localeCompare(b.beat)),
    }))
    .sort((a, b) => a.hex_index - b.hex_index)

  const rankedDemandCells = [...demand].sort(
    (a, b) =>
      b.recency_weighted_demand - a.recency_weighted_demand || a.hex_index - b.hex_index,
  )
  const fallbackCells = hexIndex.cells
    .filter((cell) => cell.core_station_code !== null)
    .map((cell) => cell.index)
  const candidateCells =
    rankedDemandCells.length > 0 ? rankedDemandCells.map((cell) => cell.hex_index) : fallbackCells
  const roster = UNIT_TYPES.map((type, index) => {
    const candidate =
      candidateCells[
        stableIndex('patrol_roster_post', `${type}:${index}`, hexIndex.region_id, candidateCells.length)
      ]!
    return {
      unit_id: `DEMO-${String(index + 1).padStart(2, '0')}`,
      unit_type: type,
      call_sign: `${type.toUpperCase().replaceAll(' ', '-')}-${String(index + 1).padStart(2, '0')}`,
      start_hex_index: candidate,
      generated: true,
    }
  })

  const stationPosts = [...new Set(hexIndex.cells.flatMap((cell) => cell.core_station_code ?? []))]
    .sort()
    .map((stationCode) => {
      const core = hexIndex.cells.filter((cell) => cell.core_station_code === stationCode)
      const demandPost = rankedDemandCells.find((candidate) =>
        core.some((cell) => cell.index === candidate.hex_index),
      )
      return {
        station_code: stationCode,
        hex_index: demandPost?.hex_index ?? core[0]!.index,
      }
    })

  const replayRows = [...usableRows]
    .sort(
      (a, b) =>
        stableIndex('patrol_replay_rank', a.incident_id, hexIndex.region_id, 1_000_000) -
          stableIndex('patrol_replay_rank', b.incident_id, hexIndex.region_id, 1_000_000) ||
        a.incident_id.localeCompare(b.incident_id),
    )
    .slice(0, 120)
  const replay_events = replayRows
    .map((row) => ({
      incident_id: row.incident_id,
      case_ref: row.case_ref,
      hex_index: row.hex_index,
      simulation_minute: stableIndex('patrol_replay_minute', row.incident_id, 'six_hour_shift', 360),
      service_minutes: 18,
      registered_on: row.registered_on,
      estimated_occurrence_hour: row.estimated_occurrence_hour,
      hour_confidence: round(row.hour_confidence),
      geo_origin: row.geo_origin,
      time_origin: row.time_origin,
    }))
    .sort(
      (a, b) =>
        a.simulation_minute - b.simulation_minute || a.incident_id.localeCompare(b.incident_id),
    )

  const totalDemand = demand.reduce((sum, cell) => sum + cell.recency_weighted_demand, 0)
  const scenario = {
    schema_version: 1,
    scenario_id: 'demo-corridor-patrol-2021-2023-night',
    region_id: hexIndex.region_id,
    title: 'East–Whitefield two-wheeler theft night deployment',
    purpose: 'Historical replay and resource-planning demonstration',
    time_window: {
      start: WINDOW_START,
      end: ANALYSIS_CUTOFF,
      complete_window: true,
      selected_hours_local: SHIFT_HOURS,
      shift_minutes: 360,
    },
    demand_model: {
      crime_group: DEMO_SPINE.crimeGroup,
      crime_head: DEMO_SPINE.crimeHead,
      half_life_days: 365.25,
      observed_rows_in_shift: usableRows.length,
      total_recency_weighted_demand: round(totalDemand),
      h3_resolution: hexIndex.h3_resolution,
      demand,
    },
    planning_defaults: {
      response_target_minutes: 7,
      reserve_units: 2,
      response_budget_seconds: 420,
      baseline_posts: stationPosts,
      weather: 'dry',
      road_closure: null,
    },
    roster,
    replay_events,
    interpretation: {
      coverage: 'Share of recency-weighted demand reachable inside the selected road-time budget.',
      response: 'Road-network travel time to replay events; service time is fixed at 18 minutes.',
      equity: 'Balance of covered demand across source-recorded beat labels; no beat polygons are inferred.',
      score_scope: 'Coverage, response, equity, reserve and travel efficiency only.',
    },
    provenance: {
      source_authority: 'third_party_karnataka_fir_mirror',
      transformation: 'derived_demand_and_historical_replay',
      source_checksum: incidentChecksum,
      routing_source_checksum: hexChecksum,
      generated_roster: true,
      generation_version: GENERATION_VERSION,
    },
  }

  await mkdir(OUTPUT.scenarios, { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(scenario, null, 2)}\n`, 'utf8')
  await recordOutput(
    '10_patrol_fixture',
    OUTPUT_PATH,
    usableRows.length,
    [
      { path: INCIDENTS_PATH, sha256: incidentChecksum },
      { path: HEX_INDEX_PATH, sha256: hexChecksum },
    ],
    {
      demand_cells: demand.length,
      replay_events: replay_events.length,
      generated_units: roster.length,
      selected_hours_local: SHIFT_HOURS,
    },
  )
  await mkdir(OUTPUT.reports, { recursive: true })
  await writeFile(
    REPORT_PATH,
    `# A9 patrol fixture\n\n` +
      `- Scenario: \`${scenario.scenario_id}\`\n` +
      `- Complete window: ${WINDOW_START} to ${ANALYSIS_CUTOFF}\n` +
      `- Selected local hours: ${SHIFT_HOURS.join(', ')}\n` +
      `- Routable observed rows: ${usableRows.length}\n` +
      `- H3 demand cells: ${demand.length} of ${hexIndex.cells.length}\n` +
      `- Recency-weighted demand: ${round(totalDemand)}\n` +
      `- Replay events: ${replay_events.length}\n` +
      `- Generated demonstration units: ${roster.length}\n\n` +
      `Beat labels are source fields used only as equity groups. No beat boundary is drawn or inferred.\n`,
    'utf8',
  )
  process.stdout.write(
    `10 · patrol fixture ${usableRows.length} rows · ${demand.length} demand cells · ${roster.length} units\n`,
  )
}

await main()
