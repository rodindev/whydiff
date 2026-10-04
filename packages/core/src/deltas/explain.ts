import { GEOM_EQ_TOL, VEC_TOL } from '../constants.js'
import type { Matching } from '../match/types.js'
import type { SideView } from '../match/view.js'
import type { Rect } from '../snapshot/types.js'
import type { StyleLookup } from './derived.js'
import { extent, span } from './geometry.js'

/** Both sides of a matching as the geometry rules see them. */
export interface Sides {
  readonly before: SideView
  readonly after: SideView
  readonly matching: Matching
  readonly lookup: (side: 'before' | 'after', index: number) => StyleLookup
}

const FLEX: ReadonlySet<string> = new Set(['flex', 'inline-flex'])
const GRID: ReadonlySet<string> = new Set(['grid', 'inline-grid'])

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= VEC_TOL
}

/** The matched children's extent changed by the size delta, or an added or removed child spans it. */
export function childrenExplain(
  sides: Sides,
  before: number,
  after: number,
  axis: 0 | 1,
  delta: number
): boolean {
  const matchedExtent = (
    view: SideView,
    index: number,
    partnerOf: readonly number[]
  ): number | null => {
    const spans = (view.children[index] ?? [])
      .filter((child) => partnerOf[child] !== -1)
      .map((child) => span(view.nodes[child]?.box ?? [0, 0, 0, 0], axis))
    if (spans.length === 0) return null
    return Math.max(...spans.map((s) => s[1])) - Math.min(...spans.map((s) => s[0]))
  }
  const extentBefore = matchedExtent(sides.before, before, sides.matching.afterOf)
  const extentAfter = matchedExtent(sides.after, after, sides.matching.beforeOf)
  if (extentBefore !== null && extentAfter !== null && close(extentAfter - extentBefore, delta))
    return true
  const unmatchedSpan = (
    view: SideView,
    index: number,
    partnerOf: readonly number[],
    sign: 1 | -1
  ): boolean =>
    (view.children[index] ?? []).some((child) => {
      const box: Rect = view.nodes[child]?.box ?? [0, 0, 0, 0]
      return partnerOf[child] === -1 && close(sign * extent(box, axis), delta)
    })
  return (
    unmatchedSpan(sides.after, after, sides.matching.beforeOf, 1) ||
    unmatchedSpan(sides.before, before, sides.matching.afterOf, -1)
  )
}

/** The matched parent changed by the same amount, or it is a flex or grid container whose size changed. */
export function parentExplains(
  sides: Sides,
  before: number,
  after: number,
  axis: 0 | 1,
  delta: number
): boolean {
  const parentBefore = sides.before.nodes[before]?.p ?? -1
  const parentAfter = sides.after.nodes[after]?.p ?? -1
  if (parentBefore < 0 || sides.matching.afterOf[parentBefore] !== parentAfter) return false
  const sizeBefore = extent(sides.before.nodes[parentBefore]?.box ?? [0, 0, 0, 0], axis)
  const sizeAfter = extent(sides.after.nodes[parentAfter]?.box ?? [0, 0, 0, 0], axis)
  const parentDelta = sizeAfter - sizeBefore
  if (close(parentDelta, delta)) return true
  const display = sides.lookup('after', parentAfter)('display') ?? ''
  return (FLEX.has(display) || GRID.has(display)) && Math.abs(parentDelta) > GEOM_EQ_TOL
}

/** In a flex row or column, the matched siblings gave up along the main axis what this node took. */
export function siblingsExplain(
  sides: Sides,
  before: number,
  after: number,
  axis: 0 | 1,
  delta: number
): boolean {
  const parentBefore = sides.before.nodes[before]?.p ?? -1
  const parentAfter = sides.after.nodes[after]?.p ?? -1
  if (parentBefore < 0 || sides.matching.afterOf[parentBefore] !== parentAfter) return false
  const parent = sides.lookup('after', parentAfter)
  if (!FLEX.has(parent('display') ?? '')) return false
  const mainAxis = (parent('flex-direction') ?? 'row').startsWith('column') ? 1 : 0
  if (mainAxis !== axis) return false
  let sum = 0
  for (const sibling of sides.before.children[parentBefore] ?? []) {
    const partner = sides.matching.afterOf[sibling] ?? -1
    if (sibling === before || partner === -1) continue
    sum +=
      extent(sides.after.nodes[partner]?.box ?? [0, 0, 0, 0], axis) -
      extent(sides.before.nodes[sibling]?.box ?? [0, 0, 0, 0], axis)
  }
  return close(sum, -delta)
}
