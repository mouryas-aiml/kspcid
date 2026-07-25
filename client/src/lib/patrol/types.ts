export interface RoutingCell {
  readonly index: number
  readonly h3: string
  readonly latitude: number
  readonly longitude: number
  readonly core_station_code: string | null
  readonly core_station_name: string | null
}

export interface RoutingRegion {
  readonly id: string
  readonly name: string
  readonly cells: number
  readonly response_budgets_seconds: readonly number[]
  readonly words_per_bitset: number
}

export interface HexIndex {
  readonly region_id: string
  readonly h3_resolution: number
  readonly cells: readonly RoutingCell[]
}

export interface BeatDemand {
  readonly beat: string
  readonly incident_count: number
  readonly recency_weighted_demand: number
}

export interface CellDemand {
  readonly hex_index: number
  readonly incident_count: number
  readonly recency_weighted_demand: number
  readonly beat_demand: readonly BeatDemand[]
}

export interface PatrolUnit {
  readonly unit_id: string
  readonly unit_type: string
  readonly call_sign: string
  readonly start_hex_index: number
  readonly generated: true
}

export interface ReplayEvent {
  readonly incident_id: string
  readonly case_ref: string
  readonly hex_index: number
  readonly simulation_minute: number
  readonly service_minutes: number
  readonly registered_on: string
  readonly estimated_occurrence_hour: number
  readonly hour_confidence: number
  readonly geo_origin: string
  readonly time_origin: string
}

export interface PatrolScenario {
  readonly schema_version: number
  readonly scenario_id: string
  readonly region_id: string
  readonly title: string
  readonly purpose: string
  readonly time_window: {
    readonly start: string
    readonly end: string
    readonly complete_window: boolean
    readonly selected_hours_local: readonly number[]
    readonly shift_minutes: number
  }
  readonly demand_model: {
    readonly crime_group: string
    readonly crime_head: string
    readonly half_life_days: number
    readonly observed_rows_in_shift: number
    readonly total_recency_weighted_demand: number
    readonly h3_resolution: number
    readonly demand: readonly CellDemand[]
  }
  readonly planning_defaults: {
    readonly response_target_minutes: number
    readonly reserve_units: number
    readonly response_budget_seconds: number
    readonly baseline_posts: readonly { station_code: string; hex_index: number }[]
    readonly weather: string
    readonly road_closure: null
  }
  readonly integrated_scenario: {
    readonly corridor: string
    readonly narrative_stations: readonly string[]
    readonly crosses_division_boundary: boolean
    readonly phase: string
  }
  readonly conditions: {
    readonly free_flow_multiplier: number
    readonly rain_multiplier: number
    readonly road_closure_multiplier: number
    readonly geometry_changes_at_runtime: boolean
  }
  readonly injections: readonly {
    readonly injection_id: string
    readonly type: string
    readonly title: string
    readonly simulation_minute: number
    readonly local_time: string
    readonly decision_seconds: number
    readonly location: string
    readonly options: readonly string[]
    readonly generated: true
    readonly scenario_id: string
    readonly source_authority: string
    readonly transformation: string
    readonly generation_version: string
  }[]
  readonly roster: readonly PatrolUnit[]
  readonly replay_events: readonly ReplayEvent[]
  readonly provenance: {
    readonly source_authority: string
    readonly transformation: string
    readonly source_checksum: string
    readonly routing_source_checksum: string
    readonly generated_roster: boolean
    readonly generation_version: string
  }
}

export interface PatrolData {
  readonly region: RoutingRegion
  readonly hexIndex: HexIndex
  readonly scenario: PatrolScenario
  readonly durations: Float32Array
  readonly coverage: Uint32Array
}

export type Deployment = Record<string, number | null>

export interface ScoreBreakdown {
  readonly total: number
  readonly grade: string
  readonly coveragePoints: number
  readonly responsePoints: number
  readonly equityPoints: number
  readonly reservePoints: number
  readonly efficiencyPoints: number
  readonly coverageRatio: number
  readonly p50Minutes: number
  readonly p90Minutes: number
  readonly equity: number
  readonly reserveCount: number
  readonly totalUnitKm: number
}

export interface OptimizationResult {
  readonly deployment: Deployment
  readonly score: ScoreBreakdown
  readonly elapsedMs: number
  readonly method: 'greedy_local_search_equity_repair'
  readonly iterations: number
}
