import { Info } from 'lucide-react'

import {
  authorityMeta,
  transformationLabel,
  type Provenance,
} from '@/lib/provenance'

interface ProvenanceChipProps {
  readonly provenance: Provenance
  readonly derivation: string
  readonly className?: string
  /**
   * `paper` restyles the chip for the light brief shell. The popover is
   * authored against the dark ops surface, so on paper it rendered dark text
   * on a dark panel; every brief page was patching that inline with the same
   * arbitrary-variant selector. One variant replaces those copies.
   */
  readonly variant?: 'ops' | 'paper'
}

export function ProvenanceChip({
  provenance,
  derivation,
  className,
  variant = 'ops',
}: ProvenanceChipProps) {
  const authority = authorityMeta[provenance.source_authority]
  return (
    <details
      className={`provenance-chip ${variant === 'paper' ? 'provenance-chip--paper' : ''} ${className ?? ''}`}
    >
      <summary>
        <span
          className="provenance-dot"
          style={{ backgroundColor: authority.color }}
          aria-hidden="true"
        />
        <span>
          {authority.label} · {transformationLabel[provenance.transformation]}
        </span>
        <Info size={11} aria-hidden="true" />
      </summary>
      <div className="provenance-popover" role="tooltip">
        <p>{derivation}</p>
        <dl>
          {provenance.method ? (
            <>
              <dt>Method</dt>
              <dd>{provenance.method}</dd>
            </>
          ) : null}
          {provenance.confidence !== undefined ? (
            <>
              <dt>Confidence</dt>
              <dd>{Math.round(provenance.confidence * 100)}%</dd>
            </>
          ) : null}
          <dt>Generation</dt>
          <dd>{provenance.generation_version}</dd>
        </dl>
      </div>
    </details>
  )
}
