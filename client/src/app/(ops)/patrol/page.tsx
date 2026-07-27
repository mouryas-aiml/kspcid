import { PatrolLab } from '@/components/patrol/PatrolLab'
import { MapAssetPreloads } from '@/components/map/MapAssetPreloads'

export default function PatrolPage() {
  return (
    <>
      <MapAssetPreloads dataArtifact="/data/scenarios/demo_corridor_patrol.json" />
      <PatrolLab />
    </>
  )
}
