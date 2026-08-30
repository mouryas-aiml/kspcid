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
  official_ksp: { label: 'Official KSP report', color: 'var(--prov-official)' },
  official_open_data: { label: 'Official public data', color: 'var(--prov-official)' },
  third_party_mirror: {
    label: 'FIR dataset copy',
    color: 'var(--prov-third-party)',
  },
  open_reference: { label: 'Public reference', color: 'var(--prov-open-reference)' },
  generated_demo: {
    label: 'Demonstration data',
    color: 'var(--prov-generated)',
  },
}

export const transformationLabel: Record<Transformation, string> = {
  verbatim: 'as recorded',
  normalized: 'cleaned',
  derived: 'calculated',
  inferred: 'estimated',
  generated: 'demonstration',
}
