import { StationIndex } from '@/components/brief/StationIndex'
import { BriefShell } from '@/components/shell/BriefShell'

export const metadata = { title: 'Station briefs' }

/**
 * The directory behind the rail's Station Brief entry. Without it that link
 * would resolve to a segment with only a dynamic child and 404.
 */
export default function StationIndexPage() {
  return (
    <BriefShell backHref="/overview/" backLabel="Overview">
      <StationIndex />
    </BriefShell>
  )
}
