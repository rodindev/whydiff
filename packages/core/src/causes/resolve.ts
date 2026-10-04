import { VEC_TOL } from '../constants.js'
import type { SideView } from '../match/view.js'
import { axisOf, boxOf, isPrimary, px, size, styleOf, type Ctx } from './context.js'

/** Where a size change really comes from, and the nodes passed on the way. */
export interface Resolution {
  readonly node: number
  readonly chain: readonly number[]
}

/** Follows resized-by-child down and resized-by-parent up until a node that changed on its own. */
export function resolveSize(ctx: Ctx, start: number, axis: 0 | 1): Resolution {
  const chain: number[] = []
  const seen = new Set<number>()
  let node = start
  while (!seen.has(node)) {
    seen.add(node)
    const delta = ctx.byBefore.get(node)
    if (delta === undefined || (isPrimary(delta) && delta.kind !== 'resized')) break
    const target = delta.geometry.size[axis]
    let next = -1
    if (delta.kind === 'resized-by-child') next = explainingChild(ctx, node, axis, target)
    else if (delta.kind === 'resized-by-parent') next = ctx.before.nodes[node]?.p ?? -1
    else if (delta.kind === 'resized') next = marginChild(ctx, node, axis, target)
    if (next < 0 || ctx.matching.afterOf[next] === -1) break
    chain.push(node)
    node = next
  }
  return { node, chain }
}

/** A child whose margins along the axis grew by the parent's size delta: the parent only wrapped the margin. */
function marginChild(ctx: Ctx, parent: number, axis: 0 | 1, target: number): number {
  const [startMargin, endMargin] =
    axis === 0 ? ['margin-left', 'margin-right'] : ['margin-top', 'margin-bottom']
  for (const child of ctx.before.children[parent] ?? []) {
    const partner = ctx.matching.afterOf[child] ?? -1
    if (partner === -1) continue
    const margins = (view: SideView, index: number): number =>
      px(styleOf(view, index, startMargin)) + px(styleOf(view, index, endMargin))
    const delta =
      size(boxOf(ctx.after, partner), axis) +
      margins(ctx.after, partner) -
      size(boxOf(ctx.before, child), axis) -
      margins(ctx.before, child)
    if (Math.abs(delta - target) <= VEC_TOL) return child
  }
  return -1
}

function explainingChild(ctx: Ctx, parent: number, axis: 0 | 1, target: number): number {
  for (const child of ctx.before.children[parent] ?? []) {
    const partner = ctx.matching.afterOf[child] ?? -1
    if (partner === -1) continue
    const delta = size(boxOf(ctx.after, partner), axis) - size(boxOf(ctx.before, child), axis)
    if (Math.abs(delta - target) <= VEC_TOL) return child
  }
  return -1
}

/** The child a container with no style change of its own grew with: the children that carry a cause grew the same way along the container's longer change, by at least as much as it did in all; the one that grew most, the first on a tie. */
export function grownWith(
  ctx: Ctx,
  container: number,
  ownerOf: (child: number) => number | undefined
): number | undefined {
  const grew = ctx.byBefore.get(container)?.geometry.size
  if (grew === undefined) return undefined
  const axis = axisOf(grew)
  let total = 0
  let best: { readonly owner: number; readonly growth: number } | undefined
  for (const child of ctx.before.children[container] ?? []) {
    const owner = ownerOf(child)
    const growth = ctx.byBefore.get(child)?.geometry.size[axis] ?? 0
    if (owner === undefined || growth * grew[axis] <= 0) continue
    total += Math.abs(growth)
    if (best === undefined || Math.abs(growth) > best.growth)
      best = { owner, growth: Math.abs(growth) }
  }
  return best !== undefined && Math.abs(grew[axis]) <= total + VEC_TOL ? best.owner : undefined
}
