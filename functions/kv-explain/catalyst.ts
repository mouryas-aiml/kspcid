import { explainWithAdapter } from './index.js'
import {
  createBasicHandler,
  stringValue,
  withCatalystAdapter,
} from '../runtime/catalyst.js'

export default createBasicHandler((input, context) =>
  withCatalystAdapter(context, (adapter) =>
    explainWithAdapter(
      {
        h3: stringValue(input, 'h3', true)!,
        startDate: stringValue(input, 'startDate', true)!,
        endDate: stringValue(input, 'endDate', true)!,
      },
      adapter,
    ),
  ),
)
