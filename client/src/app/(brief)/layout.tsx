import type { ReactNode } from 'react'

/**
 * The light shell is applied per page rather than here.
 *
 * `BriefShell` carries the back link, and the two brief routes are reached from
 * different places — the Justice Pipeline from the command wall, a station
 * brief from the overview. A layout cannot read the child route's params, so
 * fixing the link here would send half the pages to the wrong place.
 */
export default function BriefLayout({ children }: { readonly children: ReactNode }) {
  return children
}
