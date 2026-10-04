import { computeDeltas } from '../deltas/deltas.js'
import type { Matching } from '../match/types.js'
import { buildSnapshot, type TreeSpec } from '../testing/snapshots.js'
import { contextOf } from './context.js'
import { shiftGroups } from './groups.js'

const identity = (count: number): Matching => {
  const indices = Array.from({ length: count }, (_, i) => i)
  return {
    pairs: indices.map((i) => ({ before: i, after: i, confidence: 1000, pass: 1 })),
    removed: [],
    added: [],
    afterOf: indices,
    beforeOf: indices,
    lowConfidence: [],
  }
}
const page = (children: TreeSpec[]): TreeSpec[] => [
  {
    tag: 'html',
    box: [0, 0, 1000, 800],
    children: [{ tag: 'body', box: [0, 0, 1000, 800], children }],
  },
]

describe('shiftGroups', () => {
  it('groups shifted siblings by parent and quantized vector, in index order', () => {
    const before = buildSnapshot(
      page([
        {
          tag: 'ul',
          box: [0, 0, 200, 100],
          children: [
            { tag: 'li', box: [0, 0, 200, 20] },
            { tag: 'li', box: [0, 20, 200, 20] },
            { tag: 'li', box: [0, 40, 200, 20] },
          ],
        },
        { tag: 'p', box: [0, 200, 200, 20] },
      ])
    )
    const after = buildSnapshot(
      page([
        {
          tag: 'ul',
          box: [0, 0, 200, 100],
          children: [
            { tag: 'li', box: [0, 0, 200, 20] },
            { tag: 'li', box: [0, 30.2, 200, 20] },
            { tag: 'li', box: [0, 50.1, 200, 20] },
          ],
        },
        { tag: 'p', box: [0, 180, 200, 20] },
      ])
    )
    const matching = identity(before.nodes.length)
    const groups = shiftGroups(
      contextOf(before, after, matching, computeDeltas(before, after, matching, { regions: [] }))
    )
    expect(groups).toEqual([
      { parent: 1, vector: [0, -20], nodes: [6] },
      { parent: 2, vector: [0, 10], nodes: [4, 5] },
    ])
  })
})
