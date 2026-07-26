'use client'

/**
 * Pulse Ring — the 24-hour heartbeat (BUILD_SPEC §1.4, §7.1).
 *
 * Angular axis is hour 0–23 with midnight at the top; concentric rings are the
 * cell's top crime heads, innermost highest-volume; arc fill is the magma ramp.
 *
 * The point of the chart is the **overlay**: the generated shift roster as a
 * translucent gold band. §1.4 — "the gap between crime peak and patrol strength
 * is the insight". Without the band this is a decorative clock.
 *
 * The caption is computed from the data on screen, never a fixed string. §1.4
 * gives *"Peak 20:00–23:00 · patrol strength falls 21:00"* as an example from an
 * illustrative cell; hard-coding it would put a finding on screen that this
 * fixture does not support.
 */
import { Arc } from '@visx/shape'
import { Group } from '@visx/group'

import { magmaCss } from '@/lib/geo'

export interface PulseRingData {
  readonly h3_r9: string
  readonly crime_heads: readonly string[]
  readonly hourly: readonly {
    crime_head: string
    estimated_occurrence_hour: number
    count: number
  }[]
  readonly generated_roster_strength: readonly number[]
}

const SIZE = 280
const CENTRE = SIZE / 2
const INNER_RADIUS = 42
const RING_STEP = 18
const HOURS = 24
const RADIANS_PER_HOUR = (Math.PI * 2) / HOURS

/** Roster band sits outside the crime rings so it never obscures them. */
const ROSTER_INNER = 118
const ROSTER_OUTER = 138

function pad(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/** The hour carrying the most records. Ties resolve to the earliest hour. */
function peakHour(totals: readonly number[]): { hour: number; count: number } {
  let hour = 0
  let count = -1
  totals.forEach((value, index) => {
    if (value > count) {
      count = value
      hour = index
    }
  })
  return { hour, count }
}

/** The hour at which the roster drops the most from the hour before it. */
function largestFall(strength: readonly number[]): { hour: number; drop: number } {
  let hour = 0
  let drop = 0
  for (let index = 0; index < strength.length; index += 1) {
    const previous = strength[(index - 1 + strength.length) % strength.length] ?? 0
    const delta = previous - (strength[index] ?? 0)
    if (delta > drop) {
      drop = delta
      hour = index
    }
  }
  return { hour, drop }
}

export function PulseRing({ data }: { readonly data: PulseRingData }) {
  const rings = data.crime_heads.slice(0, 5)
  const maximum = Math.max(1, ...data.hourly.map((row) => row.count))
  const totalRecords = data.hourly.reduce((sum, row) => sum + row.count, 0)

  const hourTotals = Array.from({ length: HOURS }, (_, hour) =>
    data.hourly
      .filter((row) => row.estimated_occurrence_hour === hour)
      .reduce((sum, row) => sum + row.count, 0),
  )
  const peak = peakHour(hourTotals)
  const fall = largestFall(data.generated_roster_strength)

  const maxStrength = Math.max(1, ...data.generated_roster_strength)
  /**
   * The roster is an annulus, not a filled disc: the outer edge varies with
   * strength and the inner edge is fixed, so the *thickness* at each hour is the
   * reading. A single closed polygon at the outer radii would fill the whole
   * ring and bury the crime arcs underneath it.
   */
  const rosterBand = (() => {
    const point = (hour: number, radius: number) => {
      const angle = hour * RADIANS_PER_HOUR - Math.PI / 2
      return `${(CENTRE + Math.cos(angle) * radius).toFixed(2)},${(CENTRE + Math.sin(angle) * radius).toFixed(2)}`
    }
    const outer = data.generated_roster_strength.map((strength, hour) =>
      point(hour, ROSTER_INNER + (strength / maxStrength) * (ROSTER_OUTER - ROSTER_INNER)),
    )
    // Inner edge reversed, so the two contours wind oppositely and the
    // even-odd fill leaves the middle of the chart clear.
    const inner = data.generated_roster_strength
      .map((_, hour) => point(hour, ROSTER_INNER))
      .reverse()
    return `M${outer.join(' L')} Z M${inner.join(' L')} Z`
  })()

  return (
    <figure className="mt-4">
      <svg
        aria-label={`24-hour derived occurrence pulse for ${data.h3_r9}, with the generated shift roster overlaid`}
        className="mx-auto h-[250px] w-[250px]"
        role="img"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
      >
        <Group>
          {rings.map((_, index) => (
            <circle
              cx={CENTRE}
              cy={CENTRE}
              fill="none"
              key={index}
              r={INNER_RADIUS + index * RING_STEP}
              stroke="var(--ink-600)"
            />
          ))}

          {/* Roster band — the overlay §1.4 calls the insight. */}
          <path
            d={rosterBand}
            fill="var(--gold-400)"
            fillOpacity={0.22}
            fillRule="evenodd"
            stroke="var(--gold-400)"
            strokeOpacity={0.5}
            strokeWidth={1}
          />

          {data.hourly.map((row) => {
            const ring = rings.indexOf(row.crime_head)
            if (ring < 0) return null
            const radius = INNER_RADIUS + ring * RING_STEP
            const start = row.estimated_occurrence_hour * RADIANS_PER_HOUR
            return (
              <Arc
                cornerRadius={2}
                endAngle={start + RADIANS_PER_HOUR * 0.86}
                fill={magmaCss(row.count / maximum)}
                innerRadius={radius - 4}
                key={`${row.crime_head}-${row.estimated_occurrence_hour}`}
                outerRadius={radius + 4}
                startAngle={start}
                transform={`translate(${CENTRE}, ${CENTRE})`}
              />
            )
          })}

          <text
            fill="var(--txt-2)"
            fontSize="9"
            textAnchor="middle"
            x={CENTRE}
            y={CENTRE - 4}
          >
            DERIVED HOURS
          </text>
          <text
            className="tabular-nums"
            fill="var(--gold-400)"
            fontSize="9"
            textAnchor="middle"
            x={CENTRE}
            y={CENTRE + 11}
          >
            GOLD · GENERATED ROSTER
          </text>

          {[0, 6, 12, 18].map((hour) => {
            const angle = hour * RADIANS_PER_HOUR - Math.PI / 2
            return (
              <text
                className="tabular-nums"
                fill="var(--txt-3)"
                fontSize="8"
                key={hour}
                textAnchor="middle"
                x={CENTRE + Math.cos(angle) * (ROSTER_OUTER + 8)}
                y={CENTRE + Math.sin(angle) * (ROSTER_OUTER + 8) + 3}
              >
                {String(hour).padStart(2, '0')}
              </text>
            )
          })}
        </Group>
      </svg>

      {/*
        §5.7 — the caption is the axis label this chart would otherwise need.
        Every number in it is computed from the rows above.
      */}
      <figcaption className="mt-3 space-y-1 text-[11px] leading-4 tabular-nums text-[--txt-2]">
        <p>
          Peak <strong className="text-[--txt-hi]">{pad(peak.hour)}</strong>
          {' · patrol strength falls '}
          <strong className="text-[--gold-400]">{pad(fall.hour)}</strong>
          {fall.drop > 0 ? ` (−${fall.drop} units)` : ''}
        </p>
        <p className="text-[--txt-3]">
          {totalRecords} record{totalRecords === 1 ? '' : 's'} with a derived hour in this cell
          {totalRecords < 30 ? ' — too few to read as a shift pattern; shown as the cell’s own history, not a rate.' : '.'}
        </p>
      </figcaption>
    </figure>
  )
}
