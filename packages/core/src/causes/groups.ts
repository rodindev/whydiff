import { VEC_TOL } from '../constants.js'
import type { Point } from '../snapshot/types.js'
import type { Ctx } from './context.js'

/** `shifted` pairs that moved by the same vector inside the same matched parent. */
export interface Group {
  readonly parent: number
  readonly vector: Point
  readonly nodes: number[]
}

function quantize(value: number): number {
  return Math.round(value / VEC_TOL) * VEC_TOL
}

/** Groups in parent order, then by vector (y, then x), nodes ascending. */
export function shiftGroups(ctx: Ctx): Group[] {
  const groups = new Map<string, Group>()
  for (const delta of ctx.deltas.pairs) {
    if (delta.kind !== 'shifted') continue
    const parent = ctx.before.nodes[delta.before]?.p ?? -1
    const vector: Point = [quantize(delta.geometry.rel[0]), quantize(delta.geometry.rel[1])]
    const key = `${String(parent)}|${String(vector[0])}|${String(vector[1])}`
    const group = groups.get(key)
    if (group === undefined) groups.set(key, { parent, vector, nodes: [delta.before] })
    else group.nodes.push(delta.before)
  }
  return [...groups.values()].sort(
    (a, b) => a.parent - b.parent || a.vector[1] - b.vector[1] || a.vector[0] - b.vector[0]
  )
}
