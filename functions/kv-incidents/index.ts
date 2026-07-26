/**
 * A5 `kv-incidents` — environment-selected incident retrieval contract.
 */
import {
  createDataAdapter,
  type CreateDataAdapterOptions,
  type DataAdapter,
  type QueryFilter,
} from '../shared/data-access/index.js'

export interface IncidentRequest {
  readonly search?: string
  readonly searchIn?: readonly (
    | 'case_ref'
    | 'act_section'
    | 'place_of_offence'
    | 'crime_head'
  )[]
  readonly stationCode?: string
  readonly crimeHead?: string
  readonly startDate?: string
  readonly endDate?: string
  readonly reportedOnly?: boolean
  readonly limit?: number
  readonly offset?: number
}

export interface IncidentItem {
  readonly incident_id: string
  readonly case_ref: string
  readonly station_code: string | null
  readonly unit_name: string
  readonly police_division: string | null
  readonly registered_on: string
  readonly crime_group: string
  readonly crime_head: string
  readonly act_section: string
  readonly place_of_offence: string | null
  readonly stage: string
  readonly h3_r9: string | null
  readonly latitude: number | null
  readonly longitude: number | null
  readonly geo_origin: string
  readonly map_pin_eligible: boolean
  readonly source_authority: string
  readonly transformation: string
}

function isoDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be YYYY-MM-DD`)
  return value
}

export async function incidentsWithAdapter(
  request: IncidentRequest,
  adapter: DataAdapter,
): Promise<{
  readonly items: IncidentItem[]
  readonly limit: number
  readonly offset: number
  readonly adapter: 'local' | 'catalyst'
}> {
  const limit = Math.min(500, Math.max(1, Math.trunc(request.limit ?? 100)))
  const offset = Math.max(0, Math.trunc(request.offset ?? 0))
  const columns = [
    'incident_id',
    'case_ref',
    'station_code',
    'unit_name',
    'police_division',
    'registered_on',
    'crime_group',
    'crime_head',
    'act_section',
    'place_of_offence',
    'stage',
    'h3_r9',
    'latitude',
    'longitude',
    'geo_origin',
    'map_pin_eligible',
    'source_authority',
    'transformation',
  ] as const
  if (request.search?.trim()) {
    if (
      request.stationCode ||
      request.crimeHead ||
      request.startDate ||
      request.endDate ||
      request.reportedOnly
    ) {
      throw new Error('Full-text search cannot be combined with relational filters')
    }
    const requested = request.searchIn ?? [
      'case_ref',
      'act_section',
      'place_of_offence',
      'crime_head',
    ]
    const valid = new Set([
      'case_ref',
      'act_section',
      'place_of_offence',
      'crime_head',
    ])
    if (requested.length === 0 || requested.some((column) => !valid.has(column))) {
      throw new Error('searchIn contains an unsupported full-text column')
    }
    const searchColumns = requested.flatMap((column) =>
      column === 'act_section' && adapter.mode === 'catalyst'
        ? [
            'act_section_search_1',
            'act_section_search_2',
            'act_section_search_3',
          ]
        : [column],
    )
    const items = await adapter.searchText<IncidentItem>({
      table: 'IncidentsTime',
      search: request.search,
      searchColumns,
      selectColumns: columns,
      limit,
      offset,
    })
    return { items, limit, offset, adapter: adapter.mode }
  }
  const filters: QueryFilter[] = []
  if (request.stationCode) filters.push({ column: 'station_code', operator: 'eq', value: request.stationCode })
  if (request.crimeHead) filters.push({ column: 'crime_head', operator: 'eq', value: request.crimeHead })
  if (request.startDate) filters.push({ column: 'registered_on', operator: 'gte', value: isoDate(request.startDate, 'startDate') })
  if (request.endDate) filters.push({ column: 'registered_on', operator: 'lte', value: isoDate(request.endDate, 'endDate') })
  if (request.reportedOnly) filters.push({ column: 'map_pin_eligible', operator: 'eq', value: true })
  const items = await adapter.queryTable<IncidentItem>({
    table: 'IncidentsTime',
    columns,
    filters,
    orderBy: [
      { column: 'registered_on', direction: 'desc' },
      { column: 'incident_id', direction: 'asc' },
    ],
    limit,
    offset,
  })
  return { items, limit, offset, adapter: adapter.mode }
}

export async function handleIncidents(
  request: IncidentRequest,
  options: CreateDataAdapterOptions = {},
) {
  const adapter = createDataAdapter(options)
  try {
    return await incidentsWithAdapter(request, adapter)
  } finally {
    await adapter.close()
  }
}
