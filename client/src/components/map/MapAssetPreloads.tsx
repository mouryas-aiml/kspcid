interface MapAssetPreloadsProps {
  readonly dataArtifact?: string
}

/**
 * Catalyst has high per-request latency. Start the exact bytes needed for the
 * default Bengaluru view while the route's JavaScript is still downloading,
 * rather than leaving the PMTiles reads blocked behind MapLibre startup.
 */
export function MapAssetPreloads({ dataArtifact }: MapAssetPreloadsProps) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
  if (!basePath) return null

  const assets = [
    '/tiles/bengaluru-pmtiles/manifest.json',
    '/tiles/bengaluru-pmtiles/0000.bin',
    '/tiles/bengaluru-pmtiles/0002.bin',
    '/tiles/bengaluru-pmtiles/0003.bin',
    '/basemap/sprites/dark.json',
    '/basemap/sprites/dark.png',
    '/basemap/fonts/Noto Sans Regular/0-255.pbf',
    '/basemap/fonts/Noto Sans Medium/0-255.pbf',
    '/basemap/fonts/Noto Sans Italic/0-255.pbf',
    ...(dataArtifact ? [`${dataArtifact}.catalyst.gz`] : []),
  ]

  return (
    <>
      {assets.map((asset) => (
        <link
          as="fetch"
          crossOrigin="anonymous"
          href={`${basePath}${asset}`}
          key={asset}
          rel="preload"
        />
      ))}
    </>
  )
}
