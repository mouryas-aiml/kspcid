'use client'

/**
 * All 106 station briefs, grouped by division and searchable.
 *
 * The overview carries a compact picker; this is the full directory for an
 * officer who knows which station they want.
 */
import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Search } from 'lucide-react'

import { StationBrief } from '@/components/brief/StationBrief'
import { fetchPublicArtifact, publicPath } from '@/lib/publicPath'

interface Fixture {
  readonly snapshot_label: string
  readonly stations: readonly {
    readonly station_code: string
    readonly station_name: string
    readonly station_name_kn: string | null
    readonly police_division: string
  }[]
}

export function StationIndex() {
  const [fixture, setFixture] = useState<Fixture | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [term, setTerm] = useState('')
  const [selectedCode, setSelectedCode] = useState<string | null>(null)

  useEffect(() => {
    setSelectedCode(new URLSearchParams(window.location.search).get('code'))
  }, [])

  useEffect(() => {
    fetchPublicArtifact('/data/scenarios/station_brief.json')
      .then((response) => {
        if (!response.ok) throw new Error(`Fixture request failed (${response.status})`)
        return response.json() as Promise<Fixture>
      })
      .then(setFixture)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Directory unavailable'),
      )
  }, [])

  const grouped = useMemo(() => {
    if (!fixture) return []
    const needle = term.trim().toLowerCase()
    const matches = fixture.stations.filter(
      (station) =>
        !needle ||
        station.station_name.toLowerCase().includes(needle) ||
        station.station_code.toLowerCase().includes(needle) ||
        (station.station_name_kn ?? '').includes(term.trim()),
    )
    const byDivision = new Map<string, typeof matches>()
    for (const station of matches) {
      byDivision.set(station.police_division, [
        ...(byDivision.get(station.police_division) ?? []),
        station,
      ])
    }
    return [...byDivision.entries()].sort(([left], [right]) => left.localeCompare(right))
  }, [fixture, term])

  if (error) {
    return (
      <article className="p-8">
        <p className="text-[13px]" style={{ color: 'var(--ink-soft)' }}>
          The station directory could not be loaded. {error}
        </p>
      </article>
    )
  }
  if (!fixture) {
    return (
      <article className="p-8">
        <p className="text-[13px]" style={{ color: 'var(--ink-soft)' }}>
          Loading the station directory…
        </p>
      </article>
    )
  }

  // Catalyst Web Client Hosting limits ZIP entries. Its deployment keeps this
  // directory shell and routes all station codes through `?code=`, while the
  // standard static export still emits the 106 direct station pages.
  if (selectedCode) return <StationBrief stationCode={selectedCode} />

  return (
    <article className="flex flex-col gap-5 p-6 sm:p-8" style={{ color: 'var(--ink)' }}>
      <header>
        <h1 className="text-[24px] font-semibold leading-8">Station briefs</h1>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--ink-soft)' }}>
          {fixture.stations.length} territorial stations · {fixture.snapshot_label}
        </p>
      </header>

      <label
        className="flex items-center gap-2 rounded-[--r-sm] border px-3 py-2"
        style={{ borderColor: 'var(--rule)', background: 'var(--paper)' }}
      >
        <Search size={14} style={{ color: 'var(--ink-soft)' }} aria-hidden="true" />
        <input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search by station name, code, or Kannada name"
          className="w-full bg-transparent text-[13px] outline-none"
          style={{ color: 'var(--ink)' }}
        />
      </label>

      {grouped.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--ink-soft)' }}>
          No station matches “{term}”.
        </p>
      ) : (
        grouped.map(([divisionName, stations]) => (
          <section key={divisionName}>
            <h2 className="type-micro mb-2" style={{ color: 'var(--gold-print)' }}>
              {divisionName} Division · {stations.length}
            </h2>
            <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
              {stations.map((station) => (
                <li key={station.station_code}>
                  <a
                    href={publicPath(`/station/?code=${encodeURIComponent(station.station_code)}`)}
                    className="flex items-center justify-between gap-2 border-b py-2 text-[13px]"
                    style={{ borderColor: 'var(--rule)' }}
                  >
                    <span className="truncate">
                      {station.station_name}
                      {station.station_name_kn ? (
                        <span className="font-kn ml-2 text-[12px]" style={{ color: 'var(--ink-soft)' }}>
                          {station.station_name_kn}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="font-mono text-[10px]" style={{ color: 'var(--ink-soft)' }}>
                        {station.station_code}
                      </span>
                      <ChevronRight size={13} style={{ color: 'var(--ink-soft)' }} />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </article>
  )
}
