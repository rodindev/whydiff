import { PAINT_ORDER_PROPS } from '../constants.js'
import type { Rect } from '../snapshot/types.js'
import { boxOf, depthOf, intersects, ownChanges, type Ctx } from './context.js'

/** Two unchanged, overlapping nodes whose paint order flipped, and the node that flipped it. */
export interface PaintFlip {
  readonly culprit: number
  readonly nodes: readonly [number, number]
}

/** Among the pairs touching the region on either side, finds two overlapping nodes painted in a new order. */
export function paintFlip(ctx: Ctx, areaBefore: Rect, areaAfter: Rect): PaintFlip | null {
  // Deepest first, so the nodes that actually paint win over their containers.
  const touching = ctx.deltas.pairs
    .filter(
      (delta) =>
        intersects(boxOf(ctx.before, delta.before), areaBefore) ||
        intersects(boxOf(ctx.after, delta.after), areaAfter)
    )
    .sort(
      (a, b) => depthOf(ctx.before, b.before) - depthOf(ctx.before, a.before) || a.before - b.before
    )
  for (let i = 0; i < touching.length; i++) {
    for (let j = i + 1; j < touching.length; j++) {
      const a = touching[i]
      const b = touching[j]
      if (a === undefined || b === undefined) continue
      const overlap =
        intersects(boxOf(ctx.before, a.before), boxOf(ctx.before, b.before)) ||
        intersects(boxOf(ctx.after, a.after), boxOf(ctx.after, b.after))
      if (!overlap) continue
      if (isAncestor(ctx, a.before, b.before) || isAncestor(ctx, b.before, a.before)) continue
      if (!flipped(ctx, a.before, a.after, b.before, b.after)) continue
      const culprit = stackingCulprit(ctx, a.before) ?? stackingCulprit(ctx, b.before)
      if (culprit !== null) return { culprit, nodes: [a.before, b.before] }
    }
  }
  return null
}

function flipped(ctx: Ctx, a: number, aAfter: number, b: number, bAfter: number): boolean {
  const layerA = ctx.before.nodes[a]?.layer
  const layerB = ctx.before.nodes[b]?.layer
  const layerAAfter = ctx.after.nodes[aAfter]?.layer
  const layerBAfter = ctx.after.nodes[bAfter]?.layer
  if (
    layerA !== undefined &&
    layerB !== undefined &&
    layerAAfter !== undefined &&
    layerBAfter !== undefined
  ) {
    return (layerA - layerB) * (layerAAfter - layerBAfter) < 0
  }
  return stackingCulprit(ctx, a) !== null || stackingCulprit(ctx, b) !== null
}

function isAncestor(ctx: Ctx, ancestor: number, node: number): boolean {
  for (let at = ctx.before.nodes[node]?.p ?? -1; at >= 0; at = ctx.before.nodes[at]?.p ?? -1) {
    if (at === ancestor) return true
  }
  return false
}

/** The nearest ancestor-or-self whose stacking flag or paint-order property changed. */
function stackingCulprit(ctx: Ctx, index: number): number | null {
  for (let at = index; at >= 0; at = ctx.before.nodes[at]?.p ?? -1) {
    const partner = ctx.matching.afterOf[at] ?? -1
    if (partner === -1) continue
    const stackingChanged =
      (ctx.before.nodes[at]?.stacking ?? false) !== (ctx.after.nodes[partner]?.stacking ?? false)
    const paintChanged = ownChanges(ctx.byBefore.get(at)).some((prop) =>
      PAINT_ORDER_PROPS.includes(prop)
    )
    if (stackingChanged || paintChanged) return at
  }
  return null
}
