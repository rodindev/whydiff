import type { SideView } from './view.js'
import type { AnchorKind, Pair } from './types.js'

/** Mutable pairing state shared by the passes; `pairs` is sorted at the end. */
export interface MatchState {
  readonly before: SideView
  readonly after: SideView
  readonly afterOf: number[]
  readonly beforeOf: number[]
  readonly pairs: Pair[]
  readonly lowConfidence: number[]
}

export function createState(before: SideView, after: SideView): MatchState {
  return {
    before,
    after,
    afterOf: before.nodes.map(() => -1),
    beforeOf: after.nodes.map(() => -1),
    pairs: [],
    lowConfidence: [],
  }
}

export function isFreeBefore(state: MatchState, index: number): boolean {
  return state.afterOf[index] === -1
}

export function isFreeAfter(state: MatchState, index: number): boolean {
  return state.beforeOf[index] === -1
}

export function pair(
  state: MatchState,
  before: number,
  after: number,
  confidence: number,
  pass: 1 | 2 | 3,
  anchor?: AnchorKind
): Pair {
  state.afterOf[before] = after
  state.beforeOf[after] = before
  const entry: Pair =
    anchor === undefined
      ? { before, after, confidence, pass }
      : { before, after, confidence, pass, anchor }
  state.pairs.push(entry)
  return entry
}

/** Nearest ancestor of `index` on `side` that is matched, or -1. */
export function matchedAncestor(
  state: MatchState,
  side: 'before' | 'after',
  index: number
): number {
  const view = side === 'before' ? state.before : state.after
  const table = side === 'before' ? state.afterOf : state.beforeOf
  let current = view.nodes[index]?.p ?? -1
  while (current >= 0 && table[current] === -1) current = view.nodes[current]?.p ?? -1
  return current
}

/** True when the nearest matched ancestors of a before node and an after node are a pair with each other. */
export function ancestorsAgree(state: MatchState, before: number, after: number): boolean {
  const b = matchedAncestor(state, 'before', before)
  const a = matchedAncestor(state, 'after', after)
  return b >= 0 && a >= 0 && state.afterOf[b] === a
}
