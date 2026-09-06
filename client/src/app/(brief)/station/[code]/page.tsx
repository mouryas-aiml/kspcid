import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { StationBrief } from '@/components/brief/StationBrief'
import { BriefShell } from '@/components/shell/BriefShell'

interface StationBriefFixture {
  readonly stations: readonly { readonly station_code: string; readonly station_name: string }[]
}

/**
 * The build is a static export (`output: 'export'`), so every station's page is
 * emitted at build time. The codes are read from the fixture rather than
 * hardcoded — a station added to the crosswalk gets a page without anyone
 * remembering to update a list here.
 */
async function stationIndex(): Promise<StationBriefFixture> {
  const path = resolve(process.cwd(), 'public/data/scenarios/station_brief.json')
  return JSON.parse(await readFile(path, 'utf8')) as StationBriefFixture
}

export async function generateStaticParams(): Promise<{ code: string }[]> {
  const fixture = await stationIndex()
  return fixture.stations.map((station) => ({ code: station.station_code }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>
}): Promise<{ title: string }> {
  const { code } = await params
  const fixture = await stationIndex()
  const station = fixture.stations.find((entry) => entry.station_code === code)
  return { title: station ? `${station.station_name} — Station Brief` : 'Station Brief' }
}

export default async function StationBriefPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  return (
    <BriefShell backHref="/overview/" backLabel="Overview">
      <StationBrief stationCode={code} />
    </BriefShell>
  )
}
