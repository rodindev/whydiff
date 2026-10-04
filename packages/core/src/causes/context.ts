import { GEOM_EQ_TOL } from '../constants.js'
import { actsOnOthers } from '../deltas/derived.js'
import type { Deltas, PairDelta } from '../deltas/types.js'
import type { Matching } from '../match/types.js'
import { viewOf, type SideView } from '../match/view.js'
import type { Rect, SnapshotV1 } from '../snapshot/types.js'

/** Everything the rules read; built once per call. */
export interface Ctx {
  readonly before: SideView
  readonly after: SideView
  readonly matching: Matching
  readonly deltas: Deltas
  readonly byBefore: ReadonlyMap<number, PairDelta>
}

export function contextOf(
  before: SnapshotV1,
  after: SnapshotV1,
  matching: Matching,
  deltas: Deltas
): Ctx {
  return {
    before: viewOf(before),
    after: viewOf(after),
    matching,
    deltas,
    byBefore: new Map(deltas.pairs.map((pair) => [pair.before, pair])),
  }
}

export function styleOf(view: SideView, index: number, prop: string): string | null {
  const column = view.snapshot.props.indexOf(prop)
  const node = view.nodes[index]
  if (column < 0 || node === undefined) return null
  return view.snapshot.styles[node.s]?.[column] ?? null
}

/** A computed length in CSS px; 0 for keywords and missing values. */
export function px(value: string | null): number {
  const parsed = value === null ? Number.NaN : Number.parseFloat(value)
  return Number.isFinite(parsed) && value?.endsWith('px') === true ? parsed : 0
}

export function depthOf(view: SideView, index: number): number {
  let depth = 0
  for (let at = view.nodes[index]?.p ?? -1; at >= 0; at = view.nodes[at]?.p ?? -1) depth++
  return depth
}

export function boxOf(view: SideView, index: number): Rect {
  return view.nodes[index]?.box ?? [0, 0, 0, 0]
}

/** Width or height along an axis. */
export function size(box: Rect, axis: 0 | 1): number {
  return axis === 0 ? box[2] : box[3]
}

/** The axis along which a vector is larger. */
export function axisOf(vector: readonly [number, number]): 0 | 1 {
  return Math.abs(vector[1]) > Math.abs(vector[0]) ? 1 : 0
}

export function isZero(point: readonly [number, number]): boolean {
  return Math.abs(point[0]) <= GEOM_EQ_TOL && Math.abs(point[1]) <= GEOM_EQ_TOL
}

/** Boxes without width or height paint nothing. */
function hasArea(box: Rect): boolean {
  return box[2] > 0 && box[3] > 0
}

/** A node paints when it has area and the capture did not flag it hidden. */
export function paints(view: SideView, index: number): boolean {
  const node = view.nodes[index]
  return node !== undefined && hasArea(node.box) && !(node.flags?.includes('hidden') ?? false)
}

export function intersects(a: Rect, b: Rect): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]
}

/** Whether `inner` lies inside `outer`, edges included. */
export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner[0] >= outer[0] &&
    inner[1] >= outer[1] &&
    inner[0] + inner[2] <= outer[0] + outer[2] &&
    inner[1] + inner[3] <= outer[1] + outer[3]
  )
}

/** Whether the pair carries a change that can be a cause on its own. */
export function isPrimary(delta: PairDelta | undefined): boolean {
  return (
    delta !== undefined &&
    (delta.kind === 'own' ||
      delta.kind.startsWith('content:') ||
      delta.kind === 'resized' ||
      delta.kind === 'scrolled')
  )
}

/** Non-derived style changes of a pair. */
export function ownChanges(delta: PairDelta | undefined): readonly string[] {
  return (delta?.style ?? []).filter((c) => c.derived === undefined).map((c) => c.prop)
}

/** Style changes of a pair that move or repaint other nodes: its own, and the lengths that followed its font-size. */
export function actingChanges(delta: PairDelta | undefined): readonly string[] {
  return (delta?.style ?? []).filter(actsOnOthers).map((c) => c.prop)
}
