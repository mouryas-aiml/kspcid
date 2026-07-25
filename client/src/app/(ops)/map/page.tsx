import { ChevronDown, Clock3, Layers3, Search, SlidersHorizontal } from 'lucide-react'

import { MetricTile } from '@/components/primitives/MetricTile'
import { Panel } from '@/components/primitives/Panel'
import { ProvenanceChip } from '@/components/primitives/ProvenanceChip'
import { OpsShell } from '@/components/shell/OpsShell'
import type { Provenance } from '@/lib/provenance'

const mirrorProvenance: Provenance = {
  source_authority: 'third_party_mirror',
  transformation: 'derived',
  method: 'weekly_baseline_v1',
  source_checksum: '9191e0…a604',
  generation_version: 'kspcid-etl-1.0.0',
}

function ContextFilters() {
  return (
    <div className="space-y-6">
      <label className="block">
        <span className="type-micro text-[--txt-3]">Search geography</span>
        <span className="mt-2 flex items-center gap-2 rounded-[--r-sm] border border-[--ink-500] bg-[--ink-800] px-3 py-2 text-[--txt-2]">
          <Search size={15} />
          <input
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[--txt-3]"
            placeholder="Station or division"
            aria-label="Search station or division"
          />
        </span>
      </label>
      <div>
        <p className="type-micro text-[--txt-3]">Audited corridor</p>
        <div className="mt-2 overflow-hidden rounded-[--r-md] border border-[--ink-600]">
          {['Kadugondana Halli', 'Banaswadi', 'Ramamurthy Nagar', 'K.R. Puram'].map(
            (station, index) => (
              <button
                key={station}
                type="button"
                className="flex w-full items-center justify-between border-b border-[--ink-600] px-3 py-3 text-left last:border-0 hover:bg-[--ink-700]"
              >
                <span>
                  <span className="block text-sm text-[--txt]">{station}</span>
                  <span className="text-[11px] text-[--txt-3]">
                    {index === 3 ? 'Whitefield division' : 'East division'}
                  </span>
                </span>
                <ChevronDown size={14} className="text-[--txt-3]" />
              </button>
            ),
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button className="flex items-center gap-2 rounded-[--r-sm] border border-[--ink-500] px-3 py-2 text-xs">
          <Clock3 size={14} /> 90 days
        </button>
        <button className="flex items-center gap-2 rounded-[--r-sm] border border-[--ink-500] px-3 py-2 text-xs">
          <SlidersHorizontal size={14} /> Filters
        </button>
      </div>
    </div>
  )
}

function MapFoundation() {
  return (
    <div className="relative h-full overflow-hidden bg-[--ink-900]">
      <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgb(56_189_248_/_0.08)_1px,transparent_1px),linear-gradient(90deg,rgb(56_189_248_/_0.08)_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_58%_48%,rgb(56_189_248_/_0.11),transparent_42%)]" />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 700" role="img" aria-label="Audited corridor foundation">
        <path d="M120 218 C270 170 330 330 470 292 S690 370 880 270" fill="none" stroke="#2B3849" strokeWidth="34" opacity=".55" />
        <path d="M120 218 C270 170 330 330 470 292 S690 370 880 270" fill="none" stroke="#38BDF8" strokeWidth="3" opacity=".65" />
        {[190, 365, 570, 790].map((x, index) => (
          <g key={x} transform={`translate(${x} ${index % 2 ? 286 : 232})`}>
            <circle r={64 - index * 5} fill="#F79009" opacity={0.08 + index * 0.02} />
            <circle r={28} fill="#F0A800" opacity=".11" />
            <circle r={5} fill="#FFC53D" />
          </g>
        ))}
      </svg>
      <div className="absolute left-6 top-6 flex items-center gap-2 rounded-[--r-md] border border-[--ink-500] bg-[rgb(10_15_22_/_0.94)] px-3 py-2 text-xs shadow-2xl">
        <Layers3 size={15} className="text-[--cyan-400]" />
        H3 r9 demand · reported + inferred aggregates
      </div>
      <div className="absolute bottom-6 left-6 grid grid-cols-3 gap-3">
        <MetricTile label="Registered FIRs" value="3,687" delta={8.4} comparison="vs range" series={[8, 11, 9, 12, 15, 14, 18, 23]} />
        <MetricTile label="Reported coords" value="22.29%" delta={-1.7} comparison="vs city" series={[28, 26, 25, 24, 24, 23, 22, 22]} />
        <MetricTile label="Cross-division" value="1" delta={0} comparison="boundary" series={[1, 1, 1, 1, 1, 1, 1, 1]} />
      </div>
    </div>
  )
}

function InspectorContent() {
  return (
    <div className="space-y-4">
      <ProvenanceChip
        provenance={mirrorProvenance}
        derivation="Derived. Weekly station × crime-head baselines are fit only inside the complete 2016–2023 collection window. The 12,654 partial-window 2024 rows are excluded."
      />
      <Panel title="Why this area?" eyebrow="90-DAY SIGNAL">
        <p className="text-sm leading-6 text-[--txt-2]">
          Two-wheeler theft is the audited corridor signal. The four stations form a
          contiguous west-to-east chain crossing from East into Whitefield division.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[--ink-600] pt-4 text-xs">
          <div><dt className="text-[--txt-3]">Routing cells</dt><dd className="mt-1 font-mono text-[--txt]">1,159</dd></div>
          <div><dt className="text-[--txt-3]">Validation</dt><dd className="mt-1 font-mono text-[--ok]">PASS</dd></div>
          <div><dt className="text-[--txt-3]">Time model</dt><dd className="mt-1 font-mono text-[--txt]">inferred</dd></div>
          <div><dt className="text-[--txt-3]">OSRM host</dt><dd className="mt-1 font-mono text-[--txt]">:5001</dd></div>
        </dl>
      </Panel>
    </div>
  )
}

function Timeline() {
  return (
    <div className="flex h-full items-center gap-4 px-6">
      <span className="type-micro whitespace-nowrap text-[--txt-3]">2019 — 2023</span>
      <div className="flex h-11 flex-1 items-end gap-[3px]">
        {Array.from({ length: 72 }, (_, index) => (
          <span
            key={index}
            className="min-w-0 flex-1"
            style={{
              height: `${18 + ((index * 17) % 70)}%`,
              backgroundColor: 'var(--cyan-400)',
              opacity: 0.4,
            }}
          />
        ))}
      </div>
      <span className="rounded-[--r-sm] border border-[--ink-500] px-3 py-2 text-xs text-[--txt-2]">
        Week 33 · IST
      </span>
    </div>
  )
}

export default function MapPage() {
  return (
    <OpsShell
      title="Command Map"
      eyebrow="DETECT · EXPLAIN"
      context={<ContextFilters />}
      inspector={<InspectorContent />}
      timeline={<Timeline />}
    >
      <MapFoundation />
    </OpsShell>
  )
}
