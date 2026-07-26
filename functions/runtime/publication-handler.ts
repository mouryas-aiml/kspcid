import {
  pollPublicationImports,
  publishPublication,
  smokePublication,
  startPublicationImports,
  validatePublication,
  verifyPublicationStratus,
  warmPublicationCache,
  type PublicationState,
} from '../shared/cloud-publication.js'
import { CatalystPublicationPlatform } from '../shared/catalyst-publication.js'
import {
  createBasicHandler,
  type BasicHandler,
} from './catalyst.js'

export type PublicationOperation =
  | 'validate'
  | 'start-imports'
  | 'poll-imports'
  | 'verify-stratus'
  | 'warm-cache'
  | 'smoke'
  | 'publish'

export function createPublicationHandler(
  operation: PublicationOperation,
): BasicHandler {
  return createBasicHandler(async (input, context) => {
    const platform = new CatalystPublicationPlatform(context)
    const current = input as PublicationState
    switch (operation) {
      case 'validate':
        return validatePublication(input, platform)
      case 'start-imports':
        return startPublicationImports(current, platform)
      case 'poll-imports':
        return pollPublicationImports(current, platform)
      case 'verify-stratus':
        return verifyPublicationStratus(current, platform)
      case 'warm-cache':
        return warmPublicationCache(current, platform)
      case 'smoke':
        return smokePublication(current, platform)
      case 'publish':
        return publishPublication(current, platform)
    }
  })
}
