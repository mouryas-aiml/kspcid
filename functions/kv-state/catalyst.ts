import { createBasicHandler, stringValue, withCatalystAdapter } from '../runtime/catalyst.js'
import { stateWithAdapter } from './index.js'

export default createBasicHandler((input, context) => {
  const values = {
    mode: stringValue(input, 'mode'), crimeGroup: stringValue(input, 'crimeGroup'),
    start: stringValue(input, 'start'), end: stringValue(input, 'end'), district: stringValue(input, 'district'),
  }
  const request = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
  return withCatalystAdapter(context, (adapter) => stateWithAdapter(request, adapter))
})
