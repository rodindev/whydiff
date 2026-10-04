import type { NodeV1, SnapshotV1 } from '../snapshot/types.js'
import { normalizeClasses } from './classes.js'
import { fingerprints } from './signature.js'

/** One snapshot with the lookups every pass needs, built once. */
export interface SideView {
  readonly snapshot: SnapshotV1
  readonly nodes: readonly NodeV1[]
  readonly children: readonly (readonly number[])[]
  /** Position of each node in its parent's child list. */
  readonly position: readonly number[]
  readonly classes: readonly (readonly string[])[]
  /** Tag, role and normalized classes. */
  readonly strict: readonly string[]
  /** Tag and role. */
  readonly loose: readonly string[]
  /** Hash of the subtree: strict signature, the children's fingerprints in document order, own text. */
  readonly fingerprint: readonly string[]
}

const SEP = '\u0000'

export function viewOf(snapshot: SnapshotV1): SideView {
  const { nodes } = snapshot
  const children: number[][] = nodes.map(() => [])
  const position: number[] = nodes.map(() => 0)
  for (const node of nodes) {
    if (node.p >= 0) {
      position[node.i] = children[node.p]?.length ?? 0
      children[node.p]?.push(node.i)
    }
  }
  const classes = nodes.map((node) => normalizeClasses(node.cls ?? []))
  const loose = nodes.map((node) => `${node.tag}${SEP}${node.role ?? ''}`)
  const strict = nodes.map(
    (node, index) => `${loose[index] ?? ''}${SEP}${(classes[index] ?? []).join(' ')}`
  )
  const fingerprint = fingerprints(nodes, children, strict)
  return { snapshot, nodes, children, position, classes, strict, loose, fingerprint }
}

/** Two nodes of one side that any pairing may swap without changing a single delta. */
export function interchangeable(view: SideView, x: number, y: number): boolean {
  const a = view.nodes[x]
  const b = view.nodes[y]
  if (a === undefined || b === undefined) return false
  return (
    view.strict[x] === view.strict[y] &&
    a.s === b.s &&
    a.box[2] === b.box[2] &&
    a.box[3] === b.box[3] &&
    (a.text ?? '') === (b.text ?? '')
  )
}
