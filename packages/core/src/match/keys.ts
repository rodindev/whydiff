import { TEXT_ANCHOR_MIN_LEN } from '../constants.js'
import type { NodeV1 } from '../snapshot/types.js'
import {
  ancestorsAgree,
  isFreeAfter,
  isFreeBefore,
  matchedAncestor,
  pair,
  type MatchState,
} from './state.js'
import type { AnchorKind } from './types.js'

const SEP = '\u0000'
const ANCHOR_CONFIDENCE = 1000
const ANCHOR_KINDS: readonly AnchorKind[] = ['testId', 'roleName', 'id', 'tagText']

function keyOf(node: NodeV1, kind: AnchorKind): string | null {
  switch (kind) {
    case 'testId':
      return node.testId ?? null
    case 'roleName':
      return node.role !== undefined && node.name !== undefined
        ? `${node.role}${SEP}${node.name}`
        : null
    case 'id':
      return node.id ?? null
    case 'tagText':
      return node.text !== undefined && node.text.length >= TEXT_ANCHOR_MIN_LEN
        ? `${node.tag}${SEP}${node.text}`
        : null
  }
}

/** Index of the single node carrying each key; keys that occur twice are dropped. */
function uniqueKeys(nodes: readonly NodeV1[], kind: AnchorKind): Map<string, number> {
  const seen = new Map<string, number>()
  const duplicates = new Set<string>()
  for (const node of nodes) {
    const key = keyOf(node, kind)
    if (key === null) continue
    if (seen.has(key)) duplicates.add(key)
    else seen.set(key, node.i)
  }
  for (const key of duplicates) seen.delete(key)
  return seen
}

/** Pass 1: pairs nodes whose key is unique on both sides, one key kind after another. */
export function anchor(state: MatchState): void {
  for (const kind of ANCHOR_KINDS) {
    const afterKeys = uniqueKeys(state.after.nodes, kind)
    const beforeKeys = uniqueKeys(state.before.nodes, kind)
    const found: [number, number][] = []
    for (const node of state.before.nodes) {
      const key = keyOf(node, kind)
      if (key === null || !beforeKeys.has(key)) continue
      const after = afterKeys.get(key)
      if (after === undefined || !isFreeBefore(state, node.i) || !isFreeAfter(state, after))
        continue
      if (kind === 'tagText' && vetoed(state, node.i, after)) continue
      found.push([node.i, after])
    }
    // Vetoes are judged against earlier kinds only, so the outcome never depends on index order.
    for (const [before, after] of found) pair(state, before, after, ANCHOR_CONFIDENCE, 1, kind)
  }
}

/** A text anchor whose matched ancestors disagree most likely moved to another element. */
function vetoed(state: MatchState, before: number, after: number): boolean {
  const b = matchedAncestor(state, 'before', before)
  const a = matchedAncestor(state, 'after', after)
  return b >= 0 && a >= 0 && !ancestorsAgree(state, before, after)
}
