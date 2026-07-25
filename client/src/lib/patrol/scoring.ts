import { budgetIndex, isCovered, travelSeconds, unionCoverage } from './routing'
import type { Deployment, PatrolData, ScoreBreakdown } from './types'

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0
}

function gini(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const total = sorted.reduce((sum, value) => sum + value, 0)
  if (sorted.length === 0 || total === 0) return 0
  const weighted = sorted.reduce((sum, value, index) => sum + (index + 1) * value, 0)
  return (2 * weighted) / (sorted.length * total) - (sorted.length + 1) / sorted.length
}

function grade(total: number): string {
  if (total < 500) return 'Needs revision'
  if (total < 650) return 'Bronze'
  if (total < 790) return 'Silver'
  if (total < 900) return 'Gold'
  return "Commissioner's Commendation"
}

export function scoreDeployment(
  data: PatrolData,
  deployment: Deployment,
  targetMinutes: number,
  requiredReserve: number,
  rain = false,
  roadClosure = false,
): ScoreBreakdown {
  const selectedBudget = Math.max(0, budgetIndex(data.region, targetMinutes))
  const covered = unionCoverage(data, deployment, selectedBudget)
  let hit = 0
  let totalDemand = 0
  const beatHit = new Map<string, number>()
  const beatTotal = new Map<string, number>()
  for (const cell of data.scenario.demand_model.demand) {
    const cellCovered = isCovered(covered, cell.hex_index)
    totalDemand += cell.recency_weighted_demand
    if (cellCovered) hit += cell.recency_weighted_demand
    for (const beat of cell.beat_demand) {
      beatTotal.set(beat.beat, (beatTotal.get(beat.beat) ?? 0) + beat.recency_weighted_demand)
      if (cellCovered) {
        beatHit.set(beat.beat, (beatHit.get(beat.beat) ?? 0) + beat.recency_weighted_demand)
      }
    }
  }
  const coverageRatio = totalDemand > 0 ? hit / totalDemand : 0
  const active = Object.values(deployment).filter((hex): hex is number => hex !== null)
  const conditionFactor = (rain ? 1.35 : 1) * (roadClosure ? 1.12 : 1)
  const responseMinutes = data.scenario.replay_events.map((event) => {
    const fastest = Math.min(...active.map((origin) => travelSeconds(data, origin, event.hex_index)))
    return Number.isFinite(fastest) ? (fastest * conditionFactor) / 60 : targetMinutes * 3
  })
  const p50Minutes = percentile(responseMinutes, 0.5)
  const p90Minutes = percentile(responseMinutes, 0.9)
  const beatCoverage = [...beatTotal].map(
    ([beat, beatDemand]) => (beatHit.get(beat) ?? 0) / beatDemand,
  )
  const equity = 1 - gini(beatCoverage)
  const reserveCount = Object.values(deployment).filter((hex) => hex === null).length
  const reserveRatio = requiredReserve > 0 ? clamp(reserveCount / requiredReserve) : 1
  const totalUnitKm = data.scenario.roster.reduce((sum, unit) => {
    const deployed = deployment[unit.unit_id]
    if (deployed === null || deployed === undefined) return sum
    const seconds = travelSeconds(data, unit.start_hex_index, deployed)
    return sum + (Number.isFinite(seconds) ? seconds * 0.00667 : 0)
  }, 0)
  const coveragePoints = 400 * coverageRatio
  const responsePoints =
    150 * (1 - clamp(p50Minutes / targetMinutes)) +
    100 * (1 - clamp(p90Minutes / (1.75 * targetMinutes)))
  const equityPoints = 150 * equity
  const reservePoints = 100 * reserveRatio
  const efficiencyPoints = 100 * (1 - clamp(totalUnitKm / 80))
  const total = Math.round(
    coveragePoints + responsePoints + equityPoints + reservePoints + efficiencyPoints,
  )
  return {
    total,
    grade: grade(total),
    coveragePoints,
    responsePoints,
    equityPoints,
    reservePoints,
    efficiencyPoints,
    coverageRatio,
    p50Minutes,
    p90Minutes,
    equity,
    reserveCount,
    totalUnitKm,
  }
}
