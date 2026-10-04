import { MATCH_WEIGHTS, TEXT_LIMIT } from '../constants.js'
import type { Rect } from '../snapshot/types.js'
import { ancestorsAgree, matchedAncestor, type MatchState } from './state.js'

const FULL = 1000

/** Document-space displacement (CSS px) that the already matched neighbours of a candidate underwent. */
export interface Shift {
  readonly dx: number
  readonly dy: number
}

/** Pass-3 similarity of a before and an after node, per million; null when they share neither tag nor role. */
export function similarity(
  state: MatchState,
  before: number,
  after: number,
  shift: Shift
): number | null {
  const b = state.before.nodes[before]
  const a = state.after.nodes[after]
  if (b === undefined || a === undefined) return null
  const sameTag = b.tag === a.tag
  const sameRole = b.role !== undefined && b.role === a.role
  if (!sameTag && !sameRole) return null
  let numerator = 0
  let denominator = 0
  const feature = (weight: number, value: number | null): void => {
    if (value === null) return
    numerator += weight * value
    denominator += weight
  }
  feature(MATCH_WEIGHTS.tag, sameTag ? FULL : 0)
  feature(
    MATCH_WEIGHTS.role,
    b.role === undefined && a.role === undefined ? null : sameRole ? FULL : 0
  )
  feature(MATCH_WEIGHTS.nameText, nameText(b.name, a.name, b.text, a.text))
  feature(
    MATCH_WEIGHTS.classJaccard,
    jaccard(state.before.classes[before] ?? [], state.after.classes[after] ?? [])
  )
  const shifted: Rect = [b.box[0] + shift.dx, b.box[1] + shift.dy, b.box[2], b.box[3]]
  feature(MATCH_WEIGHTS.iou, iou(shifted, a.box))
  feature(MATCH_WEIGHTS.sizeRatio, ratio(b.box[2] * b.box[3], a.box[2] * a.box[3]))
  feature(MATCH_WEIGHTS.shape, ratio(b.box[2] * a.box[3], a.box[2] * b.box[3]))
  const ancestorB = matchedAncestor(state, 'before', before)
  const ancestorA = matchedAncestor(state, 'after', after)
  feature(
    MATCH_WEIGHTS.ancestors,
    ancestorB < 0 || ancestorA < 0 ? null : ancestorsAgree(state, before, after) ? FULL : 0
  )
  feature(MATCH_WEIGHTS.siblingIndex, siblingIndex(state, before, after))
  feature(MATCH_WEIGHTS.frame, (b.f ?? 0) === (a.f ?? 0) ? FULL : 0)
  return denominator === 0 ? null : Math.floor((1_000_000 * numerator) / (FULL * denominator))
}

function nameText(
  nameB: string | undefined,
  nameA: string | undefined,
  textB: string | undefined,
  textA: string | undefined
): number | null {
  if (nameB === undefined && nameA === undefined && textB === undefined && textA === undefined)
    return null
  const byName = nameB !== undefined && nameA !== undefined ? textSimilarity(nameB, nameA) : 0
  const byText = textB !== undefined && textA !== undefined ? textSimilarity(textB, textA) : 0
  return Math.max(byName, byText)
}

/** 1000 minus the Levenshtein distance as a share of the longer string, over at most TEXT_LIMIT characters. */
export function textSimilarity(x: string, y: string): number {
  const a = x.slice(0, TEXT_LIMIT)
  const b = y.slice(0, TEXT_LIMIT)
  const longest = Math.max(a.length, b.length)
  if (longest === 0) return FULL
  return FULL - Math.floor((FULL * levenshtein(a, b)) / longest)
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
      current[j] = Math.min(substitution, (previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1)
    }
    previous = current
  }
  return previous[b.length] ?? 0
}

function jaccard(x: readonly string[], y: readonly string[]): number | null {
  if (x.length === 0 && y.length === 0) return null
  const other = new Set(y)
  const shared = x.filter((name) => other.has(name)).length
  return Math.floor((FULL * shared) / (x.length + y.length - shared))
}

function iou(a: Rect, b: Rect): number | null {
  const width = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])
  const height = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])
  const shared = width > 0 && height > 0 ? width * height : 0
  const union = a[2] * a[3] + b[2] * b[3] - shared
  return union > 0 ? Math.floor((FULL * shared) / union) : null
}

function ratio(x: number, y: number): number | null {
  const larger = Math.max(x, y)
  return larger > 0 ? Math.floor((FULL * Math.min(x, y)) / larger) : null
}

function siblingIndex(state: MatchState, before: number, after: number): number | null {
  const parentB = state.before.nodes[before]?.p ?? -1
  const parentA = state.after.nodes[after]?.p ?? -1
  const countB = parentB >= 0 ? (state.before.children[parentB]?.length ?? 0) : 1
  const countA = parentA >= 0 ? (state.after.children[parentA]?.length ?? 0) : 1
  const largest = Math.max(countB, countA)
  if (largest === 0) return null
  const distance = Math.abs(
    (state.before.position[before] ?? 0) - (state.after.position[after] ?? 0)
  )
  return FULL - Math.floor((FULL * distance) / largest)
}
