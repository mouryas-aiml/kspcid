'use client'

/**
 * Commander's Home — the holistic picture, in one screen, read top to bottom.
 *
 * The seven modules each answer one question well, but a senior officer had to
 * open all seven to learn what happened. This page is the thirty-second read:
 * what moved, where it is worst, and where a case has stopped.
 *
 * It sits on the light brief shell deliberately. The dark ops shell is for the
 * investigator doing the work; this and the station brief are for the officer
 * deciding what the work should be.
 *
 * Every tile carries its own scope AND its own date. The page mixes a city-wide
 * cumulative figure, a single snapshot week, alerts spanning five months, and a
 * corridor simulation — labelling the page once would misrepresent three of
 * them.
 */
import { useEffect, useState } from 'react'
import { ArrowRight, ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { ProvenanceChip } from '@/components/primitives/ProvenanceChip'
import { formatIndian } from '@/lib/charts'
import { fetchPublicArtifact } from '@/lib/publicPath'
import type { Provenance } from '@/lib/provenance'

interface BriefFixture {
  readonly snapshot_label: string
  readonly snapshot_week_start: string
  readonly snapshot_week_end: string
  readonly analysis_cutoff: string
  readonly overview: {
    readonly stations_evaluated: number
    readonly stations_above_expected_band: number
    readonly stations_with_alert: number
    readonly alert_window_start: string | null
    readonly alert_window_end: string | null
    readonly top_alert_ids: readonly string[]
    readonly provenance: Provenance
  }
  readonly stations: readonly {
    readonly station_code: string
    readonly station_name: string
    readonly station_name_kn: string | null
    readonly police_division: string
  }[]
  readonly outlook: {
    readonly next_week_start: string
    readonly low: number
    readonly expected: number
    readonly high: number
    readonly recent_weeks: readonly number[]
    readonly provenance: Provenance
  } | null
  readonly staffing: {
    readonly city_open_records: number
    readonly city_open_per_officer: number
    readonly most_loaded: readonly StaffingRow[]
    readonly most_headroom: readonly StaffingRow[]
    readonly provenance: Provenance
  }
}

interface StaffingRow {
  readonly station_code: string
  readonly station_name: string
  readonly police_division: string
  readonly open_records: number
  readonly sanctioned_strength: number
  readonly open_per_officer: number
}

interface FeedFixture {
  readonly alerts: readonly {
    readonly id: string
    readonly title: string
    readonly station_name: string
    readonly police_division: string | null
    readonly week_start: string
    readonly observed_count: number
    readonly expected_count: number
    readonly ucl_99: number
    readonly severity: string
    readonly provenance: Provenance
  }[]
}

interface JusticeFixture {
  readonly observed: {
    readonly total_records: number
    readonly stages: readonly { readonly stage: string; readonly label: string; readonly count: number }[]
    readonly provenance: Provenance
  }
}

/** A share of a whole, so the number is not the only thing carrying the point. */
function Bar({ value, total }: { readonly value: number; readonly total: number }) {
  const share = total > 0 ? (value / total) * 100 : 0
  return (
    <span
      className="mt-2 block h-1.5 w-full overflow-hidden rounded-sm"
      style={{ background: 'var(--paper-tint)' }}
      aria-hidden="true"
    >
      <span
        className="block h-full rounded-sm"
        style={{ width: `${Math.max(1.5, share)}%`, background: 'var(--gold-print)' }}
      />
    </span>
  )
}

/** A tile header. `scope` is not optional — see the file comment. */
function Tile({
  title,
  scope,
  href,
  hrefLabel,
  children,
}: {
  readonly title: string
  readonly scope: string
  readonly href?: string
  readonly hrefLabel?: string
  readonly children: React.ReactNode
}) {
  return (
    <section
      className="flex flex-col rounded-[--r-md] border p-4"
      style={{ borderColor: 'var(--rule)', background: 'var(--paper)' }}
    >
      <h2 className="type-micro" style={{ color: 'var(--ink)' }}>
        {title}
      </h2>
      <p className="mb-3 mt-0.5 text-[11px] leading-4" style={{ color: 'var(--ink-soft)' }}>
        {scope}
      </p>
      <div className="flex-1">{children}</div>
      {href ? (
        <Link
          href={href}
          className="mt-3 inline-flex items-center gap-1 text-[12px] underline underline-offset-2"
          style={{ color: 'var(--gold-print)' }}
        >
          {hrefLabel} <ArrowRight size={13} />
        </Link>
      ) : null}
    </section>
  )
}

export function CommanderHome() {
  const [brief, setBrief] = useState<BriefFixture | null>(null)
  const [feed, setFeed] = useState<FeedFixture | null>(null)
  const [justice, setJustice] = useState<JusticeFixture | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [division, setDivision] = useState<string>('all')

  useEffect(() => {
    const load = async <T,>(path: string): Promise<T> => {
      const response = await fetchPublicArtifact(path)
      if (!response.ok) throw new Error(`${path} failed (${response.status})`)
      return response.json() as Promise<T>
    }
    Promise.all([
      load<BriefFixture>('/data/scenarios/station_brief.json'),
      load<FeedFixture>('/data/scenarios/command_feed.json'),
      load<JusticeFixture>('/data/scenarios/justice_pipeline.json'),
    ])
      .then(([briefData, feedData, justiceData]) => {
        setBrief(briefData)
        setFeed(feedData)
        setJustice(justiceData)
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Overview unavailable'),
      )
  }, [])

  if (error) {
    return (
      <article className="p-8">
        <p className="text-[13px]" style={{ color: 'var(--ink-soft)' }}>
          The overview could not be loaded. {error}
        </p>
      </article>
    )
  }
  if (!brief || !feed || !justice) {
    return (
      <article className="p-8">
        <p className="text-[13px]" style={{ color: 'var(--ink-soft)' }}>
          Loading the overview…
        </p>
      </article>
    )
  }

  // Home shows the same three alerts the feed ranks first, chosen in the ETL,
  // so the two screens cannot drift apart.
  const topAlerts = brief.overview.top_alert_ids
    .map((id) => feed.alerts.find((alert) => alert.id === id))
    .filter((alert): alert is FeedFixture['alerts'][number] => Boolean(alert))

  const alertWeeks = topAlerts.map((alert) => alert.week_start).sort()
  const undetected = justice.observed.stages.find((stage) => stage.stage === 'undetected')
  const undetectedShare = undetected
    ? ((undetected.count / justice.observed.total_records) * 100).toFixed(1)
    : null

  const divisions = [...new Set(brief.stations.map((station) => station.police_division))].sort()
  const visibleStations =
    division === 'all'
      ? brief.stations
      : brief.stations.filter((station) => station.police_division === division)

  return (
    <article className="flex flex-col gap-5 p-6 sm:p-8" style={{ color: 'var(--ink)' }}>
      <header>
        <p className="type-micro" style={{ color: 'var(--gold-print)' }}>
          Karnataka State Police · State Crime Records Bureau
        </p>
        <h1 className="mt-1 text-[26px] font-semibold leading-8">Bengaluru overview</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-[12px]" style={{ color: 'var(--ink-soft)' }}>
            Each panel covers a different period, so each one says which.
          </p>
          {/* Declared once for the page. Every panel draws on the same records. */}
          <ProvenanceChip
            variant="paper"
            provenance={brief.overview.provenance}
            derivation="Every number on this page comes from the Karnataka FIR dataset (a third-party mirror), cleaned and grouped. A station is flagged when a week's FIR count for one crime type goes above what that station normally sees, measured against 52 weeks of its own history."
          />
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {/*
          Stations that raised a ranked alert. This replaced a count of
          stations "above their expected band" in the snapshot week: all five
          that flagged had an expected count between 0.024 and 0.262, so any
          non-zero week cleared a limit of 1 — the cold-start artifact the feed
          gate removes, arriving by another route. The alerts already carry
          that gate, so this figure inherits it.
        */}
        <Tile
          title="Stations needing a look"
          scope={
            brief.overview.alert_window_start && brief.overview.alert_window_end
              ? `Bengaluru City · alerts from ${brief.overview.alert_window_start} to ${brief.overview.alert_window_end}`
              : 'Bengaluru City'
          }
        >
          <p className="type-metric" style={{ color: 'var(--ink)' }}>
            {brief.overview.stations_with_alert}
            <span className="ml-2 text-[15px] font-normal" style={{ color: 'var(--ink-soft)' }}>
              of {brief.overview.stations_evaluated} stations
            </span>
          </p>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--ink-soft)' }}>
            Registered more FIRs in a week than that station and crime type normally sees.
          </p>
          <Bar value={brief.overview.stations_with_alert} total={brief.overview.stations_evaluated} />
        </Tile>

        {/* Justice — cumulative, a different window entirely. */}
        <Tile
          title="Cases with no one identified"
          scope={`Bengaluru City · everything up to ${brief.analysis_cutoff}`}
          href="/justice/"
          hrefLabel="Open the justice pipeline"
        >
          <p className="type-metric" style={{ color: 'var(--ink)' }}>
            {undetected ? formatIndian(undetected.count) : '—'}
            {undetectedShare ? (
              <span className="ml-2 text-[15px] font-normal" style={{ color: 'var(--ink-soft)' }}>
                {undetectedShare}%
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--ink-soft)' }}>
            Out of {formatIndian(justice.observed.total_records)} FIRs registered between 2016 and 2023.
          </p>
          {undetected ? (
            <Bar value={undetected.count} total={justice.observed.total_records} />
          ) : null}
        </Tile>
      </div>

      {/* Alerts — these span months, so each row carries its own week. */}
      <Tile
        title="Biggest jumps"
        scope={
          alertWeeks.length > 0
            ? `Bengaluru City · weeks of ${alertWeeks[0]} to ${alertWeeks.at(-1)}`
            : 'Bengaluru City'
        }
        href="/feed/"
        hrefLabel="See all alerts"
      >
        {topAlerts.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--ink-soft)' }}>
            No station went above its usual range in this period.
          </p>
        ) : (
          <ol className="flex flex-col">
            {topAlerts.map((alert) => {
              // Bar scaled to the limit, so "how far past normal" is visible
              // before any number is read.
              const scale = Math.max(alert.observed_count, alert.ucl_99, 1)
              return (
                <li
                  key={alert.id}
                  className="flex items-center gap-3 border-t py-2 first:border-t-0 first:pt-0"
                  style={{ borderColor: 'var(--rule)' }}
                >
                  <span className="min-w-0 flex-1 text-[13px]">
                    <span className="font-medium">{alert.station_name}</span> — {alert.title}
                    <span className="block text-[11px]" style={{ color: 'var(--ink-soft)' }}>
                      {/* Each alert carries its own week; they are months apart. */}
                      Week of {alert.week_start} · usually about {alert.expected_count}, rarely above{' '}
                      {alert.ucl_99}
                    </span>
                  </span>
                  <span className="w-16 shrink-0" aria-hidden="true">
                    <span
                      className="block h-1.5 w-full overflow-hidden rounded-sm"
                      style={{ background: 'var(--paper-tint)' }}
                    >
                      <span
                        className="block h-full rounded-sm"
                        style={{
                          width: `${(alert.observed_count / scale) * 100}%`,
                          background: 'var(--gold-print)',
                        }}
                      />
                    </span>
                    <span
                      className="mt-[2px] block h-[3px] overflow-hidden rounded-sm"
                      style={{ background: 'var(--paper-tint)' }}
                    >
                      <span
                        className="block h-full rounded-sm"
                        style={{ width: `${(alert.ucl_99 / scale) * 100}%`, background: 'var(--rule)' }}
                      />
                    </span>
                  </span>
                  <span className="w-8 shrink-0 text-right font-mono text-[17px] tabular-nums">
                    {formatIndian(alert.observed_count)}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </Tile>

      {/* Next week's outlook. A range, never a single number. */}
      {brief.outlook ? (
        <Tile
          title="Expected next week"
          scope={`106 stations · week beginning ${brief.outlook.next_week_start}`}
        >
          <div className="flex items-end gap-5">
            <div>
              <p className="type-metric" style={{ color: 'var(--ink)' }}>
                {formatIndian(Math.round(brief.outlook.expected))}
              </p>
              <p className="text-[12px]" style={{ color: 'var(--ink-soft)' }}>
                FIRs likely to be registered
              </p>
            </div>
            {/* The range carries the uncertainty; the point value alone would
                claim more precision than a forecast can support. */}
            <div className="flex-1 pb-1">
              <div
                className="relative h-2 w-full overflow-hidden rounded-sm"
                style={{ background: 'var(--paper-tint)' }}
                aria-hidden="true"
              >
                <span
                  className="absolute inset-y-0 rounded-sm"
                  style={{
                    left: '0%',
                    right: '0%',
                    background: 'color-mix(in srgb, var(--gold-print) 22%, transparent)',
                  }}
                />
                <span
                  className="absolute inset-y-0 w-[3px] rounded-sm"
                  style={{
                    left: `${((brief.outlook.expected - brief.outlook.low) / Math.max(1, brief.outlook.high - brief.outlook.low)) * 100}%`,
                    background: 'var(--gold-print)',
                  }}
                />
              </div>
              <div
                className="mt-1 flex justify-between text-[11px] tabular-nums"
                style={{ color: 'var(--ink-soft)' }}
              >
                <span>Low {formatIndian(brief.outlook.low)}</span>
                <span>High {formatIndian(brief.outlook.high)}</span>
              </div>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-4" style={{ color: 'var(--ink-soft)' }}>
            Projected from the last 52 weeks of registrations. This is expected paperwork volume, not a
            prediction of crime, and not about any individual.
          </p>
        </Tile>
      ) : null}

      {/* Where the roster and the caseload disagree. */}
      <Tile
        title="Where the load sits"
        scope={`Open cases per officer · as at ${brief.analysis_cutoff}`}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          {[
            { label: 'Carrying the most', rows: brief.staffing.most_loaded, accent: 'var(--gold-print)' },
            { label: 'Most spare capacity', rows: brief.staffing.most_headroom, accent: 'var(--rule)' },
          ].map((group) => {
            const scale = Math.max(
              1,
              ...brief.staffing.most_loaded.map((row) => row.open_per_officer),
            )
            return (
              <div key={group.label}>
                <p className="type-micro mb-1.5" style={{ color: 'var(--ink-soft)' }}>
                  {group.label}
                </p>
                <div className="flex flex-col gap-1">
                  {group.rows.map((row) => (
                    <Link
                      key={row.station_code}
                      href={`/station/?code=${encodeURIComponent(row.station_code)}`}
                      className="flex items-center gap-2 text-[12px]"
                    >
                      <span className="w-[104px] shrink-0 truncate">{row.station_name}</span>
                      <span
                        className="h-[7px] flex-1 overflow-hidden rounded-sm"
                        style={{ background: 'var(--paper-tint)' }}
                      >
                        <span
                          className="block h-full rounded-sm"
                          style={{
                            width: `${Math.max(2, (row.open_per_officer / scale) * 100)}%`,
                            background: group.accent,
                          }}
                        />
                      </span>
                      <span className="w-7 shrink-0 text-right font-mono tabular-nums">
                        {row.open_per_officer}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        <p className="mt-2 text-[11px] leading-4" style={{ color: 'var(--ink-soft)' }}>
          City average {brief.staffing.city_open_per_officer} open cases per officer across{' '}
          {formatIndian(brief.staffing.city_open_records)} open cases. Open-case counts are from the
          records; officer strength is illustrative, so treat the comparison as a worked example.
        </p>
        <span className="mt-2 inline-block">
          <ProvenanceChip
            variant="paper"
            provenance={brief.staffing.provenance}
            derivation="Open case counts come from the FIR records. Station strength is generated for demonstration — the source carries no establishment or posting data — so the ratio shown is illustrative, not a measure of how any station is actually staffed."
          />
        </span>
      </Tile>

      {/* Station picker → the brief. */}
      <Tile
        title="Station briefs"
        scope={`${brief.stations.length} territorial stations · ${brief.snapshot_label}`}
      >
        <div className="mb-3 flex flex-wrap gap-1.5">
          {['all', ...divisions].map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setDivision(entry)}
              className="rounded-[--r-sm] border px-2 py-1 text-[11px]"
              style={{
                borderColor: division === entry ? 'var(--gold-print)' : 'var(--rule)',
                color: division === entry ? 'var(--gold-print)' : 'var(--ink-soft)',
                background: 'var(--paper)',
              }}
            >
              {entry === 'all' ? 'All divisions' : entry}
            </button>
          ))}
        </div>
        <ul className="grid max-h-[240px] grid-cols-1 gap-x-4 overflow-y-auto sm:grid-cols-2">
          {visibleStations.map((station) => (
            <li key={station.station_code}>
              <Link
                href={`/station/?code=${encodeURIComponent(station.station_code)}`}
                className="flex items-center justify-between gap-2 border-b py-1.5 text-[12px]"
                style={{ borderColor: 'var(--rule)' }}
              >
                <span className="truncate">
                  {station.station_name}
                  {station.station_name_kn ? (
                    <span className="font-kn ml-2" style={{ color: 'var(--ink-soft)' }}>
                      {station.station_name_kn}
                    </span>
                  ) : null}
                </span>
                <ChevronRight size={13} className="shrink-0" style={{ color: 'var(--ink-soft)' }} />
              </Link>
            </li>
          ))}
        </ul>
      </Tile>

      {/* The ops shell, clearly separated from the figures above. */}
      <section className="flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: 'var(--rule)' }}>
        {[
          ['/map/', 'Command map'],
          ['/similarity/', 'Case similarity'],
          ['/network/', 'Case constellation'],
          ['/cyber/', 'Cyber wing'],
          // Labelled for what it is: a corridor simulation, not a city view.
          ['/patrol/', 'Patrol lab — demo corridor simulation'],
        ].map(([href, label]) => (
          <Link
            key={href}
            href={href!}
            className="rounded-[--r-sm] border px-3 py-1.5 text-[12px]"
            style={{ borderColor: 'var(--rule)', color: 'var(--ink-soft)' }}
          >
            {label}
          </Link>
        ))}
      </section>

      <footer className="text-[10px] leading-4" style={{ color: 'var(--ink-soft)' }}>
        Every figure counts FIRs registered, not incidents that occurred. The source records a
        registration date with no time and ends {brief.analysis_cutoff}; nothing here is live.
      </footer>
    </article>
  )
}
