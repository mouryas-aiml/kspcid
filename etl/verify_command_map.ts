/** Acceptance checks for A5/A6/A8 adapter contracts and Command Map. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getResolution } from 'h3-js'

import { explainWithAdapter } from '../functions/kv-explain/index.js'
import { hotspotsWithAdapter } from '../functions/kv-hotspots/index.js'
import { incidentsWithAdapter } from '../functions/kv-incidents/index.js'
import { createDataAdapter } from '../functions/shared/data-access/index.js'
import { OUTPUT } from './00_config.js'
import { sha256File } from './lib/hash.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main(): Promise<void> {
  const fixturePath = resolve(OUTPUT.scenarios, 'command_map.json')
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as {
    window: { start: string; end: string; days_inclusive: number }
    cells: Array<{
      h3_r9: string
      count: number
      top_crime_head: string
      top_station_code: string
    }>
    reported_points: Array<{ incident_id: string; geo_origin: string; latitude: number; longitude: number }>
    explanations: Array<{ h3: string; paragraph: string; total: number }>
    alerts: unknown[]
    pulse_ring: { h3_r9: string; generated_roster_strength: number[] }
    provenance: Record<string, unknown>
  }
  assert(fixture.window.days_inclusive === 90, 'Command Map window must remain 90 days')
  assert(fixture.cells.length === 500, 'Expected compact top-500 H3 map cells')
  assert(fixture.cells.every((cell) => getResolution(cell.h3_r9) === 9), 'Map cell resolution drift')
  assert(fixture.reported_points.length === 500, 'Expected compact 500-point reported layer')
  assert(
    fixture.reported_points.every(
      (point) =>
        point.geo_origin.startsWith('reported') &&
        point.latitude >= 12.7 &&
        point.latitude <= 13.2 &&
        point.longitude >= 77.35 &&
        point.longitude <= 77.85,
    ),
    'Point layer contains an inferred or unroutable coordinate',
  )
  assert(fixture.explanations.length === 24, 'Expected 24 deterministic explanation payloads')
  assert(fixture.alerts.length <= 6, 'Map must pulse no more than six alerts')
  assert(fixture.pulse_ring.generated_roster_strength.length === 24, 'Roster overlay must cover 24 hours')
  assert(
    fixture.provenance['source_authority'] === 'third_party_mirror' &&
      fixture.provenance['transformation'] === 'derived',
    'Map provenance drift',
  )

  const adapter = createDataAdapter({ mode: 'local' })
  try {
    await hotspotsWithAdapter(
      { startDate: fixture.window.start, endDate: fixture.window.end, limit: 5 },
      adapter,
    )
    const started = performance.now()
    const hotspots = await hotspotsWithAdapter(
      {
        stationCode: fixture.cells[0]!.top_station_code,
        startDate: fixture.window.start,
        endDate: fixture.window.end,
        limit: 50,
      },
      adapter,
    )
    const hotspotMs = performance.now() - started
    assert(hotspotMs < 150, `Warm station hotspot query took ${hotspotMs.toFixed(1)}ms`)
    assert(hotspots.cells.length > 0, 'Station hotspot query returned no data')

    const incidentsStarted = performance.now()
    const incidents = await incidentsWithAdapter(
      {
        startDate: fixture.window.start,
        endDate: fixture.window.end,
        reportedOnly: true,
        limit: 500,
      },
      adapter,
    )
    const incidentMs = performance.now() - incidentsStarted
    assert(incidentMs < 150, `Warm reported-incident query took ${incidentMs.toFixed(1)}ms`)
    assert(
      JSON.stringify(incidents.items.map((item) => item.incident_id)) ===
        JSON.stringify(fixture.reported_points.map((point) => point.incident_id)),
      'Reported point snapshot differs from kv-incidents',
    )

    const explained = await explainWithAdapter(
      {
        h3: fixture.cells[0]!.h3_r9,
        startDate: fixture.window.start,
        endDate: fixture.window.end,
      },
      adapter,
    )
    assert(
      explained.paragraph === fixture.explanations[0]!.paragraph &&
        explained.total === fixture.explanations[0]!.total,
      'Why Here? snapshot differs from kv-explain',
    )
    const checksum = await sha256File(fixturePath)
    process.stdout.write(
      `verify:map — PASS\n` +
        `  cells / points      ${fixture.cells.length} / ${fixture.reported_points.length}\n` +
        `  explanations        ${fixture.explanations.length}\n` +
        `  warm hotspot query  ${hotspotMs.toFixed(1)} ms\n` +
        `  warm incident query ${incidentMs.toFixed(1)} ms\n` +
        `  fixture sha256      ${checksum}\n`,
    )
  } finally {
    await adapter.close()
  }
}

await main()
