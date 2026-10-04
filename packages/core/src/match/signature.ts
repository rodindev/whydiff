import { fnv1a64 } from '../hash.js'
import type { NodeV1 } from '../snapshot/types.js'

const SEP = '\u0000'

/** Per node, the FNV-1a 64 of its strict signature, its children's fingerprints in document order and its own text. */
export function fingerprints(
  nodes: readonly NodeV1[],
  children: readonly (readonly number[])[],
  strict: readonly string[]
): string[] {
  const out: string[] = nodes.map(() => '')
  // Nodes are in document order, so a reverse walk hashes every child before its parent.
  for (let index = nodes.length - 1; index >= 0; index--) {
    const parts = [
      strict[index] ?? '',
      ...(children[index] ?? []).map((child) => out[child] ?? ''),
      nodes[index]?.text ?? '',
    ]
    out[index] = fnv1a64(parts.join(SEP))
  }
  return out
}
