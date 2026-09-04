import { isCatalystClientHosting, publicPath } from './publicPath'

export type StateMode = 'risk' | 'rate' | 'urban'
export interface Outlook {
  history: Array<{ week: string; value: number }>
  forecast: Array<{ week: string; expected: number }>
  forecast_4w: { low: number; expected: number; high: number; baseline: number }
  risk: { score: number; band: 'Priority' | 'Monitor' | 'Stable'; components: { recent_anomaly: number; forecast_uplift: number; persistence: number } }
}
export interface StateDistrict {
  district_id: string
  name: string
  police_units: Array<{ name: string; registrations: number }>
  context: { population: number; area_sq_km: number; density_per_sq_km: number; urban_share_pct: number }
  fir_total_2019_2023: number
  fir_rate_per_lakh: number
  history: Outlook['history']
  forecast: Outlook['forecast']
  forecast_4w: Outlook['forecast_4w']
  risk: Outlook['risk']
  outlooks: Record<string, Outlook | null>
  top_emerging_categories: Array<{ crime_group: string; score: number; band: string }>
}
export interface StateIntelligenceData {
  schema_version: string
  snapshot_through: string
  crime_groups: string[]
  state_summary: { districts: number; special_units: number; source_rows: number; top_priority: string[] }
  districts: StateDistrict[]
  special_units: Array<{ name: string; registrations: number }>
  backtest: { observations: number; four_week_mae: number; interval_10_90_coverage_pct: number; spearman_risk_to_next_4w: number | null; top_quintile_lift: number }
  provenance: Record<string, unknown>
}

export async function loadStateIntelligence(signal?: AbortSignal): Promise<{ data: StateIntelligenceData; live: boolean }> {
  const staticRequest = fetch(publicPath('/data/scenarios/state_intelligence.json'), { signal }).then(async (response) => {
    if (!response.ok) throw new Error(`State Intelligence artifact HTTP ${response.status}`)
    return response.json() as Promise<StateIntelligenceData>
  })
  const apiBase = process.env.NEXT_PUBLIC_CATALYST_API_BASE?.replace(/\/+$/, '')
  const stateEndpoint = apiBase ? `${apiBase}/state` : isCatalystClientHosting ? `${window.location.origin}/server/kv-state/execute` : null
  if (stateEndpoint) {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 2_000)
    signal?.addEventListener('abort', () => controller.abort(), { once: true })
    try {
      const response = await fetch(`${stateEndpoint}?mode=risk&crimeGroup=${encodeURIComponent('All registered crime')}`, { signal: controller.signal })
      if (!response.ok) throw new Error(`Catalyst state HTTP ${response.status}`)
      const envelope = await response.json() as StateIntelligenceData | { output?: string }
      const data = 'output' in envelope && typeof envelope.output === 'string'
        ? JSON.parse(envelope.output) as StateIntelligenceData
        : envelope as StateIntelligenceData
      if (data.schema_version !== '1.0.0' || data.districts.length !== 31) throw new Error('Unexpected State Intelligence schema')
      return { data, live: true }
    } catch {
      // The same versioned publication is packaged with the static client.
    } finally { window.clearTimeout(timer) }
  }
  return { data: await staticRequest, live: false }
}
