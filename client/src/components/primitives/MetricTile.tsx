import { Sparkline } from './Sparkline'

interface MetricTileProps {
  readonly label: string
  readonly value: string
  readonly delta: number
  readonly comparison: string
  readonly series: readonly number[]
  /** Optional control-chart context, drawn when the caller has it. */
  readonly expected?: number | null
  readonly ucl?: number | null
}

function labelSeries(series: readonly number[]): string {
  const first = series[0] ?? 0
  const last = series.at(-1) ?? 0
  return last >= first ? 'Rising' : 'Falling'
}

export function MetricTile({
  label,
  value,
  delta,
  comparison,
  series,
  expected,
  ucl,
}: MetricTileProps) {
  const direction = delta >= 0 ? '↑' : '↓'
  return (
    <article className="metric-tile">
      <p className="type-micro text-[--txt-3]">{label}</p>
      {/* §5.6 — the value is tabular so a column of tiles aligns. */}
      <p className="type-metric mt-2 tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[--txt-2]">
        {/*
          §5.6 — the delta is coloured by DIRECTION, not by good/bad. Whether a
          rise is good is the reader's call and depends on the metric; the chart
          only says which way it moved.
        */}
        <span className={`tabular-nums ${delta >= 0 ? 'text-[--gold-400]' : 'text-[--cyan-300]'}`}>
          {direction} {Math.abs(delta).toFixed(1)}%
        </span>{' '}
        {comparison}
      </p>
      <Sparkline
        className="h-10 w-full"
        expected={expected}
        height={40}
        label={`${label}: ${labelSeries(series)} trend`}
        ucl={ucl}
        values={series}
        width={120}
      />
    </article>
  )
}
