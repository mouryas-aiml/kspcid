import type { DataAdapter } from './data-access/index.js'

const CACHE_VALUE_LIMIT = 16_000
const CHUNK_CHARACTERS = 12_000
const TTL_SECONDS = 172_800

interface CountRow {
  readonly station_code: string | null
  readonly unit_name: string
  readonly crime_head?: string
  readonly count: number | bigint
}

interface FeedFixture {
  readonly fixture_id: string
  readonly snapshot_through: string
  readonly replay_duration_ms: number
  readonly detector: Readonly<Record<string, string>>
  readonly alerts: readonly Readonly<Record<string, unknown>>[]
}

interface BitsetScenario {
  readonly scenario_id: string
  readonly region_id: string
}

export interface WarmCacheResult {
  readonly keys: number
  readonly station_aggregates: number
  readonly bitset_scenarios: number
  readonly bitset_chunks: number
  readonly feed_cards: number
  readonly state_outlooks: number
  readonly largest_serialized_value: number
}

function serializedLength(value: unknown): number {
  return JSON.stringify(value).length
}

export async function warmRuntimeCache(
  adapter: DataAdapter,
  segment: string,
): Promise<WarmCacheResult> {
  const totals = await adapter.queryTable<CountRow>({
    table: 'IncidentsTime',
    columns: ['station_code', 'unit_name'],
    aggregates: [{ fn: 'count', column: '*', as: 'count' }],
    groupBy: ['station_code', 'unit_name'],
    orderBy: [{ column: 'count', direction: 'desc' }, { column: 'unit_name' }],
  })
  const topStations = totals.slice(0, 20)
  const stationCodes = topStations
    .map((row) => row.station_code)
    .filter((value): value is string => Boolean(value))
  const categories =
    stationCodes.length === 0
      ? []
      : await adapter.queryTable<CountRow>({
          table: 'IncidentsTime',
          columns: ['station_code', 'unit_name', 'crime_head'],
          aggregates: [{ fn: 'count', column: '*', as: 'count' }],
          filters: [{ column: 'station_code', operator: 'in', value: stationCodes }],
          groupBy: ['station_code', 'unit_name', 'crime_head'],
          orderBy: [
            { column: 'station_code' },
            { column: 'count', direction: 'desc' },
            { column: 'crime_head' },
          ],
        })
  const byStation = new Map<string, CountRow[]>()
  for (const row of categories) {
    if (!row.station_code) continue
    const rows = byStation.get(row.station_code) ?? []
    rows.push(row)
    byStation.set(row.station_code, rows)
  }

  const writes: Array<{ key: string; value: unknown }> = []
  for (const station of topStations) {
    const key = station.station_code ?? `unit-${station.unit_name}`
    writes.push({
      key: `station:${key}`,
      value: {
        station_code: station.station_code,
        unit_name: station.unit_name,
        total: Number(station.count),
        top_crime_heads: (byStation.get(station.station_code ?? '') ?? [])
          .slice(0, 10)
          .map((row) => ({
            crime_head: row.crime_head,
            count: Number(row.count),
          })),
      },
    })
  }

  const [bitsets, patrolScenario] = await Promise.all([
    adapter.getObject('routing/coverage_bitsets.bin'),
    adapter.getDocument<BitsetScenario>({
      collection: 'scenarios',
      id: 'demo_corridor_patrol',
    }),
  ])
  if (!patrolScenario) throw new Error('Patrol bitset scenario is missing')
  const encoded = Buffer.from(bitsets).toString('base64')
  const chunks = []
  for (let offset = 0; offset < encoded.length; offset += CHUNK_CHARACTERS) {
    chunks.push(encoded.slice(offset, offset + CHUNK_CHARACTERS))
  }
  const bitsetPrefix = `bitsets:scenario:${patrolScenario.scenario_id}`
  writes.push({
    key: `${bitsetPrefix}:index`,
    value: {
      encoding: 'base64',
      source: 'routing/coverage_bitsets.bin',
      scenario_id: patrolScenario.scenario_id,
      region_id: patrolScenario.region_id,
      source_bytes: bitsets.byteLength,
      chunks: chunks.length,
      chunk_characters: CHUNK_CHARACTERS,
    },
  })
  chunks.forEach((value, index) => {
    writes.push({ key: `${bitsetPrefix}:${index}`, value })
  })

  const feed = await adapter.getDocument<FeedFixture>({
    collection: 'scenarios',
    id: 'command_feed',
  })
  if (!feed) throw new Error('Command Feed scenario is missing')
  writes.push({
    key: 'command-feed:index',
    value: {
      fixture_id: feed.fixture_id,
      snapshot_through: feed.snapshot_through,
      replay_duration_ms: feed.replay_duration_ms,
      detector: feed.detector,
      alert_keys: feed.alerts.map((alert, index) =>
        String(alert['id'] ?? `alert-${index + 1}`),
      ),
    },
  })
  feed.alerts.forEach((alert, index) => {
    writes.push({
      key: `command-feed:${String(alert['id'] ?? `alert-${index + 1}`)}`,
      value: alert,
    })
  })

  const stateBytes = await adapter.getObject('state/state_intelligence.json')
  const state = JSON.parse(new TextDecoder().decode(stateBytes)) as {
    schema_version: string
    crime_groups: string[]
    districts: Array<{ district_id: string; name: string; fir_rate_per_lakh: number; context: { urban_share_pct: number }; outlooks: Record<string, { risk: unknown; forecast_4w: unknown } | null> }>
  }
  const warmGroups = state.crime_groups.slice(0, 6)
  writes.push({ key: `state:${state.schema_version}:index`, value: { crime_groups: state.crime_groups, warm_groups: warmGroups, districts: state.districts.map((d) => ({ district_id: d.district_id, name: d.name })) } })
  for (const group of warmGroups) {
    writes.push({ key: `state:${state.schema_version}:risk:${group}:min:max`, value: state.districts.map((district) => ({ district_id: district.district_id, name: district.name, risk: district.outlooks[group]?.risk ?? null, forecast_4w: district.outlooks[group]?.forecast_4w ?? null, fir_rate_per_lakh: district.fir_rate_per_lakh, urban_share_pct: district.context.urban_share_pct })) })
  }

  let largest = 0
  for (const write of writes) {
    const size = serializedLength(write.value)
    largest = Math.max(largest, size)
    if (size > CACHE_VALUE_LIMIT) {
      throw new Error(
        `Cache value ${write.key} is ${size} characters; maximum is ${CACHE_VALUE_LIMIT}`,
      )
    }
    await adapter.putCache(
      { segment, key: write.key },
      write.value,
      { ttlSeconds: TTL_SECONDS },
    )
  }
  return {
    keys: writes.length,
    station_aggregates: topStations.length,
    bitset_scenarios: 1,
    bitset_chunks: chunks.length,
    feed_cards: feed.alerts.length,
    state_outlooks: warmGroups.length,
    largest_serialized_value: largest,
  }
}
