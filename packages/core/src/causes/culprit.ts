import { CONTAINER_PROPS, FLOW_START_JUSTIFY, MAX_CANDIDATES, VEC_TOL } from '../constants.js'
import { actingChanges, axisOf, boxOf, isPrimary, px, size, styleOf, type Ctx } from './context.js'
import type { Group } from './groups.js'
import { resolveSize } from './resolve.js'
import type { CauseKind, CauseNode } from './types.js'

/** What a rule decided for a shift group. */
export type Verdict =
  | { readonly rule: 'container'; readonly parent: number }
  | {
      readonly rule: 'reflowed'
      readonly culprits: readonly CauseNode[]
      readonly fallback: number
    }
  | { readonly rule: 'sibling'; readonly culprit: CauseNode; readonly chain: readonly number[] }
  | { readonly rule: 'margin'; readonly node: number }
  | { readonly rule: 'centered'; readonly node: number }
  | { readonly rule: 'scrolled'; readonly parent: number }
  | { readonly rule: 'unexplained'; readonly candidates: readonly number[] }

const FLEX: ReadonlySet<string> = new Set(['flex', 'inline-flex'])
const GRID: ReadonlySet<string> = new Set(['grid', 'inline-grid'])

export function judge(ctx: Ctx, group: Group): Verdict {
  const parent = group.parent
  if (parent >= 0) {
    if (actingChanges(ctx.byBefore.get(parent)).some((prop) => CONTAINER_PROPS.includes(prop))) {
      return { rule: 'container', parent }
    }
    if (ctx.byBefore.get(parent)?.kind === 'scrolled') return { rule: 'scrolled', parent }
    if (reflows(ctx, parent)) return reflowed(ctx, parent)
  }
  const axis = axisOf(group.vector)
  const vector = group.vector[axis]
  const upstream = parent >= 0 ? upstreamSiblings(ctx, parent, group, axis) : []
  for (const sibling of upstream) {
    const verdict = siblingExplains(ctx, sibling, axis, vector)
    if (verdict !== null) return verdict
  }
  const margin = marginCollapse(ctx, group, axis, vector)
  if (margin >= 0) return { rule: 'margin', node: margin }
  const centered = group.nodes.find((node) => {
    const delta = ctx.byBefore.get(node)?.geometry.size[axis] ?? 0
    return Math.abs(delta + 2 * vector) <= VEC_TOL && Math.abs(delta) > VEC_TOL
  })
  if (centered !== undefined) return { rule: 'centered', node: centered }
  const candidates = upstream
    .filter((s) => s.kind === 'removed' || ctx.byBefore.get(s.index)?.kind !== 'unchanged')
    .map((s) => s.index)
    .slice(0, MAX_CANDIDATES)
  return { rule: 'unexplained', candidates }
}

function reflows(ctx: Ctx, parent: number): boolean {
  const partner = ctx.matching.afterOf[parent] ?? -1
  const display = styleOf(ctx.after, partner, 'display') ?? ''
  if (GRID.has(display)) return true
  if (
    FLEX.has(display) &&
    !FLOW_START_JUSTIFY.includes(styleOf(ctx.after, partner, 'justify-content') ?? 'normal')
  )
    return true
  return (ctx.before.children[parent] ?? []).some(
    (child) =>
      (styleOf(ctx.before, child, 'float') ?? 'none') !== 'none' ||
      (styleOf(ctx.before, child, 'order') ?? '0') !== '0'
  )
}

function reflowed(ctx: Ctx, parent: number): Verdict {
  const culprits: CauseNode[] = []
  for (const child of ctx.before.children[parent] ?? []) {
    const partner = ctx.matching.afterOf[child] ?? -1
    if (partner === -1) culprits.push({ removed: child })
    else if (isPrimary(ctx.byBefore.get(child))) culprits.push({ before: child, after: partner })
  }
  const partner = ctx.matching.afterOf[parent] ?? -1
  for (const child of ctx.after.children[partner] ?? []) {
    if (ctx.matching.beforeOf[child] === -1) culprits.push({ added: child })
  }
  return { rule: 'reflowed', culprits, fallback: parent }
}

interface Sibling {
  readonly kind: 'pair' | 'removed' | 'added'
  readonly index: number
  readonly start: number
}

/** Siblings laid out before the group's first member, nearest first, in flow order of the parent. */
function upstreamSiblings(ctx: Ctx, parent: number, group: Group, axis: 0 | 1): Sibling[] {
  const rtl = (styleOf(ctx.before, parent, 'direction') ?? 'ltr') === 'rtl'
  const start = (box: readonly number[], horizontalRtl: boolean): number => {
    if (axis === 1) return box[1] ?? 0
    return horizontalRtl ? -((box[0] ?? 0) + (box[2] ?? 0)) : (box[0] ?? 0)
  }
  const first = Math.min(...group.nodes.map((node) => start(boxOf(ctx.before, node), rtl)))
  const siblings: Sibling[] = []
  for (const child of ctx.before.children[parent] ?? []) {
    if (group.nodes.includes(child)) continue
    const position = start(boxOf(ctx.before, child), rtl)
    if (position < first)
      siblings.push({
        kind: ctx.matching.afterOf[child] === -1 ? 'removed' : 'pair',
        index: child,
        start: position,
      })
  }
  const partner = ctx.matching.afterOf[parent] ?? -1
  const firstAfter = Math.min(
    ...group.nodes.map((node) => start(boxOf(ctx.after, ctx.matching.afterOf[node] ?? -1), rtl))
  )
  for (const child of ctx.after.children[partner] ?? []) {
    if (ctx.matching.beforeOf[child] !== -1) continue
    const position = start(boxOf(ctx.after, child), rtl)
    if (position < firstAfter) siblings.push({ kind: 'added', index: child, start: position })
  }
  return siblings.sort((a, b) => b.start - a.start || a.index - b.index)
}

function outer(ctx: Ctx, side: 'before' | 'after', index: number, axis: 0 | 1): number {
  const view = side === 'before' ? ctx.before : ctx.after
  const [startMargin, endMargin] =
    axis === 0 ? ['margin-left', 'margin-right'] : ['margin-top', 'margin-bottom']
  return (
    size(boxOf(view, index), axis) +
    px(styleOf(view, index, startMargin)) +
    px(styleOf(view, index, endMargin))
  )
}

function siblingExplains(ctx: Ctx, sibling: Sibling, axis: 0 | 1, vector: number): Verdict | null {
  if (sibling.kind === 'added') {
    return Math.abs(outer(ctx, 'after', sibling.index, axis) - vector) <= VEC_TOL
      ? { rule: 'sibling', culprit: { added: sibling.index }, chain: [] }
      : null
  }
  if (sibling.kind === 'removed') {
    return Math.abs(outer(ctx, 'before', sibling.index, axis) + vector) <= VEC_TOL
      ? { rule: 'sibling', culprit: { removed: sibling.index }, chain: [] }
      : null
  }
  const partner = ctx.matching.afterOf[sibling.index] ?? -1
  const rtl =
    axis === 0 &&
    (styleOf(ctx.before, ctx.before.nodes[sibling.index]?.p ?? -1, 'direction') ?? 'ltr') === 'rtl'
  const endBefore = pushingEdge(ctx, 'before', sibling.index, axis, rtl)
  const endAfter = pushingEdge(ctx, 'after', partner, axis, rtl)
  const delta = ctx.byBefore.get(sibling.index)
  const relEnd =
    endAfter - endBefore - (delta?.geometry.abs[axis] ?? 0) + (delta?.geometry.rel[axis] ?? 0)
  if (Math.abs(relEnd - vector) > VEC_TOL) return null
  const kind = delta?.kind ?? 'unchanged'
  if (!isPrimary(delta) && kind !== 'resized-by-child' && kind !== 'resized-by-parent') return null
  const resolved = resolveSize(ctx, sibling.index, axis)
  const final = ctx.matching.afterOf[resolved.node] ?? -1
  return {
    rule: 'sibling',
    culprit: { before: resolved.node, after: final },
    chain: resolved.chain,
  }
}

/** The edge of a sibling that pushes what follows in flow: end edge plus margin, or the start edge in rtl rows. */
function pushingEdge(
  ctx: Ctx,
  side: 'before' | 'after',
  index: number,
  axis: 0 | 1,
  rtl: boolean
): number {
  const view = side === 'before' ? ctx.before : ctx.after
  const box = boxOf(view, index)
  if (rtl) return box[0] - px(styleOf(view, index, 'margin-left'))
  const endMargin = axis === 0 ? 'margin-right' : 'margin-bottom'
  return box[axis] + size(box, axis) + px(styleOf(view, index, endMargin))
}

/** A member, or its first or last child, whose block margin changed by the vector. */
function marginCollapse(ctx: Ctx, group: Group, axis: 0 | 1, vector: number): number {
  if (axis !== 1) return -1
  for (const node of group.nodes) {
    const children = ctx.before.children[node] ?? []
    for (const candidate of [node, children[0] ?? -1, children[children.length - 1] ?? -1]) {
      if (candidate < 0) continue
      const partner = ctx.matching.afterOf[candidate] ?? -1
      if (partner === -1) continue
      for (const prop of ['margin-top', 'margin-bottom']) {
        const change =
          px(styleOf(ctx.after, partner, prop)) - px(styleOf(ctx.before, candidate, prop))
        if (Math.abs(change - vector) <= VEC_TOL && Math.abs(change) > VEC_TOL) return candidate
      }
    }
  }
  return -1
}

export function kindOf(ctx: Ctx, node: CauseNode): CauseKind {
  if ('added' in node) return 'added'
  if ('removed' in node) return 'removed'
  const delta = ctx.byBefore.get(node.before)
  switch (delta?.kind) {
    case 'content:text':
    case 'content:wrap':
    case 'content:font-metrics':
    case 'scrolled':
      return delta.kind
    case 'own':
      return 'own'
    default:
      return 'resized'
  }
}
