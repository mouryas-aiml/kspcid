/**
 * A5 `kv-hotspots` — adapter-backed H3 aggregation for the Command Map.
 */
import {
  createDataAdapter,
  type CreateDataAdapterOptions,
  type DataAdapter,
  type QueryFilter,
} from '../shared/data-access/index.js'

export interface HotspotRequest {
  readonly stationCode?: string
  readonly crimeHead?: string
  readonly startDate: string
  readonly endDate: string
  readonly limit?: number
}

interface CountRow {
  readonly h3_r9: string
  readonly count: number | bigint
}

interface CategoryRow extends CountRow {
  readonly crime_head: string
}

interface StationRow extends CountRow {
  readonly station_code: string | null
  readonly unit_name: string
}

function date(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be YYYY-MM-DD`)
  return value
}

function filters(request: HotspotRequest): QueryFilter[] {
  const result: QueryFilter[] = [
    { column: 'registered_on', operator: 'gte', value: date(request.startDate, 'startDate') },
    { column: 'registered_on', operator: 'lte', value: date(request.endDate, 'endDate') },
    { column: 'h3_r9', operator: 'is_not_null' },
  ]
  if (request.stationCode) result.push({ column: 'station_code', operator: 'eq', value: request.stationCode })
  if (request.crimeHead) result.push({ column: 'crime_head', operator: 'eq', value: request.crimeHead })
  return result
}

export async function hotspotsWithAdapter(
  request: HotspotRequest,
  adapter: DataAdapter,
) {
  const selectedFilters = filters(request)
  const [totals, categories, stations] = await Promise.all([
    adapter.queryTable<CountRow>({
      table: 'IncidentsTime',
      columns: ['h3_r9'],
      aggregates: [{ fn: 'count', column: '*', as: 'count' }],
      filters: selectedFilters,
      groupBy: ['h3_r9'],
      orderBy: [{ column: 'count', direction: 'desc' }, { column: 'h3_r9', direction: 'asc' }],
      limit: Math.min(2_000, Math.max(1, request.limit ?? 500)),
    }),
    adapter.queryTable<CategoryRow>({
      table: 'IncidentsTime',
      columns: ['h3_r9', 'crime_head'],
      aggregates: [{ fn: 'count', column: '*', as: 'count' }],
      filters: selectedFilters,
      groupBy: ['h3_r9', 'crime_head'],
      orderBy: [{ column: 'h3_r9' }, { column: 'count', direction: 'desc' }, { column: 'crime_head' }],
    }),
    adapter.queryTable<StationRow>({
      table: 'IncidentsTime',
      columns: ['h3_r9', 'station_code', 'unit_name'],
      aggregates: [{ fn: 'count', column: '*', as: 'count' }],
      filters: selectedFilters,
      groupBy: ['h3_r9', 'station_code', 'unit_name'],
      orderBy: [{ column: 'h3_r9' }, { column: 'count', direction: 'desc' }, { column: 'unit_name' }],
    }),
  ])
  const topCategory = new Map<string, { crime_head: string; count: number }>()
  for (const row of categories) {
    if (!topCategory.has(row.h3_r9)) {
      topCategory.set(row.h3_r9, { crime_head: row.crime_head, count: Number(row.count) })
    }
  }
  const topStation = new Map<string, { station_code: string | null; unit_name: string; count: number }>()
  for (const row of stations) {
    if (!topStation.has(row.h3_r9)) {
      topStation.set(row.h3_r9, {
        station_code: row.station_code,
        unit_name: row.unit_name,
        count: Number(row.count),
      })
    }
  }
  return {
    cells: totals.map((row) => ({
      h3_r9: row.h3_r9,
      count: Number(row.count),
      top_crime_head: topCategory.get(row.h3_r9)?.crime_head ?? null,
      top_crime_head_count: topCategory.get(row.h3_r9)?.count ?? 0,
      top_station_code: topStation.get(row.h3_r9)?.station_code ?? null,
      top_station_name: topStation.get(row.h3_r9)?.unit_name ?? null,
      top_station_count: topStation.get(row.h3_r9)?.count ?? 0,
    })),
    filters: request,
    adapter: adapter.mode,
    provenance: {
      source_authority: 'third_party_mirror',
      transformation: 'derived',
      method: 'h3_r9_count_v1',
    },
  }
}

export async function handleHotspots(
  request: HotspotRequest,
  options: CreateDataAdapterOptions = {},
) {
  const adapter = createDataAdapter(options)
  try {
    return await hotspotsWithAdapter(request, adapter)
  } finally {
    await adapter.close()
  }
}
