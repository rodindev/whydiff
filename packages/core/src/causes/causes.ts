import type { Deltas } from '../deltas/types.js'
import type { Matching } from '../match/types.js'
import type { Rect, SnapshotV1 } from '../snapshot/types.js'
import { CONTAINER_PROPS } from '../constants.js'
import { actingChanges, boxOf, contextOf, intersects, paints, type Ctx } from './context.js'
import { cornerPart, cornersHolding, resizeCorners } from './corner.js'
import { judge, kindOf } from './culprit.js'
import { shiftGroups } from './groups.js'
import { paintFlip } from './paint.js'
import { Registry } from './registry.js'
import { candidates, diffSums, regionRect, type DiffSums } from './regions.js'
import { grownWith } from './resolve.js'
import type {
  Cause,
  CauseInput,
  CauseNode,
  Explanation,
  RegionExplanation,
  ShiftGroup,
} from './types.js'

/** Finds the nodes whose own change explains the diff regions, with the nodes they moved as effects. */
export function explainChanges(
  before: SnapshotV1,
  after: SnapshotV1,
  matching: Matching,
  deltas: Deltas,
  input: CauseInput
): Explanation {
  const ctx = contextOf(before, after, matching, deltas)
  const registry = new Registry()
  const suppressed = { movedWithAncestor: 0, inherited: 0, derivedOnly: 0 }
  const resized: number[] = []
  const chained = new Set<number>()

  for (const delta of deltas.pairs) {
    const node: CauseNode = { before: delta.before, after: delta.after }
    switch (delta.kind) {
      case 'own':
      case 'content:text':
      case 'content:wrap':
      case 'content:font-metrics':
      case 'scrolled':
        registry.ensure(node, delta.kind)
        break
      case 'resized':
        resized.push(delta.before)
        break
      case 'inherited': {
        suppressed.inherited++
        const root = delta.inheritedFrom ?? -1
        const partner = matching.afterOf[root] ?? -1
        if (partner !== -1) {
          const cause = registry.ensure({ before: root, after: partner }, 'inherited-root')
          cause.kind = 'inherited-root'
          registry.attach(cause, { kind: 'inherited', nodes: [delta.before] })
        }
        break
      }
      case 'moved-with-ancestor':
        suppressed.movedWithAncestor++
        break
      case 'unchanged':
        if (delta.style.length > 0) suppressed.derivedOnly++
        break
      default:
        break
    }
  }
  for (const { node } of deltas.removed) {
    if (paints(ctx.before, node)) registry.ensure({ removed: node }, 'removed')
  }
  for (const { node } of deltas.added) {
    if (paints(ctx.after, node)) registry.ensure({ added: node }, 'added')
  }

  const unexplained: ShiftGroup[] = []
  for (const group of shiftGroups(ctx)) {
    const verdict = judge(ctx, group)
    const shifted = { kind: 'shifted' as const, nodes: group.nodes, vector: group.vector }
    switch (verdict.rule) {
      case 'container': {
        const cause = registry.ensure(pairNode(ctx, verdict.parent), 'container')
        cause.kind = 'container'
        registry.attach(cause, shifted)
        break
      }
      case 'scrolled':
        registry.attach(registry.ensure(pairNode(ctx, verdict.parent), 'scrolled'), shifted)
        break
      case 'reflowed': {
        const reflowed = { kind: 'reflowed' as const, nodes: group.nodes }
        if (verdict.culprits.length === 0) {
          registry.attach(registry.ensure(pairNode(ctx, verdict.fallback), 'resized'), reflowed)
          break
        }
        for (const culprit of verdict.culprits) {
          const cause = registry.ensure(culprit, kindOf(ctx, culprit))
          if (verdict.culprits.length > 1) cause.multiCause = true
          registry.attach(cause, reflowed)
        }
        break
      }
      case 'sibling': {
        const cause = registry.ensure(verdict.culprit, kindOf(ctx, verdict.culprit))
        registry.attach(cause, shifted)
        if (verdict.chain.length > 0) {
          registry.attach(cause, { kind: 'resized', nodes: verdict.chain })
          for (const node of verdict.chain) chained.add(node)
        }
        break
      }
      case 'margin':
      case 'centered':
        registry.attach(
          registry.ensure(
            pairNode(ctx, verdict.node),
            verdict.rule === 'margin' ? 'own' : 'resized'
          ),
          shifted
        )
        break
      case 'unexplained':
        unexplained.push({
          parent: group.parent,
          vector: group.vector,
          nodes: group.nodes,
          candidates: verdict.candidates,
        })
        break
    }
  }

  // Last in document order first, so a container whose child grew with its own child is seen after that child.
  const grownBy = new Map<number, number>()
  for (const index of [...resized].sort((a, b) => b - a)) {
    if (chained.has(index)) continue
    const parent = ctx.before.nodes[index]?.p ?? -1
    if (
      parent >= 0 &&
      actingChanges(ctx.byBefore.get(parent)).some((prop) => CONTAINER_PROPS.includes(prop))
    ) {
      const cause = registry.ensure(pairNode(ctx, parent), 'container')
      cause.kind = 'container'
      registry.attach(cause, { kind: 'resized', nodes: [index] })
      continue
    }
    const owner =
      registry.onBefore(index) === undefined
        ? grownWith(ctx, index, (child) =>
            registry.onBefore(child) === undefined ? grownBy.get(child) : child
          )
        : undefined
    const cause = owner === undefined ? undefined : registry.onBefore(owner)
    if (owner !== undefined && cause !== undefined) {
      registry.attach(cause, { kind: 'resized', nodes: [index] })
      grownBy.set(index, owner)
      continue
    }
    registry.ensure(pairNode(ctx, index), 'resized')
  }

  for (const delta of deltas.pairs) {
    if (delta.kind !== 'painted-by-ancestor') continue
    for (
      let at = ctx.before.nodes[delta.before]?.p ?? -1;
      at >= 0;
      at = ctx.before.nodes[at]?.p ?? -1
    ) {
      const cause = registry.onBefore(at)
      if (cause !== undefined) {
        registry.attach(cause, { kind: 'painted', nodes: [delta.before] })
        break
      }
    }
  }

  for (const region of input.regions) {
    const flip = paintFlip(ctx, regionRect(region, before.image), regionRect(region, after.image))
    if (flip === null) continue
    const cause = registry.ensure(pairNode(ctx, flip.culprit), 'paint-order')
    cause.kind = 'paint-order'
    registry.attach(cause, { kind: 'painted', nodes: [...flip.nodes] })
  }

  const causes = registry.list()
  const corners = { before: resizeCorners(ctx.before), after: resizeCorners(ctx.after) }
  let diff: DiffSums | undefined
  const regions: RegionExplanation[] = input.regions.map((region) => {
    diff ??= diffSums(input.mask)
    const areaBefore = regionRect(region, before.image)
    const areaAfter = regionRect(region, after.image)
    const touching = causes.filter((cause) =>
      causeTouches(
        ctx,
        cause.node,
        cause.effects.flatMap((e) => e.nodes),
        areaBefore,
        areaAfter
      )
    )
    const held = cornersHolding(ctx, corners, areaBefore, areaAfter)
    const ids = touching
      .filter(
        (cause) => held.length === 0 || countsInCorner(ctx, cause, held, areaBefore, areaAfter)
      )
      .map((cause) => cause.id)
    const explained = { region, causes: ids, candidates: candidates(ctx, region, diff) }
    const [corner] = held
    return ids.length === 0 && touching.length > 0 && corner !== undefined
      ? { ...explained, corner }
      : explained
  })
  return { causes, regions, unexplained, suppressed }
}

function pairNode(ctx: Ctx, before: number): CauseNode {
  return { before, after: ctx.matching.afterOf[before] ?? -1 }
}

function causeTouches(
  ctx: Ctx,
  node: CauseNode,
  effectNodes: readonly number[],
  areaBefore: Rect,
  areaAfter: Rect
): boolean {
  const before = (index: number): boolean => intersects(boxOf(ctx.before, index), areaBefore)
  const after = (index: number): boolean => intersects(boxOf(ctx.after, index), areaAfter)
  const effect = (index: number): boolean => {
    const partner = ctx.matching.afterOf[index] ?? -1
    return before(index) || (partner >= 0 && after(partner))
  }
  if ('added' in node) return after(node.added) || effectNodes.some(effect)
  if ('removed' in node) return before(node.removed) || effectNodes.some(effect)
  if (before(node.before) || after(node.after)) return true
  return effectNodes.some(effect)
}

function countsInCorner(
  ctx: Ctx,
  cause: Cause,
  held: readonly number[],
  areaBefore: Rect,
  areaAfter: Rect
): boolean {
  const part = cornerPart(ctx, cause, held)
  if (part.node) return causeTouches(ctx, cause.node, part.effects, areaBefore, areaAfter)
  return part.effects.some((node) =>
    causeTouches(ctx, pairNode(ctx, node), [], areaBefore, areaAfter)
  )
}
