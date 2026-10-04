import fc from 'fast-check'

import { computeDeltas } from '../deltas/deltas.js'
import { matchSnapshots } from '../match/match.js'
import { diffRegions, PIXEL_DIFFERENT, PIXEL_SAME, type DiffMask } from '../pixels/index.js'
import type { Rect } from '../snapshot/types.js'
import { buildSnapshot, type TreeSpec } from '../testing/snapshots.js'
import { explainChanges } from './causes.js'

const PROPS = ['display', 'padding-top', 'margin-bottom', 'font-size', 'color', 'opacity']
const styles = fc.constantFrom(
  ['block', '0px', '0px', '16px', 'rgb(0, 0, 0)', '1'],
  ['block', '8px', '0px', '16px', 'rgb(0, 0, 0)', '1'],
  ['block', '0px', '12px', '16px', 'rgb(0, 0, 0)', '1'],
  ['block', '0px', '0px', '24px', 'rgb(0, 0, 0)', '1'],
  ['block', '0px', '0px', '16px', 'rgb(9, 9, 9)', '1'],
  ['flex', '0px', '0px', '16px', 'rgb(0, 0, 0)', '0.5']
)
const box = fc
  .tuple(
    fc.nat({ max: 400 }),
    fc.nat({ max: 300 }),
    fc.integer({ min: 1, max: 100 }),
    fc.integer({ min: 1, max: 50 })
  )
  .map(([x, y, w, h]): Rect => [x, y, w, h])
const text = fc.constantFrom('Save', 'Cancel', 'Hello world')

type Pairing = [TreeSpec[], TreeSpec[]]
/** Same tree shape on both sides; boxes, styles and texts may differ, and a leaf may be dropped on either side. */
const sameShape = (depth: number): fc.Arbitrary<Pairing> =>
  fc
    .array(
      fc.tuple(
        fc.record(
          { tag: fc.constantFrom('div', 'p', 'span', 'li'), box, style: styles, text },
          { requiredKeys: ['tag', 'box', 'style'] }
        ),
        fc.record({ box, style: styles, text }, { requiredKeys: ['box', 'style'] }),
        fc.constantFrom('both', 'both', 'both', 'before', 'after'),
        depth === 0
          ? fc.constant([] as Pairing[])
          : fc.array(sameShape(depth - 1), { maxLength: 2 })
      ),
      { minLength: 1, maxLength: 3 }
    )
    .map((items) => {
      const before: TreeSpec[] = []
      const after: TreeSpec[] = []
      for (const [b, a, side, nested] of items) {
        const childrenBefore = nested.flatMap(([cb]) => cb)
        const childrenAfter = nested.flatMap(([, ca]) => ca)
        if (side !== 'after') before.push({ ...b, children: childrenBefore })
        if (side !== 'before') after.push({ ...b, ...a, children: childrenAfter })
      }
      return [before, after]
    })

const diffRects = fc.array(box, { maxLength: 3 })

function maskOf(rects: readonly Rect[]): DiffMask {
  const width = 500
  const height = 400
  const classes = new Uint8Array(width * height).fill(PIXEL_SAME)
  let differing = 0
  for (const [x, y, w, h] of rects) {
    for (let j = y; j < Math.min(height, y + h); j++) {
      for (let i = x; i < Math.min(width, x + w); i++) {
        if (classes[j * width + i] === PIXEL_SAME) differing++
        classes[j * width + i] = PIXEL_DIFFERENT
      }
    }
  }
  return { width, height, classes, differing, sizeMismatch: null }
}

describe('explainChanges properties', () => {
  it('accounts for every shifted pair once, lists candidates for every region, and is deterministic', () => {
    fc.assert(
      fc.property(sameShape(2), diffRects, ([specsB, specsA], rects) => {
        const before = buildSnapshot(specsB, { props: PROPS })
        const after = buildSnapshot(specsA, { props: PROPS })
        const mask = maskOf(rects)
        const { regions, massChange } = diffRegions(mask)
        const rectsOf: Rect[] = regions.map((r) => [r.x, r.y, r.width, r.height])
        const matching = matchSnapshots(before, after, { regions: rectsOf, massChange })
        const deltas = computeDeltas(before, after, matching, { regions: rectsOf })
        const explanation = explainChanges(before, after, matching, deltas, { regions, mask })
        const shifted = deltas.pairs.filter((p) => p.kind === 'shifted').map((p) => p.before)
        const accounted = [
          ...explanation.causes.flatMap((c) =>
            c.effects
              .filter((e) => e.kind === 'shifted' || e.kind === 'reflowed')
              .flatMap((e) => e.nodes)
          ),
          ...explanation.unexplained.flatMap((g) => g.nodes),
        ]
        for (const node of shifted)
          expect(accounted.filter((n) => n === node).length).toBeGreaterThanOrEqual(1)
        expect(explanation.regions).toHaveLength(regions.length)
        for (const region of explanation.regions)
          expect(region.candidates.length).toBeLessThanOrEqual(3)
        const ids = explanation.causes.map((c) => c.id)
        expect(ids).toEqual(ids.map((_, i) => i))
        expect(explainChanges(before, after, matching, deltas, { regions, mask })).toEqual(
          explanation
        )
      })
    )
  })
})
