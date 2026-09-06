import { CommanderHome } from '@/components/brief/CommanderHome'
import { BriefShell } from '@/components/shell/BriefShell'

export const metadata = { title: 'Bengaluru overview' }

export default function OverviewPage() {
  return (
    <BriefShell>
      <CommanderHome />
    </BriefShell>
  )
}
