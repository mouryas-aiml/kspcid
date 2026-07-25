import { ProvenanceChip } from '@/components/primitives/ProvenanceChip'
import type { Provenance } from '@/lib/provenance'

const observed: Provenance = {
  source_authority: 'third_party_mirror',
  transformation: 'normalized',
  source_checksum: '9191e0…a604',
  generation_version: 'kspcid-etl-1.0.0',
}

const stages = [
  ['Pending Trial', 105647, '#8A6300'],
  ['Undetected', 92874, '#F04438'],
  ['Convicted', 73310, '#12B76A'],
  ['Traced', 36139, '#38BDF8'],
  ['Under Investigation', 35922, '#A78BFA'],
] as const

export const metadata = { title: 'Justice Pipeline' }

export default function JusticePage() {
  const max = stages[0][1]
  return (
    <article className="p-12">
      <header className="border-b border-[--rule] pb-8">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="type-micro text-[--gold-print]">OBSERVED MODE</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em]">Justice Pipeline</h1>
            <p className="mt-2 text-sm text-[--ink-soft]">
              Current stage distribution · Bengaluru City · complete mirror
            </p>
          </div>
          <ProvenanceChip
            className="[&_.provenance-popover]:text-[--txt]"
            provenance={observed}
            derivation="Normalized from the current FIR_Stage value. This is a one-hop terminal-state distribution; no transition history exists in the source."
          />
        </div>
      </header>
      <section className="py-8">
        <h2 className="text-lg font-semibold">Registered FIRs → current stage</h2>
        <p className="mt-1 text-sm text-[--ink-soft]">
          Observed values only. Multi-hop transitions are not shown as recorded fact.
        </p>
        <div className="mt-8 space-y-5">
          {stages.map(([label, count, color]) => (
            <div key={label} className="grid grid-cols-[160px_1fr_88px] items-center gap-4">
              <span className="text-sm">{label}</span>
              <div className="h-7 bg-[--paper-tint]">
                <div
                  className="h-full"
                  style={{ width: `${(count / max) * 100}%`, backgroundColor: color }}
                />
              </div>
              <span className="text-right font-mono text-sm font-semibold">
                {count.toLocaleString('en-IN')}
              </span>
            </div>
          ))}
        </div>
      </section>
      <aside className="border-l-4 border-[--critical] bg-[#FFF5F4] p-5">
        <p className="type-micro text-[--critical]">ACTIONABLE BACKLOG</p>
        <p className="mt-2 text-2xl font-semibold">92,874 undetected</p>
        <p className="mt-1 text-sm text-[--ink-soft]">
          21.8% of the Bengaluru-labelled mirror rows are currently recorded at this stage.
        </p>
      </aside>
    </article>
  )
}
