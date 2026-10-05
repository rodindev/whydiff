import { fnv1a64 } from '../hash.js'
import type { Rect } from '../snapshot/types.js'

const ID_LENGTH = 6
// Below every printable character, so keys sort field by field, as report.json's fields do.
const FIELD = '\x1e'

/** A Playwright screenshot's key: project, test file and title, the repeat index under --repeat-each, then `rest`. These are what Playwright makes a test id from, and a test's page, test-results and a two-run manifest keep them too, so the run's reporter, report --from and diff of two runs key a failed screenshot alike. */
export function screenKey(
  test: { readonly project: string; readonly file: string; readonly repeat: number },
  title: string,
  ...rest: string[]
): string {
  const repeat = test.repeat > 0 ? ` (repeat:${String(test.repeat)})` : ''
  return [test.project, test.file, `${title}${repeat}`, ...rest].join(FIELD)
}

/** Stable id of a screenshot in every report: `s` plus six base36 digits of its screen key's hash. */
export function screenshotId(screen: string): string {
  return `s${fnv1a64(screen).slice(0, ID_LENGTH)}`
}

/** Stable id of an unexplained region: `u` plus the hash of the screen key and the region rectangle. */
export function unexplainedId(screen: string, region: Rect): string {
  return `u${fnv1a64(`${screen}|${region.join(',')}`).slice(0, ID_LENGTH)}`
}
