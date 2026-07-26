const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/+$/, '') ?? ''

/** Catalyst Web Client Hosting mounts the static export at this fixed path. */
export const isCatalystClientHosting = basePath === '/app'

/** Resolve a root-relative public asset against the deployment base path. */
export function publicPath(path: string): string {
  return `${basePath}/${path.replace(/^\/+/, '')}`
}
