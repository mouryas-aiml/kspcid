import type { ReactNode } from 'react'

import { BriefShell } from '@/components/shell/BriefShell'

export default function BriefLayout({ children }: { readonly children: ReactNode }) {
  return <BriefShell>{children}</BriefShell>
}
