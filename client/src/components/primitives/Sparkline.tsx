'use client'

/**
 * The one sparkline (BUILD_SPEC §5.6, §5.7).
 *
 * There were three, each with its own normalisation: `MetricTile` scaled to
 * `[min, max]` of the series, `CommandFeed` scaled to `[0, max]`, and the
 * Command Map's timeline used a third. The same shape meant different things on
 * three screens, and a reader had no way to know.
 *
 * This one always scales from zero. A count sparkline whose baseline is the
 * series minimum exaggerates every wobble — a 13-week run of 4,4,4,4,5 looks
 * like a step change. Zero-based is the honest default for counts and is the
 * only mode offered.
 *
 * `expected` and `ucl` draw the §5.7 control band. `command_feed.json` has
 * carried `expected_count` and `ucl_99` on every alert since A16 and nothing
 * drew them, so the reader saw a rising line with no way to judge whether it was
 * unusual — which is the entire claim the alert is making.
 */
import { Group } from '@visx/group'
import { scaleLinear } from '@visx/scale'
import { LinePath } from '@visx/shape'
import { curveMonotoneX } from '@visx/curve'

interface SparklineProps {
  readonly values: readonly number[]
  /** Control-chart centre line, e.g. `expected_count`. Omitted when absent. */
  readonly expected?: number | null
  /** Control-chart upper limit, e.g. `ucl_99`. Omitted when absent. */
  readonly ucl?: number | null
  readonly width?: number
  readonly height?: number
  /** Accessible description; §5.7 requires every chart to say what it is. */
  readonly label: string
  readonly className?: string
}

export function Sparkline({
  values,
  expected,
  ucl,
  width = 220,
  height = 52,
  label,
  className = 'h-14 w-full',
}: SparklineProps) {
  const margin = { top: 6, right: 4, bottom: 6, left: 4 }
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom

  const band = [expected, ucl].filter((value): value is number => typeof value === 'number')
  const maximum = Math.max(1, ...values, ...band)

  const x = scaleLinear({ domain: [0, Math.max(1, values.length - 1)], range: [0, innerWidth] })
  // Zero-based, always. See the note above.
  const y = scaleLinear({ domain: [0, maximum], range: [innerHeight, 0] })

  const points = values.map((value, index) => ({ index, value }))
  const last = points.at(-1)

  return (
    <svg
      aria-label={label}
      className={className}
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <Group left={margin.left} top={margin.top}>
        {/* Control band: expected → UCL. Anything above the band is the claim. */}
        {typeof expected === 'number' && typeof ucl === 'number' && ucl > expected ? (
          <>
            <rect
              x={0}
              y={y(ucl)}
              width={innerWidth}
              height={Math.max(1, y(expected) - y(ucl))}
              fill="var(--warn)"
              opacity={0.12}
            />
            <line
              x1={0}
              x2={innerWidth}
              y1={y(ucl)}
              y2={y(ucl)}
              stroke="var(--warn)"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            <line
              x1={0}
              x2={innerWidth}
              y1={y(expected)}
              y2={y(expected)}
              stroke="var(--txt-3)"
              strokeWidth={1}
            />
          </>
        ) : null}

        <line
          x1={0}
          x2={innerWidth}
          y1={innerHeight}
          y2={innerHeight}
          stroke="var(--ink-600)"
          strokeWidth={1}
        />

        <LinePath
          curve={curveMonotoneX}
          data={points}
          x={(point) => x(point.index)}
          y={(point) => y(point.value)}
          stroke="var(--cyan-400)"
          strokeWidth={2}
          strokeLinejoin="round"
          fill="none"
        />

        {/* The current period, marked. It is the value the alert is about. */}
        {last ? (
          <circle
            cx={x(last.index)}
            cy={y(last.value)}
            r={3.5}
            fill={
              typeof ucl === 'number' && ucl > 0 && last.value > ucl
                ? 'var(--critical)'
                : 'var(--gold-400)'
            }
          />
        ) : null}
      </Group>
    </svg>
  )
}
