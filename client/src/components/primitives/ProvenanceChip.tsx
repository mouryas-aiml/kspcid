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
}

export function ProvenanceChip({
  provenance,
  derivation,
  className,
}: ProvenanceChipProps) {
  const authority = authorityMeta[provenance.source_authority]
  return (
    <details className={`provenance-chip ${className ?? ''}`}>
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
