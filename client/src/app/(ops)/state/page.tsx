import { StateIntelligence, type GeoCollection } from '@/components/state/StateIntelligence'
import type { StateIntelligenceData } from '@/lib/state'
import stateData from '../../../../public/data/scenarios/state_intelligence.json'
import stateGeo from '../../../../public/data/reference/karnataka_districts.json'

export default function StatePage() { return <StateIntelligence initialData={stateData as unknown as StateIntelligenceData} initialGeo={stateGeo as unknown as GeoCollection} /> }
