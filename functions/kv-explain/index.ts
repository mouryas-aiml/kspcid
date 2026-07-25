/**
 * A8 `kv-explain` — deterministic hotspot explanation, no runtime LLM.
 */
import {
  createDataAdapter,
  type CreateDataAdapterOptions,
  type DataAdapter,
  type QueryFilter,
} from '../shared/data-access/index.js'

interface GroupCount {
  readonly count: number | bigint
  readonly [key: string]: unknown
}

async function grouped(
  adapter: DataAdapter,
  filters: QueryFilter[],
  column: string,
): Promise<Array<{ value: string; count: number }>> {
  const rows = await adapter.queryTable<GroupCount>({
    table: 'IncidentsTime',
    columns: [column],
    aggregates: [{ fn: 'count', column: '*', as: 'count' }],
    filters,
    groupBy: [column],
    orderBy: [{ column: 'count', direction: 'desc' }, { column }],
  })
  return rows.map((row) => ({ value: String(row[column] ?? 'Not recorded'), count: Number(row.count) }))
}

export async function explainWithAdapter(
  request: { h3: string; startDate: string; endDate: string },
  adapter: DataAdapter,
) {
  if (!/^[0-9a-f]{15}$/i.test(request.h3)) throw new Error('h3 must be a resolution-index string')
  const filters: QueryFilter[] = [
    { column: 'h3_r9', operator: 'eq', value: request.h3 },
    { column: 'registered_on', operator: 'gte', value: request.startDate },
    { column: 'registered_on', operator: 'lte', value: request.endDate },
  ]
  const [heads, hours, premises, origins, stations] = await Promise.all([
    grouped(adapter, filters, 'crime_head'),
    grouped(adapter, [...filters, { column: 'estimated_occurrence_hour', operator: 'is_not_null' }], 'estimated_occurrence_hour'),
    grouped(adapter, filters, 'premise_class'),
    grouped(adapter, filters, 'geo_origin'),
    grouped(adapter, filters, 'unit_name'),
  ])
  const total = heads.reduce((sum, row) => sum + row.count, 0)
  const top = heads[0]
  const peakHours = hours.slice(0, 4).map((row) => Number(row.value)).sort((a, b) => a - b)
  const reported = origins.find((row) => row.value === 'reported')?.count ?? 0
  const share = total && top ? Math.round((top.count / total) * 1_000) / 10 : 0
  const hourText = peakHours.length ? peakHours.map((hour) => `${String(hour).padStart(2, '0')}:00`).join(', ') : 'not modelled'
  const paragraph =
    `${stations[0]?.value ?? 'Selected area'} · ${request.h3.slice(0, 8)}… · ${total} records. ` +
    `${top ? `${top.value} accounts for ${share.toFixed(1)}%. ` : ''}` +
    `The highest derived occurrence-hour counts are ${hourText}. ` +
    `${premises[0]?.value ?? 'Premise not recorded'} is the most common normalized premise class. ` +
    `${reported} of ${total} records have reported-location origin.`
  return {
    h3: request.h3,
    total,
    paragraph,
    evidence: { crime_heads: heads.slice(0, 5), hours, premises: premises.slice(0, 5), origins, stations },
    confidence: reported / Math.max(1, total) >= 0.65 ? 'high' : reported / Math.max(1, total) >= 0.35 ? 'medium' : 'low',
    adapter: adapter.mode,
    provenance: {
      source_authority: 'third_party_mirror',
      transformation: 'derived',
      method: 'deterministic_hotspot_template_v1',
    },
  }
}

export async function handleExplain(
  request: { h3: string; startDate: string; endDate: string },
  options: CreateDataAdapterOptions = {},
) {
  const adapter = createDataAdapter(options)
  try {
    return await explainWithAdapter(request, adapter)
  } finally {
    await adapter.close()
  }
}
