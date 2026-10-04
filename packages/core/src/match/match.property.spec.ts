import fc from 'fast-check'

import type { Rect } from '../snapshot/types.js'
import { buildSnapshot, type TreeSpec } from '../testing/snapshots.js'
import { matchSnapshots } from './match.js'
import type { Matching } from './types.js'

const word = fc.constantFrom('div', 'span', 'p', 'li', 'button', 'a')
const cls = fc.array(fc.constantFrom('a', 'b', 'c', 'row', 'ui-col'), { maxLength: 2 })
const text = fc.constantFrom('Save', 'Cancel', 'Hello world', 'x')
const box = fc
  .tuple(
    fc.nat({ max: 900 }),
    fc.nat({ max: 700 }),
    fc.integer({ min: 1, max: 200 }),
    fc.integer({ min: 1, max: 100 })
  )
  .map(([x, y, w, h]): Rect => [x, y, w, h])

function tree(depth: number): fc.Arbitrary<TreeSpec> {
  const children: fc.Arbitrary<TreeSpec[]> =
    depth === 0 ? fc.constant([]) : fc.array(tree(depth - 1), { maxLength: 3 })
  return fc.record(
    { tag: word, box, cls, text, id: fc.constantFrom('one', 'two', 'three'), children },
    { requiredKeys: ['tag', 'box', 'children'] }
  )
}

const forest = fc.array(tree(3), { minLength: 1, maxLength: 3 })
const regions = fc.array(
  fc
    .tuple(
      fc.nat({ max: 900 }),
      fc.nat({ max: 700 }),
      fc.integer({ min: 1, max: 300 }),
      fc.integer({ min: 1, max: 300 })
    )
    .map(([x, y, w, h]) => [x, y, w, h] as const),
  { maxLength: 2 }
)

function oneToOne(matching: Matching, beforeCount: number, afterCount: number): void {
  const befores = new Set(matching.pairs.map((p) => p.before))
  const afters = new Set(matching.pairs.map((p) => p.after))
  expect(befores.size).toBe(matching.pairs.length)
  expect(afters.size).toBe(matching.pairs.length)
  matching.pairs.forEach((p) => {
    expect(matching.afterOf[p.before]).toBe(p.after)
    expect(matching.beforeOf[p.after]).toBe(p.before)
  })
  expect(
    matching.afterOf.filter((x) => x >= 0).length +
      matching.removed.reduce((n, u) => n + 1 + u.descendants, 0)
  ).toBe(beforeCount)
  expect(
    matching.beforeOf.filter((x) => x >= 0).length +
      matching.added.reduce((n, u) => n + 1 + u.descendants, 0)
  ).toBe(afterCount)
}

describe('matchSnapshots properties', () => {
  it('matches a snapshot with itself completely at full confidence', () => {
    fc.assert(
      fc.property(forest, (specs) => {
        const snapshot = buildSnapshot(specs)
        const matching = matchSnapshots(snapshot, snapshot, { regions: [] })
        expect(matching.pairs.map((p) => [p.before, p.after])).toEqual(
          snapshot.nodes.map((n) => [n.i, n.i])
        )
        expect(
          matching.pairs.every(
            (p) => p.confidence >= 950 && p.pass <= 2 && !p.ambiguous && !p.reparented
          )
        ).toBe(true)
        expect(matching.added).toEqual([])
        expect(matching.removed).toEqual([])
      })
    )
  })

  it('is one-to-one, total over added and removed, and deterministic', () => {
    fc.assert(
      fc.property(forest, forest, regions, (specsB, specsA, rects) => {
        const before = buildSnapshot(specsB)
        const after = buildSnapshot(specsA)
        const matching = matchSnapshots(before, after, { regions: rects })
        oneToOne(matching, before.nodes.length, after.nodes.length)
        expect(matchSnapshots(before, after, { regions: rects })).toEqual(matching)
      })
    )
  })

  it('mirrors its anchors under a swap of the sides', () => {
    fc.assert(
      fc.property(forest, forest, regions, (specsB, specsA, rects) => {
        const before = buildSnapshot(specsB)
        const after = buildSnapshot(specsA)
        const straight = matchSnapshots(before, after, { regions: rects })
        const swapped = matchSnapshots(after, before, { regions: rects })
        const anchors = (pairs: Matching['pairs']): string[] =>
          pairs
            .filter((p) => p.pass === 1)
            .map((p) => `${String(p.before)}>${String(p.after)}:${p.anchor ?? ''}`)
            .sort()
        const mirrored = swapped.pairs.map((p) => ({ ...p, before: p.after, after: p.before }))
        expect(anchors(mirrored)).toEqual(anchors(straight.pairs))
      })
    )
  })
})
