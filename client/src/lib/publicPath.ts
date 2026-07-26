const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/+$/, '') ?? ''

/** Resolve a root-relative public asset against the deployment base path. */
export function publicPath(path: string): string {
  return `${basePath}/${path.replace(/^\/+/, '')}`
}
