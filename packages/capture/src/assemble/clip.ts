import type { FrameV1, NodeV1, Rect } from '@whydiff/core'

import { intersects } from './units.js'

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/** Keeps the root subtree, its ancestors, every node painted inside the clip and every frame owner; renumbers. */
export function clipToRoot(
  nodes: readonly NodeV1[],
  frames: readonly FrameV1[],
  rootIndex: number,
  clip: Rect
): { nodes: NodeV1[]; frames: FrameV1[]; rootIndex: number } {
  const keep: boolean[] = nodes.map(() => false)
  const keepWithAncestors = (index: number): void => {
    for (let i = index; i >= 0 && !keep[i]; i = nodes[i]?.p ?? -1) keep[i] = true
  }
  const underRoot: boolean[] = nodes.map(() => false)
  nodes.forEach((node, index) => {
    const parentUnderRoot = node.p >= 0 && (underRoot[node.p] ?? false)
    underRoot[index] = index === rootIndex || parentUnderRoot
    if (underRoot[index]) keep[index] = true
  })
  keepWithAncestors(rootIndex)
  nodes.forEach((node, index) => {
    if (node.box[2] > 0 && node.box[3] > 0 && intersects(node.box, clip)) keepWithAncestors(index)
  })
  for (const frame of frames) {
    if (frame.owner !== null) keepWithAncestors(frame.owner)
  }
  const newIndex: number[] = []
  let next = 0
  keep.forEach((kept, index) => {
    newIndex[index] = kept ? next++ : -1
  })
  const renumbered: NodeV1[] = []
  nodes.forEach((node, index) => {
    if (!keep[index]) return
    const copy: Mutable<NodeV1> = { ...node, i: newIndex[index] ?? -1 }
    if (node.p >= 0) copy.p = newIndex[node.p] ?? -1
    renumbered.push(copy)
  })
  return {
    nodes: renumbered,
    frames: frames.map((frame) =>
      frame.owner === null ? frame : { ...frame, owner: newIndex[frame.owner] ?? null }
    ),
    rootIndex: newIndex[rootIndex] ?? 0,
  }
}
