/** A5/A6/A8 — deterministic Command Map and Why Here? static contract. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { cellToLatLng } from 'h3-js'

import { explainWithAdapter } from '../functions/kv-explain/index.js'
import { hotspotsWithAdapter } from '../functions/kv-hotspots/index.js'
import { incidentsWithAdapter } from '../functions/kv-incidents/index.js'
import { createDataAdapter } from '../functions/shared/data-access/index.js'
import { OUTPUT } from './00_config.js'
import { GENERATION_VERSION, sha256File } from './lib/hash.js'
import { recordOutput } from './lib/manifest.js'

const INPUT_PATH = resolve(OUTPUT.derived, 'incidents_time.parquet')
const FEED_PATH = resolve(OUTPUT.scenarios, 'command_feed.json')
const OUTPUT_PATH = resolve(OUTPUT.scenarios, 'command_map.json')
const REPORT_PATH = resolve(OUTPUT.reports, 'a5_a6_a8_command_map.md')
const START = '2023-10-03'
const END = '2023-12-31'

function number(value: number | bigint): number {
  return Number(value)
}

async function main(): Promise<void> {
  const adapter = createDataAdapter({ mode: 'local' })
  try {
    const [hotspots, reported, weekly, stations, feed] = await Promise.all([
      hotspotsWithAdapter({ startDate: START, endDate: END, limit: 500 }, adapter),
      incidentsWithAdapter(
        { startDate: START, endDate: END, reportedOnly: true, limit: 500 },
        adapter,
      ),
      adapter.queryTable<{ iso_week: string; count: number | bigint }>({
        table: 'IncidentsTime',
        columns: ['iso_week'],
        aggregates: [{ fn: 'count', column: '*', as: 'count' }],
        filters: [
          { column: 'registered_on', operator: 'gte', value: '2019-01-01' },
          { column: 'registered_on', operator: 'lte', value: END },
        ],
        groupBy: ['iso_week'],
        orderBy: [{ column: 'iso_week' }],
      }),
      adapter.queryTable<{
        station_code: string | null
        unit_name: string
        police_division: string | null
        count: number | bigint
      }>({
        table: 'IncidentsTime',
        columns: ['station_code', 'unit_name', 'police_division'],
        aggregates: [{ fn: 'count', column: '*', as: 'count' }],
        filters: [
          { column: 'registered_on', operator: 'gte', value: START },
          { column: 'registered_on', operator: 'lte', value: END },
        ],
        groupBy: ['station_code', 'unit_name', 'police_division'],
        orderBy: [{ column: 'unit_name' }],
      }),
      readFile(FEED_PATH, 'utf8').then(JSON.parse) as Promise<{
        alerts: Array<Record<string, unknown>>
      }>,
    ])
    const corridorCodes = new Set(['PSB-92', 'PSB-89', 'PSB-93', 'PSB-741'])
    const corridorCell = hotspots.cells.find(
      (cell) =>
        corridorCodes.has(cell.top_station_code ?? '') &&
        cell.top_crime_head === 'Of Automobiles - Of Two Wheelers',
    )
    const orderedCells = corridorCell
      ? [corridorCell, ...hotspots.cells.filter((cell) => cell.h3_r9 !== corridorCell.h3_r9)]
      : hotspots.cells
    const explainedCells = orderedCells.slice(0, 24)
    const explanations = await Promise.all(
      explainedCells.map((cell) =>
        explainWithAdapter({ h3: cell.h3_r9, startDate: START, endDate: END }, adapter),
      ),
    )
    const defaultCell = orderedCells[0]!
    const pulseRows = await adapter.queryTable<{
      crime_head: string
      estimated_occurrence_hour: number
      count: number | bigint
    }>({
      table: 'IncidentsTime',
      columns: ['crime_head', 'estimated_occurrence_hour'],
      aggregates: [{ fn: 'count', column: '*', as: 'count' }],
      filters: [
        { column: 'h3_r9', operator: 'eq', value: defaultCell.h3_r9 },
        { column: 'registered_on', operator: 'gte', value: START },
        { column: 'registered_on', operator: 'lte', value: END },
        { column: 'estimated_occurrence_hour', operator: 'is_not_null' },
      ],
      groupBy: ['crime_head', 'estimated_occurrence_hour'],
      orderBy: [
        { column: 'count', direction: 'desc' },
        { column: 'crime_head' },
        { column: 'estimated_occurrence_hour' },
      ],
    })
    const topHeads = explanations[0]!.evidence.crime_heads.slice(0, 5).map((row) => row.value)
    const fixture = {
      schema_version: 1,
      fixture_id: 'command-map-v1',
      window: { start: START, end: END, days_inclusive: 90 },
      cells: orderedCells.map((cell) => {
        const [latitude, longitude] = cellToLatLng(cell.h3_r9)
        return { ...cell, latitude, longitude }
      }),
      reported_points: reported.items.map((item) => ({
        incident_id: item.incident_id,
        station_code: item.station_code,
        unit_name: item.unit_name,
        crime_head: item.crime_head,
        latitude: item.latitude,
        longitude: item.longitude,
        geo_origin: item.geo_origin,
      })),
      stations: stations.map((row) => ({ ...row, count: number(row.count) })),
      weekly_histogram: weekly.map((row) => ({ iso_week: row.iso_week, count: number(row.count) })),
      explanations,
      pulse_ring: {
        h3_r9: defaultCell.h3_r9,
        crime_heads: topHeads,
        hourly: pulseRows
          .filter((row) => topHeads.includes(row.crime_head))
          .map((row) => ({ ...row, count: number(row.count) })),
        generated_roster_strength: [5, 5, 5, 5, 5, 5, 6, 8, 10, 11, 12, 12, 11, 10, 10, 9, 8, 7, 7, 6, 6, 4, 4, 4],
      },
      alerts: feed.alerts.filter((alert) => alert['geography']).slice(0, 6),
      provenance: {
        source_authority: 'third_party_mirror',
        transformation: 'derived',
        method: 'command_map_h3_r9_90d_v1',
        source_checksum: await sha256File(INPUT_PATH),
        generation_version: GENERATION_VERSION,
      },
    }
    await mkdir(OUTPUT.scenarios, { recursive: true })
    await writeFile(OUTPUT_PATH, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
    await recordOutput(
      '11_command_map_fixture',
      OUTPUT_PATH,
      fixture.cells.length,
      [
        { path: INPUT_PATH, sha256: fixture.provenance.source_checksum },
        { path: FEED_PATH, sha256: await sha256File(FEED_PATH) },
      ],
      {
        reported_points: fixture.reported_points.length,
        explanations: fixture.explanations.length,
        alerts: fixture.alerts.length,
      },
    )
    await mkdir(OUTPUT.reports, { recursive: true })
    await writeFile(
      REPORT_PATH,
      `# A5/A6/A8 Command Map\n\n` +
        `- 90-day H3 r9 cells: **${fixture.cells.length}**\n` +
        `- Eligible reported points in compact snapshot: **${fixture.reported_points.length}**\n` +
        `- Deterministic Why Here? explanations: **${fixture.explanations.length}**\n` +
        `- Pulsed ranked alerts: **${fixture.alerts.length}**\n` +
        `- Adapter functions: **kv-incidents, kv-hotspots, kv-explain**\n\n` +
        `Inferred locations render only as H3 aggregates. Point marks are map-pin-eligible reported coordinates only.\n`,
      'utf8',
    )
    process.stdout.write(
      `Map · ${fixture.cells.length} cells · ${fixture.reported_points.length} reported points · ${fixture.explanations.length} explanations\n`,
    )
  } finally {
    await adapter.close()
  }
}

await main()
