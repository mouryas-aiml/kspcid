export const dur = { micro: 0.12, base: 0.22, panel: 0.4, fly: 0.9 } as const

export const ease = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
  snap: [0.34, 1.56, 0.64, 1],
} as const

export const spring = {
  type: 'spring',
  stiffness: 320,
  damping: 34,
  mass: 0.9,
} as const
