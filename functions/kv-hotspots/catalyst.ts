import { hotspotsWithAdapter, type HotspotRequest } from './index.js'
import {
  createBasicHandler,
  numberValue,
  stringValue,
  withCatalystAdapter,
} from '../runtime/catalyst.js'

export default createBasicHandler(async (input, context) => {
  const stationCode = stringValue(input, 'stationCode')
  const crimeHead = stringValue(input, 'crimeHead')
  const limit = numberValue(input, 'limit')
  const request: HotspotRequest = {
    startDate: stringValue(input, 'startDate', true)!,
    endDate: stringValue(input, 'endDate', true)!,
    ...(stationCode === undefined ? {} : { stationCode }),
    ...(crimeHead === undefined ? {} : { crimeHead }),
    ...(limit === undefined ? {} : { limit }),
  }
  return withCatalystAdapter(context, (adapter) =>
    hotspotsWithAdapter(request, adapter),
  )
})
