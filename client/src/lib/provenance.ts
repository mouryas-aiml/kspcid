export type SourceAuthority =
  | 'official_ksp'
  | 'official_open_data'
  | 'third_party_mirror'
  | 'open_reference'
  | 'generated_demo'

export type Transformation =
  | 'verbatim'
  | 'normalized'
  | 'derived'
  | 'inferred'
  | 'generated'

export interface Provenance {
  readonly source_authority: SourceAuthority
  readonly transformation: Transformation
  readonly confidence?: number
  readonly method?: string
  readonly source_checksum: string
  readonly generation_version: string
}

export const authorityMeta: Record<
  SourceAuthority,
  { readonly label: string; readonly color: string }
> = {
  official_ksp: { label: 'KSP official', color: 'var(--prov-official)' },
  official_open_data: { label: 'Official open data', color: 'var(--prov-official)' },
  third_party_mirror: {
    label: 'Third-party FIR mirror',
    color: 'var(--prov-third-party)',
  },
  open_reference: { label: 'Open reference', color: 'var(--prov-open-reference)' },
  generated_demo: {
    label: 'Generated demonstration',
    color: 'var(--prov-generated)',
  },
}

export const transformationLabel: Record<Transformation, string> = {
  verbatim: 'verbatim',
  normalized: 'normalized',
  derived: 'derived',
  inferred: 'inferred',
  generated: 'generated',
}
