import {
  similarWithAdapter,
  type SimilarityRequest,
  type SimilarityWeights,
} from './index.js'
import {
  createBasicHandler,
  jsonValue,
  numberValue,
  stringValue,
  withCatalystAdapter,
} from '../runtime/catalyst.js'

export default createBasicHandler(async (input, context) => {
  const weights = jsonValue<Partial<SimilarityWeights>>(input, 'weights')
  const limit = numberValue(input, 'limit')
  const request: SimilarityRequest = {
    incidentId: stringValue(input, 'incidentId', true)!,
    ...(weights === undefined ? {} : { weights }),
    ...(limit === undefined ? {} : { limit }),
  }
  return withCatalystAdapter(context, (adapter) =>
    similarWithAdapter(request, adapter),
  )
})
