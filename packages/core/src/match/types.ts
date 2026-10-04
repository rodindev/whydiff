import type { Rect } from '../snapshot/types.js'

/** How a pair was found: the pass number and, for pass 1, the key that anchored it. */
export type AnchorKind = 'testId' | 'roleName' | 'id' | 'tagText'

/** One before node paired with one after node. */
export interface Pair {
  readonly before: number
  readonly after: number
  /** Per mille: 1000 for anchors, the tier value for propagation, the similarity score for pass 3. */
  readonly confidence: number
  readonly pass: 1 | 2 | 3
  readonly anchor?: AnchorKind
  /** A competing candidate scored almost as well and would yield different deltas. */
  readonly ambiguous?: true
  /** The nearest matched ancestors of the two nodes are not a pair with each other. */
  readonly reparented?: true
}

/** Top-most unmatched node of an unmatched subtree. */
export interface Unmatched {
  readonly node: number
  /** Unmatched nodes below it. */
  readonly descendants: number
  /** A wrapper whose single descendant chain was matched instead. */
  readonly absorbed?: true
}

/** The changed regions, around which `matchSnapshots` scores the nodes still unpaired. */
export interface MatchOptions {
  /** Diff regions in PNG pixels of the compared images; mapped into each snapshot's document space. */
  readonly regions: readonly Rect[]
  /** Every free node is a pass-3 candidate, scored only against nodes that share a tag or a role. */
  readonly massChange?: boolean
}

/** Result of matching two snapshots; indices refer to `nodes` of the respective snapshot. */
export interface Matching {
  readonly pairs: readonly Pair[]
  readonly removed: readonly Unmatched[]
  readonly added: readonly Unmatched[]
  /** Before index to after index, -1 when unmatched. */
  readonly afterOf: readonly number[]
  readonly beforeOf: readonly number[]
  /** Before nodes whose child lists exceeded the LCS budget and were aligned positionally. */
  readonly lowConfidence: readonly number[]
}
