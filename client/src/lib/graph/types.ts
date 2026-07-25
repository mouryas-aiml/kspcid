export interface GraphProvenance {
  readonly source_authority: string
  readonly transformation: string
  readonly method?: string
  readonly source_checksum: string
  readonly generation_version: string
}

export interface SnapshotNode {
  readonly id: string
  readonly type: 'incident' | 'person' | 'vehicle' | 'phone' | 'account'
  readonly label: string
  readonly scenario_id: string
  readonly attributes: {
    readonly incident_id?: string
    readonly case_ref?: string
    readonly registered_on?: string
    readonly station_code?: string
    readonly unit_name?: string
    readonly police_division?: string
    readonly crime_group?: string
    readonly crime_head?: string
    readonly h3_r9?: string
    readonly estimated_occurrence_hour?: number | null
    readonly time_origin?: string
    readonly geo_origin?: string
    readonly generated?: boolean
    readonly cluster?: number
    readonly ordinal?: number
  }
  readonly provenance: GraphProvenance
  readonly x: number
  readonly y: number
  readonly degree: number
  readonly size: number
  readonly community: number
  readonly bridge_score: number
  readonly always_label: boolean
}

export interface SnapshotEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly relation: string
  readonly support_type: 'generated_scenario' | 'model_similarity'
  readonly weight: number
  readonly scenario_id: string
  readonly explanation: string
  readonly provenance: GraphProvenance
  readonly style: {
    readonly line: 'dashed' | 'dotted'
    readonly width: number
    readonly opacity: number
  }
}

export interface GraphSnapshot {
  readonly schema_version: number
  readonly settled_layout: true
  readonly layout_method: string
  readonly community_method: string
  readonly modularity: number
  readonly communities: number
  readonly nodes: readonly SnapshotNode[]
  readonly edges: readonly SnapshotEdge[]
  readonly scenarios: readonly {
    readonly scenario_id: string
    readonly incidents: number
    readonly clusters: number
    readonly generated_entities: number
  }[]
}

export interface GraphSelection {
  readonly node: SnapshotNode | null
  readonly edge: SnapshotEdge | null
}

export interface GraphPath {
  readonly nodes: ReadonlySet<string>
  readonly edges: ReadonlySet<string>
}
