import { JusticePipeline } from '@/components/justice/JusticePipeline'
import { BriefShell } from '@/components/shell/BriefShell'

export const metadata = { title: 'Justice Pipeline' }

export default function JusticePage() {
  return (
    <BriefShell>
      <JusticePipeline />
    </BriefShell>
  )
}
