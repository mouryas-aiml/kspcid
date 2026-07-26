/**
 * `kv-similar` — graph-independent, explainable MO-vector similarity.
 *
 * The precompiled fixture retains component scores rather than only one final
 * rank, so a user can change the published weights without a graph service or
 * an opaque model call.
 */
import {
  createDataAdapter,
  type CreateDataAdapterOptions,
  type DataAdapter,
} from '../shared/data-access/index.js'

export interface SimilarityWeights {
  readonly sections: number
  readonly premise: number
  readonly geography: number
  readonly time: number
  readonly victim: number
  readonly weapon: number
}

interface SimilarityCandidate {
  readonly incident_id: string
  readonly case_ref: string
  readonly registered_on: string
  readonly unit_name: string
  readonly station_code: string
  readonly police_division: string
  readonly geo_origin: string
  readonly time_origin: string
  readonly hour_confidence: number
  readonly sections: readonly string[]
  readonly premise_tokens: readonly string[]
  readonly time_band: string | null
  readonly victim_profile: readonly string[]
  readonly weapon_hints: readonly string[]
  readonly components: SimilarityWeights
  readonly distance_km: number
  readonly days_earlier: number
  readonly shared_sections: readonly string[]
  readonly shared_premise_tokens: readonly string[]
}

interface SimilarityFixture {
  readonly fixture_id: string
  readonly weights: SimilarityWeights
  readonly cases: readonly {
    readonly target: Omit<SimilarityCandidate, 'components' | 'distance_km' | 'days_earlier' | 'shared_sections' | 'shared_premise_tokens'>
    readonly candidates: readonly SimilarityCandidate[]
  }[]
  readonly provenance: {
    readonly source_authority: 'third_party_mirror'
    readonly transformation: 'derived'
    readonly method: string
    readonly source_checksum: string
    readonly generation_version: string
  }
}

export interface SimilarityRequest {
  readonly incidentId: string
  readonly weights?: Partial<SimilarityWeights>
  readonly limit?: number
}

function normalizeWeights(
  defaults: SimilarityWeights,
  override: Partial<SimilarityWeights> = {},
): SimilarityWeights {
  const merged = { ...defaults, ...override }
  const values = Object.values(merged)
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Similarity weights must be finite and non-negative')
  }
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0) throw new Error('At least one similarity weight must be positive')
  return Object.fromEntries(
    Object.entries(merged).map(([key, value]) => [key, value / total]),
  ) as unknown as SimilarityWeights
}

function score(candidate: SimilarityCandidate, weights: SimilarityWeights): number {
  return (
    candidate.components.sections * weights.sections +
    candidate.components.premise * weights.premise +
    candidate.components.geography * weights.geography +
    candidate.components.time * weights.time +
    candidate.components.victim * weights.victim +
    candidate.components.weapon * weights.weapon
  )
}

function explanation(candidate: SimilarityCandidate): string {
  const clauses: string[] = []
  if (candidate.shared_sections.length > 0) {
    clauses.push(`same ${candidate.shared_sections.slice(0, 2).join(' + ')} sections`)
  }
  if (candidate.shared_premise_tokens.length > 0) {
    clauses.push(`${candidate.shared_premise_tokens.slice(0, 2).join(' / ')} premise wording`)
  }
  if (candidate.distance_km < 5) clauses.push(`${candidate.distance_km.toFixed(1)} km away`)
  if (candidate.components.time >= 0.99 && candidate.time_band) {
    clauses.push(`same ${candidate.time_band.replaceAll('_', ' ')} time band`)
  }
  if (candidate.components.victim >= 0.99 && candidate.victim_profile.length > 0) {
    clauses.push(`matching victim profile`)
  }
  return clauses.slice(0, 4).join(' · ') || 'similar hashed MO feature pattern'
}

export async function similarWithAdapter(
  request: SimilarityRequest,
  adapter: DataAdapter,
) {
  const fixture = await adapter.getDocument<SimilarityFixture>({
    collection: 'scenarios',
    id: 'similarity_demo',
  })
  if (!fixture) throw new Error('Similarity scenario is missing from NoSQL')
  const selected = fixture.cases.find(({ target }) => target.incident_id === request.incidentId)
  if (!selected) throw new Error(`Similarity target is not in the offline fixture: ${request.incidentId}`)
  const weights = normalizeWeights(fixture.weights, request.weights)
  const limit = Math.max(1, Math.min(25, Math.floor(request.limit ?? 10)))
  const matches = selected.candidates
    .map((candidate) => ({
      ...candidate,
      similarity: score(candidate, weights),
      explanation: explanation(candidate),
    }))
    .sort(
      (left, right) =>
        right.similarity - left.similarity ||
        left.incident_id.localeCompare(right.incident_id),
    )
    .slice(0, limit)
  return {
    target: selected.target,
    weights,
    matches,
    graph_dependency: false,
    fixture_id: fixture.fixture_id,
    provenance: fixture.provenance,
  }
}

export async function handleSimilar(
  request: SimilarityRequest,
  options: CreateDataAdapterOptions = {},
) {
  const adapter = createDataAdapter(options)
  try {
    return await similarWithAdapter(request, adapter)
  } finally {
    await adapter.close()
  }
}
