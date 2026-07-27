import { CommandFeed } from '@/components/feed/CommandFeed'
import { MapAssetPreloads } from '@/components/map/MapAssetPreloads'

export default function FeedPage() {
  return (
    <>
      <MapAssetPreloads dataArtifact="/data/scenarios/command_feed.json" />
      <CommandFeed />
    </>
  )
}
