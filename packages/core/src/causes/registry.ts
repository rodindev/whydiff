import type { Cause, CauseKind, CauseNode, Effect } from './types.js'

interface Working {
  readonly node: CauseNode
  kind: CauseKind
  readonly effects: Effect[]
  multiCause: boolean
}

/** Collects causes while the rules run; `list()` numbers them in node order. */
export class Registry {
  private readonly items: Working[] = []
  private readonly byBefore = new Map<number, Working>()
  private readonly byAdded = new Map<number, Working>()
  private readonly byRemoved = new Map<number, Working>()

  /** The cause on a node, created with `kind` when there is none yet. */
  ensure(node: CauseNode, kind: CauseKind): Working {
    const existing = this.find(node)
    if (existing !== undefined) return existing
    const created: Working = { node, kind, effects: [], multiCause: false }
    this.items.push(created)
    if ('before' in node) this.byBefore.set(node.before, created)
    else if ('added' in node) this.byAdded.set(node.added, created)
    else this.byRemoved.set(node.removed, created)
    return created
  }

  find(node: CauseNode): Working | undefined {
    if ('before' in node) return this.byBefore.get(node.before)
    if ('added' in node) return this.byAdded.get(node.added)
    return this.byRemoved.get(node.removed)
  }

  onBefore(index: number): Working | undefined {
    return this.byBefore.get(index)
  }

  /** Adds an effect, merging with an existing one of the same kind and vector. */
  attach(cause: Working, effect: Effect): void {
    const same = cause.effects.find(
      (e) =>
        e.kind === effect.kind &&
        (e.vector?.[0] ?? 0) === (effect.vector?.[0] ?? 0) &&
        (e.vector?.[1] ?? 0) === (effect.vector?.[1] ?? 0)
    )
    if (same === undefined) {
      cause.effects.push({ ...effect, nodes: [...effect.nodes].sort((a, b) => a - b) })
      return
    }
    const merged = [...new Set([...same.nodes, ...effect.nodes])].sort((a, b) => a - b)
    cause.effects[cause.effects.indexOf(same)] = { ...same, nodes: merged }
  }

  /** Causes sorted by node position, with dense ids. */
  list(): Cause[] {
    const sorted = [...this.items].sort((a, b) => position(a.node) - position(b.node))
    return sorted.map((item, id): Cause => {
      const { node, kind, effects } = item
      return item.multiCause
        ? { id, node, kind, effects, multiCause: true }
        : { id, node, kind, effects }
    })
  }
}

/** Before nodes first by index, then added nodes by index; removed nodes sort with before indices. */
function position(node: CauseNode): number {
  if ('before' in node) return node.before * 2
  if ('removed' in node) return node.removed * 2 + 1
  return Number.MAX_SAFE_INTEGER / 2 + node.added
}
