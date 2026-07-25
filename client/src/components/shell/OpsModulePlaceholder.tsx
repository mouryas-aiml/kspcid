import { Construction, Route } from 'lucide-react'

import { Panel } from '@/components/primitives/Panel'
import { OpsShell } from '@/components/shell/OpsShell'

interface OpsModulePlaceholderProps {
  readonly title: string
  readonly stage: string
  readonly description: string
}

export function OpsModulePlaceholder({
  title,
  stage,
  description,
}: OpsModulePlaceholderProps) {
  return (
    <OpsShell
      title={title}
      eyebrow={stage}
      context={
        <p className="text-sm leading-6 text-[--txt-2]">
          Filters become available when this module’s data contract lands.
        </p>
      }
      inspector={
        <Panel title="Build status" eyebrow="EMPTY STATE">
          <p className="text-sm leading-6 text-[--txt-2]">{description}</p>
        </Panel>
      }
    >
      <div className="grid h-full place-items-center bg-[--ink-900] p-8">
        <div className="max-w-md text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-[--r-md] border border-[--ink-500] text-[--gold-400]">
            <Construction size={21} />
          </span>
          <h2 className="mt-6 text-xl font-semibold text-[--txt-hi]">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-[--txt-2]">{description}</p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-[--r-sm] border border-[--ink-500] px-3 py-2 text-xs text-[--txt-3]">
            <Route size={14} /> Route reserved · no data claim rendered
          </div>
        </div>
      </div>
    </OpsShell>
  )
}
