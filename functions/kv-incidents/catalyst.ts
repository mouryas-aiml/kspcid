import { incidentsWithAdapter, type IncidentRequest } from './index.js'
import {
  booleanValue,
  createBasicHandler,
  numberValue,
  stringValue,
  withCatalystAdapter,
} from '../runtime/catalyst.js'

export default createBasicHandler(async (input, context) => {
  const search = stringValue(input, 'search')
  const searchInValue = stringValue(input, 'searchIn')
  const searchIn =
    searchInValue === undefined
      ? undefined
      : (searchInValue
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean) as IncidentRequest['searchIn'])
  const stationCode = stringValue(input, 'stationCode')
  const crimeHead = stringValue(input, 'crimeHead')
  const startDate = stringValue(input, 'startDate')
  const endDate = stringValue(input, 'endDate')
  const reportedOnly = booleanValue(input, 'reportedOnly')
  const limit = numberValue(input, 'limit')
  const offset = numberValue(input, 'offset')
  const request: IncidentRequest = {
    ...(search === undefined ? {} : { search }),
    ...(searchIn === undefined ? {} : { searchIn }),
    ...(stationCode === undefined ? {} : { stationCode }),
    ...(crimeHead === undefined ? {} : { crimeHead }),
    ...(startDate === undefined ? {} : { startDate }),
    ...(endDate === undefined ? {} : { endDate }),
    ...(reportedOnly === undefined ? {} : { reportedOnly }),
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
  }
  return withCatalystAdapter(context, (adapter) =>
    incidentsWithAdapter(request, adapter),
  )
})
