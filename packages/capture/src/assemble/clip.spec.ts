import type { FrameV1, NodeV1 } from '@whydiff/core'

import { clipToRoot } from './clip.js'

const node = (i: number, p: number, box: NodeV1['box'], extra: Partial<NodeV1> = {}): NodeV1 => ({
  i,
  p,
  tag: 'div',
  box,
  s: 0,
  ...extra,
})

describe('clipToRoot', () => {
  const nodes: NodeV1[] = [
    node(0, -1, [0, 0, 1000, 1000]),
    node(1, 0, [0, 0, 1000, 1000]),
    node(2, 1, [10, 10, 40, 40]),
    node(3, 1, [200, 200, 600, 400]),
    node(4, 3, [250, 250, 40, 40]),
    node(5, 3, [850, 210, 40, 40]),
    node(6, 1, [700, 500, 200, 60]),
    node(7, 1, [500, 700, 10, 10]),
    node(8, -1, [510, 710, 10, 10], { f: 1 }),
  ]
  const frames: FrameV1[] = [
    { url: 'a', owner: null, offset: [0, 0], scroll: [0, 0], status: 'captured' },
    { url: 'b', owner: 7, offset: [500, 700], scroll: [0, 0], status: 'captured' },
  ]

  it('keeps the subtree, the ancestors, nodes painted inside the clip and frame owners', () => {
    const result = clipToRoot(nodes, frames, 3, [200, 200, 600, 400])
    expect(result.nodes.map((n) => [n.i, n.p])).toEqual([
      [0, -1],
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 2],
      [5, 1],
      [6, 1],
    ])
    expect(result.rootIndex).toBe(2)
    expect(result.frames[1]?.owner).toBe(6)
  })

  it('drops nodes outside the clip that are not under the root', () => {
    const result = clipToRoot(nodes, frames, 3, [200, 200, 600, 400])
    expect(result.nodes.some((n) => n.box[0] === 10 && n.box[1] === 10)).toBe(false)
    expect(result.nodes.some((n) => n.f === 1)).toBe(false)
  })
})
