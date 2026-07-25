import { create } from 'zustand'

import type { Deployment, OptimizationResult, PatrolData } from './types'

type Phase = 'deploy' | 'simulate' | 'score' | 'compare'

interface PatrolState {
  data: PatrolData | null
  deployment: Deployment
  selectedUnit: string | null
  targetMinutes: number
  requiredReserve: number
  rain: boolean
  roadClosure: boolean
  phase: Phase
  minute: number
  speed: 1 | 4 | 16 | 60
  playing: boolean
  optimized: OptimizationResult | null
  showGhost: boolean
  setData: (data: PatrolData) => void
  selectUnit: (unitId: string | null) => void
  deploySelected: (hexIndex: number) => void
  toggleReserve: (unitId: string) => void
  reset: () => void
  setTarget: (minutes: number) => void
  setReserve: (units: number) => void
  toggleRain: () => void
  toggleClosure: () => void
  setPhase: (phase: Phase) => void
  setMinute: (minute: number) => void
  setSpeed: (speed: 1 | 4 | 16 | 60) => void
  setPlaying: (playing: boolean) => void
  setOptimized: (result: OptimizationResult) => void
  setShowGhost: (show: boolean) => void
}

function initialDeployment(data: PatrolData): Deployment {
  const reserve = data.scenario.planning_defaults.reserve_units
  return Object.fromEntries(
    data.scenario.roster.map((unit, index) => [
      unit.unit_id,
      index < data.scenario.roster.length - reserve ? unit.start_hex_index : null,
    ]),
  )
}

export const usePatrolStore = create<PatrolState>((set, get) => ({
  data: null,
  deployment: {},
  selectedUnit: null,
  targetMinutes: 7,
  requiredReserve: 2,
  rain: false,
  roadClosure: false,
  phase: 'deploy',
  minute: 0,
  speed: 4,
  playing: false,
  optimized: null,
  showGhost: false,
  setData: (data) =>
    set({
      data,
      deployment: initialDeployment(data),
      targetMinutes: data.scenario.planning_defaults.response_target_minutes,
      requiredReserve: data.scenario.planning_defaults.reserve_units,
    }),
  selectUnit: (selectedUnit) => set({ selectedUnit }),
  deploySelected: (hexIndex) => {
    const { selectedUnit, deployment } = get()
    if (!selectedUnit) return
    set({
      deployment: { ...deployment, [selectedUnit]: hexIndex },
      selectedUnit: null,
      optimized: null,
      showGhost: false,
    })
  },
  toggleReserve: (unitId) => {
    const { data, deployment } = get()
    if (!data) return
    const unit = data.scenario.roster.find((candidate) => candidate.unit_id === unitId)
    if (!unit) return
    set({
      deployment: {
        ...deployment,
        [unitId]: deployment[unitId] === null ? unit.start_hex_index : null,
      },
      optimized: null,
      showGhost: false,
    })
  },
  reset: () => {
    const { data } = get()
    if (!data) return
    set({
      deployment: initialDeployment(data),
      selectedUnit: null,
      phase: 'deploy',
      minute: 0,
      playing: false,
      rain: false,
      roadClosure: false,
      optimized: null,
      showGhost: false,
    })
  },
  setTarget: (targetMinutes) => set({ targetMinutes, optimized: null }),
  setReserve: (requiredReserve) => set({ requiredReserve, optimized: null }),
  toggleRain: () => set((state) => ({ rain: !state.rain })),
  toggleClosure: () => set((state) => ({ roadClosure: !state.roadClosure })),
  setPhase: (phase) => set({ phase }),
  setMinute: (minute) => set({ minute }),
  setSpeed: (speed) => set({ speed }),
  setPlaying: (playing) => set({ playing }),
  setOptimized: (optimized) => set({ optimized }),
  setShowGhost: (showGhost) => set({ showGhost }),
}))
