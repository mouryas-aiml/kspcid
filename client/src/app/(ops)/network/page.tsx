import { OpsModulePlaceholder } from '@/components/shell/OpsModulePlaceholder'

export default function NetworkPage() {
  return (
    <OpsModulePlaceholder
      title="Case Constellation"
      stage="CONNECT"
      description="Scheduled after the required offline Neo4j + GDS compiler exports its graph snapshot."
    />
  )
}
