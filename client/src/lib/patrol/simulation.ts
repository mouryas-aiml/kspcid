import { travelSeconds } from './routing'
import type { Deployment, PatrolData, ReplayEvent } from './types'

export interface SimulatedDispatch {
  readonly event: ReplayEvent
  readonly unitId: string | null
  readonly responseMinutes: number | null
  readonly result: 'enroute' | 'on_scene' | 'returning' | 'complete' | 'missed'
}

export interface SimulationSnapshot {
  readonly dispatches: readonly SimulatedDispatch[]
  readonly missed: number
  readonly completed: number
  readonly active: number
}

export function simulateUntil(
  data: PatrolData,
  deployment: Deployment,
  minute: number,
  rain: boolean,
  roadClosure: boolean,
): SimulationSnapshot {
  const conditionFactor =
    (rain ? data.scenario.conditions.rain_multiplier : 1) *
    (roadClosure ? data.scenario.conditions.road_closure_multiplier : 1)
  const availableAt = new Map<string, number>()
  const dispatches: SimulatedDispatch[] = []
  const events = data.scenario.replay_events.filter((event) => event.simulation_minute <= minute)

  for (const event of events) {
    const candidates = data.scenario.roster
      .filter((unit) => {
        const post = deployment[unit.unit_id]
        return post !== null && post !== undefined && (availableAt.get(unit.unit_id) ?? 0) <= event.simulation_minute
      })
      .map((unit) => {
        const post = deployment[unit.unit_id]!
        return {
          unit,
          response: (travelSeconds(data, post, event.hex_index) * conditionFactor) / 60,
        }
      })
      .sort(
        (a, b) =>
          a.response - b.response || a.unit.unit_id.localeCompare(b.unit.unit_id),
      )
    const selected = candidates[0]
    if (!selected || !Number.isFinite(selected.response) || selected.response > 20) {
      dispatches.push({ event, unitId: null, responseMinutes: null, result: 'missed' })
      continue
    }
    const travel = Math.ceil(selected.response)
    const arrival = event.simulation_minute + travel
    const serviceEnd = arrival + event.service_minutes
    const returnEnd = serviceEnd + travel
    availableAt.set(selected.unit.unit_id, returnEnd)
    const result =
      minute < arrival
        ? 'enroute'
        : minute < serviceEnd
          ? 'on_scene'
          : minute < returnEnd
            ? 'returning'
            : 'complete'
    dispatches.push({
      event,
      unitId: selected.unit.unit_id,
      responseMinutes: selected.response,
      result,
    })
  }
  return {
    dispatches,
    missed: dispatches.filter((dispatch) => dispatch.result === 'missed').length,
    completed: dispatches.filter((dispatch) => dispatch.result === 'complete').length,
    active: dispatches.filter((dispatch) =>
      ['enroute', 'on_scene', 'returning'].includes(dispatch.result),
    ).length,
  }
}
