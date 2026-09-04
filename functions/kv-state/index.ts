import type { DataAdapter } from '../shared/data-access/types.js'
import checkedPublication from '../../data/scenarios/state_intelligence.json'

export interface StateRequest { mode?: string; crimeGroup?: string; start?: string; end?: string; district?: string }
const MODES = new Set(['risk', 'rate', 'urban'])
const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function stateWithAdapter(request: StateRequest, adapter: DataAdapter) {
  const mode = request.mode ?? 'risk'
  if (!MODES.has(mode)) throw new Error('mode must be risk, rate or urban')
  if (request.start && !DATE.test(request.start)) throw new Error('start must be YYYY-MM-DD')
  if (request.end && !DATE.test(request.end)) throw new Error('end must be YYYY-MM-DD')
  let data: any
  try {
    const bytes = await adapter.getObject('state/state_intelligence.json')
    data = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    // The checked publication is also bundled into the Function, so a fresh
    // deployment is useful before the first Stratus synchronization finishes.
    data = checkedPublication
  }
  const crimeGroup = request.crimeGroup ?? data.crime_groups[0]
  if (!data.crime_groups.includes(crimeGroup)) throw new Error('Unsupported crimeGroup')
  if (request.district && !data.districts.some((d: any) => d.district_id === request.district)) throw new Error('Unsupported district')
  const segment = process.env.KSPCID_CACHE_SEGMENT
  const version = data.schema_version
  const cacheKey = request.district ? `state-district:${version}:${request.district}:${crimeGroup}` : `state:${version}:${mode}:${crimeGroup}:${request.start ?? 'min'}:${request.end ?? 'max'}`
  if (segment && request.district) {
    const cached = await adapter.getCache<any>({ segment, key: cacheKey })
    if (cached) return cached
  }
  const result = {
    ...data,
    districts: request.district ? data.districts.filter((d: any) => d.district_id === request.district) : data.districts,
    query: { mode, crimeGroup, start: request.start ?? data.available_periods.model[0], end: request.end ?? data.available_periods.model[1] },
    geometry: { object_key: 'state/karnataka_districts.geojson', version },
  }
  if (segment && request.district) await adapter.putCache({ segment, key: cacheKey }, result, { ttlSeconds: 172_800 })
  return result
}
