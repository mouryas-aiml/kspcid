'use client'

/**
 * M5 — Station Intelligence Brief (BUILD_SPEC §7.5).
 *
 * One A4 sheet an inspector can sign. It replaces a page the station already
 * writes by hand, which is why §7.5 calls it the adoption feature.
 *
 * Three things shape it:
 *
 *   It must fit one page. §7.5's acceptance is a single A4 sheet with no
 *   orphaned sections, so the layout pairs short sections side by side and the
 *   print rules in `globals.css` compress it further.
 *
 *   Rows count FIRs *registered*, never incidents that occurred (§6.0b). The
 *   source has no occurrence time.
 *
 *   The data ends 2023-12-31 and this is read long after, so the sheet states
 *   its snapshot week and never implies the numbers are live.
 *
 * Provenance is declared once, in the masthead, rather than on every section.
 * Every figure here comes from the same two files, so nine identical chips said
 * the same thing nine times and crowded the page they were meant to support.
 */
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react'

import { ProvenanceChip } from '@/components/primitives/ProvenanceChip'
import { Sparkline } from '@/components/primitives/Sparkline'
import { formatIndian } from '@/lib/charts'
import { fetchPublicArtifact } from '@/lib/publicPath'
import type { Provenance } from '@/lib/provenance'

type Direction = 'up' | 'down' | 'flat'

interface ThreeThing {
  readonly crime_head: string
  readonly registered: number
  readonly previous_registered: number
  readonly delta: number
  readonly direction: Direction
  readonly above_volume_floor: boolean
}

interface StationRecord {
  readonly station_code: string
  readonly station_name: string
  readonly station_name_kn: string | null
  readonly station_name_kn_provenance: Provenance | null
  readonly police_division: string
  readonly area_sq_km: number
  readonly three_things: readonly ThreeThing[]
  readonly fastest_rising: {
    readonly crime_head: string
    readonly registered: number
    readonly previous_registered: number
    readonly expected_count: number
    readonly ucl_99: number
    readonly band_reliable: boolean
    readonly history_13_weeks: readonly number[]
  } | null
  readonly worst_affected_beat: { readonly beat_name: string; readonly registered: number } | null
  readonly oldest_open_cases: readonly {
    readonly case_ref: string
    readonly crime_head: string
    readonly days_open: number
    readonly io_alias: string | null
  }[]
  readonly workload: {
    readonly open_records: number
    readonly distinct_io_aliases: number
    readonly records_without_io: number
    readonly snapshot_cutoff: string
  } | null
  readonly victims: {
    readonly male: number
    readonly female: number
    readonly boy: number
    readonly girl: number
    readonly direction: Record<'male' | 'female' | 'boy' | 'girl', Direction>
  } | null
  readonly peers: {
    readonly median_weekly_registrations: number
    readonly stations: readonly {
      readonly station_code: string
      readonly station_name: string
      readonly median_weekly_registrations: number
    }[]
  }
  readonly forecast: {
    readonly next_week_start: string
    readonly low: number
    readonly expected: number
    readonly high: number
  } | null
  readonly staffing: {
    readonly sanctioned_strength: number
    readonly open_records: number
    readonly open_per_officer: number
  }
}

interface Fixture {
  readonly snapshot_week_start: string
  readonly snapshot_week_end: string
  readonly snapshot_label: string
  readonly analysis_cutoff: string
  readonly provenance: { readonly baselines: Provenance }
  readonly stations: readonly StationRecord[]
}

const ARROW = { up: ArrowUp, down: ArrowDown, flat: ArrowRight } as const

/** Coloured by direction, not by good or bad — a fall is not self-evidently good. */
function Change({ direction, value }: { readonly direction: Direction; readonly value: number }) {
  const Icon = ARROW[direction]
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 tabular-nums"
      style={{ color: direction === 'up' ? 'var(--gold-print)' : 'var(--ink-soft)' }}
    >
      <Icon size={11} aria-hidden="true" />
      {value === 0 ? 'same' : `${value > 0 ? '+' : ''}${value}`}
    </span>
  )
}

/**
 * Two stacked bars: last week behind, this week in front. A reader sees the
 * size of the move without reading either number.
 */
function ChangeBar({
  now,
  before,
  scale,
}: {
  readonly now: number
  readonly before: number
  readonly scale: number
}) {
  const width = (value: number) => `${Math.max(2, (value / Math.max(scale, 1)) * 100)}%`
  return (
    <span className="flex w-[74px] shrink-0 flex-col gap-[2px]" aria-hidden="true">
      <span className="h-[5px] w-full overflow-hidden rounded-sm" style={{ background: 'var(--paper-tint)' }}>
        <span className="block h-full rounded-sm" style={{ width: width(now), background: 'var(--gold-print)' }} />
      </span>
      <span className="h-[3px] w-full overflow-hidden rounded-sm" style={{ background: 'var(--paper-tint)' }}>
        <span className="block h-full rounded-sm" style={{ width: width(before), background: 'var(--rule)' }} />
      </span>
    </span>
  )
}

function Section({
  title,
  children,
  className = '',
}: {
  readonly title: string
  readonly children: React.ReactNode
  readonly className?: string
}) {
  return (
    <section className={`a4-section border-t pt-3 ${className}`} style={{ borderColor: 'var(--rule)' }}>
      <h2 className="type-micro mb-2" style={{ color: 'var(--ink-soft)' }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

/** §5.7 — every empty state says why it is empty, in one line. */
function Empty({ reason }: { readonly reason: string }) {
  return (
    <p className="a4-body text-[12px]" style={{ color: 'var(--ink-soft)' }}>
      {reason}
    </p>
  )
}

export function StationBrief({ stationCode }: { readonly stationCode: string }) {
  const [fixture, setFixture] = useState<Fixture | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchPublicArtifact('/data/scenarios/station_brief.json')
      .then((response) => {
        if (!response.ok) throw new Error(`Fixture request failed (${response.status})`)
        return response.json() as Promise<Fixture>
      })
      .then(setFixture)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Fixture unavailable'),
      )
  }, [])

  if (error) {
    return (
      <article className="p-8">
        <Empty reason={`The station brief could not be loaded. ${error}`} />
      </article>
    )
  }
  if (!fixture) {
    return (
      <article className="p-8">
        <Empty reason="Loading the station brief…" />
      </article>
    )
  }

  const station = fixture.stations.find((entry) => entry.station_code === stationCode)
  if (!station) {
    return (
      <article className="p-8">
        <Empty
          reason={`No brief exists for station ${stationCode}. Briefs cover the 106 stations that have a jurisdiction boundary.`}
        />
      </article>
    )
  }

  const changeScale = Math.max(
    1,
    ...station.three_things.flatMap((item) => [item.registered, item.previous_registered]),
  )
  const victimScale = station.victims
    ? Math.max(1, station.victims.male, station.victims.female, station.victims.boy, station.victims.girl)
    : 1
  const peerRows = [
    {
      station_code: station.station_code,
      station_name: station.station_name,
      median_weekly_registrations: station.peers.median_weekly_registrations,
      self: true,
    },
    ...station.peers.stations.map((peer) => ({ ...peer, self: false })),
  ].sort((left, right) => right.median_weekly_registrations - left.median_weekly_registrations)
  const peerScale = Math.max(1, ...peerRows.map((row) => row.median_weekly_registrations))

  return (
    <article className="brief-a4 flex flex-col gap-4 p-8 sm:p-10" style={{ color: 'var(--ink)' }}>
      {/* Masthead */}
      <header>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[25px] font-semibold leading-8">{station.station_name}</h1>
            {station.station_name_kn ? (
              <p className="a4-kn font-kn text-[16px] leading-6" style={{ color: 'var(--ink-soft)' }}>
                {station.station_name_kn}
              </p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="type-micro" style={{ color: 'var(--gold-print)' }}>
              Station Brief
            </p>
            <p className="a4-note text-[11px]" style={{ color: 'var(--ink-soft)' }}>
              {station.police_division} Division · {station.station_code} · {station.area_sq_km} km²
            </p>
          </div>
        </div>
        <div
          className="a4-note mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-[11px]"
          style={{ borderColor: 'var(--rule)', color: 'var(--ink-soft)' }}
        >
          {/* Stated, not implied: the source ends here. */}
          <span>
            Week ending {fixture.snapshot_week_end} · all counts are FIRs registered in that week
          </span>
          {/* Declared once for the whole sheet. */}
          <span className="no-print">
            <ProvenanceChip
              variant="paper"
              provenance={fixture.provenance.baselines}
              derivation="Every figure is calculated from the Karnataka FIR dataset and grouped by station. Expected ranges use the previous 52 weeks and seasonal patterns. Kannada names, where shown, come from OpenStreetMap."
            />
          </span>
        </div>
      </header>

      {/* The three biggest changes */}
      <Section title="Biggest changes this week">
        {station.three_things.length === 0 ? (
          <Empty reason="No FIRs were registered here in this week or the one before." />
        ) : (
          <ol className="a4-gap flex flex-col gap-1.5">
            {station.three_things.map((item, index) => (
              <li key={item.crime_head} className="a4-body flex items-center gap-3 text-[12.5px] leading-5">
                <span className="w-3 shrink-0 tabular-nums" style={{ color: 'var(--ink-soft)' }}>
                  {index + 1}
                </span>
                {/* Wraps rather than truncates: these are the headline items,
                    and a crime head cut mid-word is not something an inspector
                    can act on. The page has the room. */}
                <span className="min-w-0 flex-1">
                  <strong className="font-semibold">{formatIndian(item.registered)}</strong>{' '}
                  {item.crime_head}
                  <span style={{ color: 'var(--ink-soft)' }}>
                    {' '}
                    · was {formatIndian(item.previous_registered)}
                    {!item.above_volume_floor ? ' · small numbers' : ''}
                  </span>
                </span>
                <ChangeBar now={item.registered} before={item.previous_registered} scale={changeScale} />
                <Change direction={item.direction} value={item.delta} />
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* Rising category + busiest beat, paired to save a page */}
      <div className="a4-gap grid grid-cols-2 gap-5">
        <Section title="Rising fastest">
          {!station.fastest_rising ? (
            <Empty reason="Nothing rose here this week." />
          ) : (
            <>
              <p className="a4-body text-[12.5px] font-medium">{station.fastest_rising.crime_head}</p>
              <p className="a4-note text-[11px]" style={{ color: 'var(--ink-soft)' }}>
                {formatIndian(station.fastest_rising.registered)} registered, was{' '}
                {formatIndian(station.fastest_rising.previous_registered)}
              </p>
              <Sparkline
                label={`13 weeks of FIRs registered for ${station.fastest_rising.crime_head}`}
                values={station.fastest_rising.history_13_weeks}
                expected={station.fastest_rising.band_reliable ? station.fastest_rising.expected_count : null}
                ucl={station.fastest_rising.band_reliable ? station.fastest_rising.ucl_99 : null}
                className="mt-1 h-10 w-full"
              />
              <p className="a4-note text-[10px]" style={{ color: 'var(--ink-soft)' }}>
                {station.fastest_rising.band_reliable
                  ? `Last 13 weeks. Usual range for this time of year: ${station.fastest_rising.expected_count} to ${station.fastest_rising.ucl_99}.`
                  : 'Last 13 weeks. Too few past cases here to give a usual range.'}
              </p>
            </>
          )}
        </Section>

        <Section title="Busiest beat">
          {!station.worst_affected_beat ? (
            <Empty reason="No FIR here carried a beat name in the last 90 days." />
          ) : (
            <>
              <p className="a4-metric text-[15px] font-medium">{station.worst_affected_beat.beat_name}</p>
              <p className="a4-note text-[11px]" style={{ color: 'var(--ink-soft)' }}>
                {formatIndian(station.worst_affected_beat.registered)} FIRs registered in the 90 days to{' '}
                {fixture.analysis_cutoff}.
              </p>
              {/* Beat names exist in the source; beat boundaries do not, so no
                  beat is ever drawn on a map. */}
              <p className="a4-note mt-1 text-[10px]" style={{ color: 'var(--ink-soft)' }}>
                Beat names are recorded but beat boundaries are not, so no beat map is shown.
              </p>
            </>
          )}
        </Section>
      </div>

      {/* Oldest open cases */}
      <Section title="Oldest cases still open">
        {station.oldest_open_cases.length === 0 ? (
          <Empty reason="No case here is still open." />
        ) : (
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="type-micro" style={{ color: 'var(--ink-soft)' }}>
                <th className="pb-1 text-left font-semibold">Case reference</th>
                <th className="pb-1 text-left font-semibold">Crime</th>
                <th className="pb-1 text-right font-semibold">Days open</th>
                <th className="pb-1 text-right font-semibold">Officer</th>
              </tr>
            </thead>
            <tbody>
              {station.oldest_open_cases.map((entry) => (
                <tr key={entry.case_ref} className="border-t" style={{ borderColor: 'var(--rule)' }}>
                  <td className="py-1 font-mono text-[10.5px]">{entry.case_ref}</td>
                  <td className="max-w-0 truncate py-1">{entry.crime_head}</td>
                  <td className="py-1 text-right tabular-nums">{formatIndian(entry.days_open)}</td>
                  <td className="py-1 text-right font-mono text-[10.5px]">{entry.io_alias ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Victims + open-case load, paired */}
      <div className="a4-gap grid grid-cols-2 gap-5">
        <Section title="Victims this week">
          {!station.victims ? (
            <Empty reason="No victim counts were recorded here this week." />
          ) : (
            <div className="a4-gap flex flex-col gap-1">
              {(['male', 'female', 'boy', 'girl'] as const).map((key) => {
                const value = station.victims![key]
                const Icon = ARROW[station.victims!.direction[key]]
                return (
                  <div key={key} className="a4-body flex items-center gap-2 text-[11.5px]">
                    <span className="w-11 shrink-0 capitalize" style={{ color: 'var(--ink-soft)' }}>
                      {key}
                    </span>
                    <span
                      className="h-[7px] flex-1 overflow-hidden rounded-sm"
                      style={{ background: 'var(--paper-tint)' }}
                    >
                      <span
                        className="block h-full rounded-sm"
                        style={{
                          width: `${Math.max(1.5, (value / victimScale) * 100)}%`,
                          background: 'var(--gold-print)',
                        }}
                      />
                    </span>
                    <span className="w-6 shrink-0 text-right font-mono tabular-nums">{value}</span>
                    <Icon size={10} aria-hidden="true" style={{ color: 'var(--ink-soft)' }} />
                  </div>
                )
              })}
              <p className="a4-note text-[10px]" style={{ color: 'var(--ink-soft)' }}>
                These are the only four categories the records carry.
              </p>
            </div>
          )}
        </Section>

        <Section title="Open cases and officers">
          {!station.workload ? (
            <Empty reason="No case here is still open." />
          ) : (
            <>
              <div className="a4-gap grid grid-cols-3 gap-2">
                {[
                  ['Open', formatIndian(station.workload.open_records)],
                  ['Officers', formatIndian(station.workload.distinct_io_aliases)],
                  ['Per officer', String(station.staffing.open_per_officer)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="type-micro" style={{ color: 'var(--ink-soft)' }}>
                      {label}
                    </p>
                    <p className="a4-metric font-mono text-[15px] tabular-nums">{value}</p>
                  </div>
                ))}
              </div>
              {/* A proxy, and labelled as one. There is no staffing table in the
                  source, so this can never be read as resourcing evidence. */}
              <p className="a4-note mt-1 text-[10px] leading-4" style={{ color: 'var(--ink-soft)' }}>
                As at {station.workload.snapshot_cutoff}. Counts officers who appear on open cases here,
                not who is posted or available. Strength figures used elsewhere are illustrative.
              </p>
            </>
          )}
        </Section>
      </div>

      {/* Next week's outlook. A range, never a single number. */}
      {station.forecast ? (
        <Section title="Expected next week">
          <div className="flex items-center gap-4">
            <p className="a4-metric font-mono text-[17px] tabular-nums">
              {station.forecast.low}–{station.forecast.high}
            </p>
            <span
              className="relative h-[7px] flex-1 overflow-hidden rounded-sm"
              style={{ background: 'var(--paper-tint)' }}
              aria-hidden="true"
            >
              <span
                className="absolute inset-y-0 left-0 right-0 rounded-sm"
                style={{ background: 'color-mix(in srgb, var(--gold-print) 22%, transparent)' }}
              />
              <span
                className="absolute inset-y-0 w-[3px]"
                style={{
                  left: `${((station.forecast.expected - station.forecast.low) / Math.max(1, station.forecast.high - station.forecast.low)) * 100}%`,
                  background: 'var(--gold-print)',
                }}
              />
            </span>
            <span className="a4-note text-[11px]" style={{ color: 'var(--ink-soft)' }}>
              about {station.forecast.expected}
            </span>
          </div>
          <p className="a4-note mt-1 text-[10px] leading-4" style={{ color: 'var(--ink-soft)' }}>
            FIRs likely to be registered in the week beginning {station.forecast.next_week_start}, based
            on the last 52 weeks here. This is expected workload, not a prediction of crime.
          </p>
        </Section>
      ) : null}

      {/* Peers */}
      <Section title="Compared with similar stations">
        {station.peers.stations.length === 0 ? (
          <Empty reason="No other station shares this division." />
        ) : (
          <>
            <div className="a4-gap flex flex-col gap-1">
              {peerRows.map((peer) => (
                <div key={peer.station_code} className="a4-body flex items-center gap-2 text-[11.5px]">
                  <span
                    className="w-[150px] shrink-0 truncate"
                    style={{ fontWeight: peer.self ? 600 : 400 }}
                  >
                    {peer.station_name}
                    {peer.self ? ' (this station)' : ''}
                  </span>
                  <span
                    className="h-[7px] flex-1 overflow-hidden rounded-sm"
                    style={{ background: 'var(--paper-tint)' }}
                  >
                    <span
                      className="block h-full rounded-sm"
                      style={{
                        width: `${Math.max(1.5, (peer.median_weekly_registrations / peerScale) * 100)}%`,
                        background: peer.self ? 'var(--gold-print)' : 'var(--rule)',
                      }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-right font-mono tabular-nums">
                    {peer.median_weekly_registrations}
                  </span>
                </div>
              ))}
            </div>
            <p className="a4-note mt-1 text-[10px]" style={{ color: 'var(--ink-soft)' }}>
              Stations in the same division with the closest weekly FIR numbers, over the last year.
              This is a count of FIRs, not a crime rate — the records carry no population figure.
            </p>
          </>
        )}
      </Section>

      {/* Next steps — screen only; on paper a link cannot be followed. */}
      <Section title="Next steps" className="no-print">
        <ul className="flex flex-col gap-1 text-[12px]">
          <li>
            <a
              className="underline underline-offset-2"
              href={`/map/?station=${encodeURIComponent(station.station_code)}&explain=1`}
            >
              See where these FIRs cluster on the map
            </a>
          </li>
          {station.fastest_rising ? (
            <li>
              <a
                className="underline underline-offset-2"
                href={`/similarity/?station=${encodeURIComponent(station.station_code)}&crime_head=${encodeURIComponent(station.fastest_rising.crime_head)}`}
              >
                Find similar cases at other stations
              </a>
            </li>
          ) : null}
          <li>
            <a
              className="underline underline-offset-2"
              href={`/patrol/?station=${encodeURIComponent(station.station_code)}`}
            >
              Plan a patrol for this station
            </a>
          </li>
        </ul>
      </Section>

      <footer
        className="a4-note border-t pt-2 text-[10px] leading-4"
        style={{ borderColor: 'var(--rule)', color: 'var(--ink-soft)' }}
      >
        Counts are FIRs registered, not crimes that took place — the records carry a registration date
        with no time. Source: Karnataka FIR dataset (third-party mirror), normalized. Kannada names from
        OpenStreetMap. Officer names replaced with an alias. Case references are for demonstration; the
        source has no case number. Data ends {fixture.analysis_cutoff}.
      </footer>
    </article>
  )
}
