import { PAINTING_PROPS } from '../constants.js'
import type { Matching } from '../match/types.js'
import { viewOf, type SideView } from '../match/view.js'
import type { NodeV1, Point, SnapshotV1 } from '../snapshot/types.js'
import { classify } from './classify.js'
import { actsOnOthers, markDerived, type StyleLookup } from './derived.js'
import { sameValue } from './equal.js'
import { childrenExplain, parentExplains, siblingsExplain, type Sides } from './explain.js'
import { geometryDelta, touchesRegion } from './geometry.js'
import { isInherited, sameInheritedChange } from './inherited.js'
import { ruleTables, sameRule, withRule, type RuleTables } from './rules.js'
import type { DeltaOptions, Deltas, PairDelta, StyleChange } from './types.js'

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/** Describes and classifies every pair of a matching; the culprit search builds on this. */
export function computeDeltas(
  before: SnapshotV1,
  after: SnapshotV1,
  matching: Matching,
  options: DeltaOptions
): Deltas {
  const sides: Sides = {
    before: viewOf(before),
    after: viewOf(after),
    matching,
    lookup: (side, index) => lookupOn(side === 'before' ? before : after, index),
  }
  const tables = ruleTables(before, after)
  const byBefore = new Map<number, PairDelta>()
  const pairs: PairDelta[] = []
  for (const { before: b, after: a } of matching.pairs) {
    const delta = pairDelta(sides, tables, b, a, options, byBefore)
    byBefore.set(b, delta)
    pairs.push(delta)
  }
  return { pairs, added: matching.added, removed: matching.removed }
}

function lookupOn(snapshot: SnapshotV1, index: number): StyleLookup {
  const node = snapshot.nodes[index]
  const row = node === undefined ? undefined : snapshot.styles[node.s]
  return (prop) => {
    const column = snapshot.props.indexOf(prop)
    return column < 0 ? null : (row?.[column] ?? null)
  }
}

function pairDelta(
  sides: Sides,
  tables: RuleTables,
  b: number,
  a: number,
  options: DeltaOptions,
  byBefore: ReadonlyMap<number, PairDelta>
): PairDelta {
  const nb = sides.before.nodes[b]
  const na = sides.after.nodes[a]
  if (nb === undefined || na === undefined)
    throw new Error(`pair ${String(b)}:${String(a)} is outside the snapshots`)
  const lb = sides.lookup('before', b)
  const la = sides.lookup('after', a)
  const style = markDerived(changes(sides.before.snapshot.props, lb, la), lb, la, (prop) =>
    sameRule(tables, sides.before.snapshot, b, sides.after.snapshot, a, prop)
  ).map((change) => withRule(change, sides.before.snapshot, b, sides.after.snapshot, a))
  const live = style.filter((change) => change.derived === undefined)
  const parentPaired = nb.p >= 0 && sides.matching.afterOf[nb.p] === na.p
  const inherited =
    live.length > 0 &&
    parentPaired &&
    live.every(
      (change) =>
        isInherited(change.prop) &&
        sameInheritedChange(
          change.prop,
          { before: lb, after: la },
          { before: sides.lookup('before', nb.p), after: sides.lookup('after', na.p) }
        )
    )
  const geometry = geometryDelta(
    nb.box,
    na.box,
    parentPaired ? (sides.before.nodes[nb.p]?.box ?? null) : null,
    parentPaired ? (sides.after.nodes[na.p]?.box ?? null) : null
  )
  const textBefore = nb.text ?? ''
  const textAfter = na.text ?? ''
  const linesBefore = nb.lineBoxes?.length ?? (textBefore === '' ? 0 : 1)
  const linesAfter = na.lineBoxes?.length ?? (textAfter === '' ? 0 : 1)
  const scrollBefore: Point = [nb.scroll?.[0] ?? 0, nb.scroll?.[1] ?? 0]
  const scrollAfter: Point = [na.scroll?.[0] ?? 0, na.scroll?.[1] ?? 0]
  const scrolled = scrollBefore[0] !== scrollAfter[0] || scrollBefore[1] !== scrollAfter[1]
  const inRegion =
    touchesRegion(nb.box, options.regions, sides.before.snapshot.image) ||
    touchesRegion(na.box, options.regions, sides.after.snapshot.image)
  const fontChanged = nb.font === undefined || na.font === undefined ? true : nb.font !== na.font
  const kind = classify({
    visible: paints(nb) || paints(na),
    own: live.length > 0 && !inherited,
    inherited,
    textChanged: textBefore !== textAfter,
    linesChanged: linesBefore !== linesAfter,
    hasText: textBefore !== '',
    fontChanged,
    geometry,
    scrolled,
    inRegion,
    ancestorPaints: ancestorPaints(sides.before, byBefore, nb.p),
    childrenExplain: (axis, delta) => childrenExplain(sides, b, a, axis, delta),
    parentExplains: (axis, delta) => parentExplains(sides, b, a, axis, delta),
    siblingsExplain: (axis, delta) => siblingsExplain(sides, b, a, axis, delta),
  })
  const out: Mutable<PairDelta> = { before: b, after: a, kind, style, geometry, inRegion }
  if (kind === 'inherited') {
    const parent = byBefore.get(nb.p)
    out.inheritedFrom = parent?.kind === 'inherited' ? (parent.inheritedFrom ?? nb.p) : nb.p
  }
  if (textBefore !== textAfter) out.text = { from: textBefore, to: textAfter }
  if (linesBefore !== linesAfter) out.lines = { from: linesBefore, to: linesAfter }
  if (nb.font !== undefined && na.font !== undefined && nb.font !== na.font) {
    out.font = { from: nb.font, to: na.font }
  }
  if (scrolled) out.scroll = { from: scrollBefore, to: scrollAfter }
  return out
}

function paints(node: NodeV1): boolean {
  return node.box[2] > 0 && node.box[3] > 0 && !(node.flags?.includes('hidden') ?? false)
}

function changes(props: readonly string[], before: StyleLookup, after: StyleLookup): StyleChange[] {
  const out: StyleChange[] = []
  for (const prop of props) {
    const from = before(prop)
    const to = after(prop)
    if (from !== null && to !== null && !sameValue(prop, from, to)) out.push({ prop, from, to })
  }
  return out
}

/** Whether a matched ancestor carries an own change in a property that paints through its descendants. */
function ancestorPaints(
  view: SideView,
  byBefore: ReadonlyMap<number, PairDelta>,
  parent: number
): boolean {
  for (let index = parent; index >= 0; index = view.nodes[index]?.p ?? -1) {
    const delta = byBefore.get(index)
    if (
      delta?.kind === 'own' &&
      delta.style.some((c) => actsOnOthers(c) && PAINTING_PROPS.includes(c.prop))
    ) {
      return true
    }
  }
  return false
}
