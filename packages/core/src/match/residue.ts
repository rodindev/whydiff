import { descendant } from './propagate.js'
import { matchedAncestor, type MatchState } from './state.js'
import type { Pair, Unmatched } from './types.js'
import type { SideView } from './view.js'

/** Pass 4: the unmatched subtrees of one side, collapsed to their top-most nodes. */
export function unmatched(view: SideView, partnerOf: readonly number[]): Unmatched[] {
  const out: Unmatched[] = []
  const free = (index: number): boolean => partnerOf[index] === -1
  const countFree = (index: number): number =>
    (view.children[index] ?? []).reduce(
      (sum, child) => (free(child) ? sum + 1 + countFree(child) : sum),
      0
    )
  for (const node of view.nodes) {
    if (!free(node.i) || (node.p >= 0 && free(node.p))) continue
    const inner = descendant(view, node.i)
    const entry: Unmatched = { node: node.i, descendants: countFree(node.i) }
    out.push(inner !== node.i && !free(inner) ? { ...entry, absorbed: true } : entry)
  }
  return out
}

/** Marks pairs whose nearest matched ancestors are not a pair with each other. */
export function markReparented(state: MatchState): Pair[] {
  return state.pairs.map((entry) => {
    const b = matchedAncestor(state, 'before', entry.before)
    const a = matchedAncestor(state, 'after', entry.after)
    const agree = b < 0 && a < 0 ? true : b >= 0 && state.afterOf[b] === a
    return agree ? entry : { ...entry, reparented: true }
  })
}
