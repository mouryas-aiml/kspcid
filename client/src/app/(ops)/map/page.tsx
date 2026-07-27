import { CommandMap } from '@/components/map/CommandMap'
import { MapAssetPreloads } from '@/components/map/MapAssetPreloads'

export default function MapPage() {
  return (
    <>
      <MapAssetPreloads dataArtifact="/data/scenarios/command_map.json" />
      <CommandMap />
    </>
  )
}
