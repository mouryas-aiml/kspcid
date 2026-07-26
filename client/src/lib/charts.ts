/**
 * Chart tokens shared by every surface (BUILD_SPEC §5.2, §5.6, §5.7).
 *
 * §5.2 fixes the categorical order and forbids generating colours
 * procedurally. Keeping the array here — rather than a literal per chart — is
 * what makes "the third series is teal" true across the whole product instead
 * of per component.
 */

/** §5.2 categorical series, max 8, in this order. Beyond 8, group into "Other". */
export const SERIES_COLOURS = [
  '#38BDF8',
  '#FFC53D',
  '#2DD4BF',
  '#A78BFA',
  '#F97066',
  '#84CC16',
  '#F0ABFC',
  '#94A3B8',
] as const

/** §5.2 — the ninth category and beyond is `--txt-2`, the "Other" grey. */
export const OTHER_COLOUR = '#94A3B8'

export function seriesColour(index: number): string {
  return SERIES_COLOURS[index] ?? OTHER_COLOUR
}

/**
 * Take the top `limit` by value and fold the tail into a single "Other" row.
 *
 * §5.2 caps categorical encodings at 8 because a ninth colour is not
 * distinguishable, and the honest way to show a long tail is to say it is one.
 */
export function withOther<T>(
  rows: readonly T[],
  value: (row: T) => number,
  label: (row: T) => string,
  limit = SERIES_COLOURS.length - 1,
): Array<{ label: string; value: number; isOther: boolean }> {
  const sorted = [...rows].sort((a, b) => value(b) - value(a))
  const head = sorted.slice(0, limit).map((row) => ({
    label: label(row),
    value: value(row),
    isOther: false,
  }))
  const tail = sorted.slice(limit)
  if (tail.length === 0) return head
  return [
    ...head,
    {
      label: `Other (${tail.length})`,
      value: tail.reduce((sum, row) => sum + value(row), 0),
      isOther: true,
    },
  ]
}

/** Indian digit grouping — §5.7 requires it in brief mode and it reads correctly here too. */
export function formatIndian(value: number): string {
  return value.toLocaleString('en-IN')
}
