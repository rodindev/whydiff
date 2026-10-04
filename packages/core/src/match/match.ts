import type { SnapshotV1 } from '../snapshot/types.js'
import { assign } from './assign.js'
import { anchor } from './keys.js'
import { propagate } from './propagate.js'
import { markReparented, unmatched } from './residue.js'
import { createState } from './state.js'
import type { Matching, MatchOptions } from './types.js'
import { viewOf } from './view.js'

/** Pairs the nodes of two snapshots: anchors, structural propagation, similarity around the diff regions, residue. */
export function matchSnapshots(
  before: SnapshotV1,
  after: SnapshotV1,
  options: MatchOptions
): Matching {
  const state = createState(viewOf(before), viewOf(after))
  anchor(state)
  propagate(state)
  assign(state, options)
  const pairs = markReparented(state).sort((x, y) => x.before - y.before)
  return {
    pairs,
    removed: unmatched(state.before, state.afterOf),
    added: unmatched(state.after, state.beforeOf),
    afterOf: state.afterOf,
    beforeOf: state.beforeOf,
    lowConfidence: [...new Set(state.lowConfidence)].sort((x, y) => x - y),
  }
}
