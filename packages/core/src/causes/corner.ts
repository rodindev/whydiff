import { TEXT_SPACING_PROPS, RESIZER_CORNER } from '../constants.js'
import type { SideView } from '../match/view.js'
import type { Rect } from '../snapshot/types.js'
import { boxOf, contains, isZero, ownChanges, px, styleOf, type Ctx } from './context.js'
import type { Cause } from './types.js'

/** An element that can show a resizer, with the square the resizer paints in. */
export interface Corner {
  readonly node: number
  readonly rect: Rect
}

/** The resize corners of one side: every textarea, the element that shows a resizer by default; snapshots do not record `resize`. */
export function resizeCorners(view: SideView): Corner[] {
  return view.nodes
    .filter((node) => node.tag === 'textarea')
    .map((node) => ({ node: node.i, rect: cornerRect(view, node.i) }))
}

function cornerRect(view: SideView, index: number): Rect {
  const [x, y, width, height] = boxOf(view, index)
  const left =
    styleOf(view, index, 'direction') === 'rtl'
      ? x + px(styleOf(view, index, 'border-left-width'))
      : x + width - px(styleOf(view, index, 'border-right-width')) - RESIZER_CORNER
  const top = y + height - px(styleOf(view, index, 'border-bottom-width')) - RESIZER_CORNER
  return [left, top, RESIZER_CORNER, RESIZER_CORNER]
}

/** Before indices, ascending, of the elements whose corner grown by 1 px holds the region on either side. */
export function cornersHolding(
  ctx: Ctx,
  corners: { readonly before: readonly Corner[]; readonly after: readonly Corner[] },
  areaBefore: Rect,
  areaAfter: Rect
): number[] {
  const holds = (corner: Corner, area: Rect): boolean => {
    const [x, y, width, height] = corner.rect
    return contains([x - 1, y - 1, width + 2, height + 2], area)
  }
  const before = corners.before.filter((c) => holds(c, areaBefore)).map((c) => c.node)
  const after = corners.after
    .filter((c) => holds(c, areaAfter))
    .map((c) => ctx.matching.beforeOf[c.node] ?? -1)
  return [...new Set([...before, ...after])].filter((node) => node >= 0).sort((a, b) => a - b)
}

/** What of a cause may explain a region inside the corners of `held`: its node unless it is one of them and changed only text or spacing styles in place, and its effects but inherited ones on them. */
export function cornerPart(
  ctx: Ctx,
  cause: Cause,
  held: readonly number[]
): { readonly node: boolean; readonly effects: number[] } {
  const { node } = cause
  return {
    node: !('before' in node) || !held.includes(node.before) || !textOrSpacing(ctx, node.before),
    effects: cause.effects.flatMap((effect) =>
      effect.kind === 'inherited' ? effect.nodes.filter((n) => !held.includes(n)) : effect.nodes
    ),
  }
}

function textOrSpacing(ctx: Ctx, before: number): boolean {
  const delta = ctx.byBefore.get(before)
  return (
    delta !== undefined &&
    delta.text === undefined &&
    delta.scroll === undefined &&
    isZero(delta.geometry.abs) &&
    isZero(delta.geometry.size) &&
    ownChanges(delta).every((prop) => TEXT_SPACING_PROPS.includes(prop))
  )
}
