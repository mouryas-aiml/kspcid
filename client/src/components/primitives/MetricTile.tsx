interface MetricTileProps {
  readonly label: string
  readonly value: string
  readonly delta: number
  readonly comparison: string
  readonly series: readonly number[]
}

function Sparkline({ series }: { readonly series: readonly number[] }) {
  const min = Math.min(...series)
  const max = Math.max(...series)
  const spread = max - min || 1
  const points = series
    .map((value, index) => {
      const x = series.length === 1 ? 0 : (index / (series.length - 1)) * 120
      const y = 32 - ((value - min) / spread) * 28
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg
      viewBox="0 0 120 36"
      className="h-10 w-full"
      role="img"
      aria-label={`${labelSeries(series)} trend`}
    >
      <path d="M0 34H120" stroke="var(--ink-600)" strokeWidth="1" />
      <polyline
        points={points}
        fill="none"
        stroke="var(--cyan-400)"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
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
}: MetricTileProps) {
  const direction = delta >= 0 ? '↑' : '↓'
  return (
    <article className="metric-tile">
      <p className="type-micro text-[--txt-3]">{label}</p>
      <p className="type-metric mt-2">{value}</p>
      <p className="mt-1 text-xs text-[--txt-2]">
        <span className={delta >= 0 ? 'text-[--critical]' : 'text-[--cyan-300]'}>
          {direction} {Math.abs(delta).toFixed(1)}%
        </span>{' '}
        {comparison}
      </p>
      <Sparkline series={series} />
    </article>
  )
}
