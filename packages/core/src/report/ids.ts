import { fnv1a64 } from '../hash.js'
import type { Rect } from '../snapshot/types.js'

const ID_LENGTH = 6

/** Stable id of a screenshot in every report: `s` plus six base36 digits of its screen key's hash. */
export function screenshotId(screen: string): string {
  return `s${fnv1a64(screen).slice(0, ID_LENGTH)}`
}

/** Stable id of an unexplained region: `u` plus the hash of the screen key and the region rectangle. */
export function unexplainedId(screen: string, region: Rect): string {
  return `u${fnv1a64(`${screen}|${region.join(',')}`).slice(0, ID_LENGTH)}`
}
