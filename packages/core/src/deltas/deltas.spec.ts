import fc from 'fast-check'

import { matchSnapshots } from '../match/match.js'
import type { Matching } from '../match/types.js'
import { serializeSnapshot } from '../snapshot/serialize.js'
import type { Rect, SnapshotV1 } from '../snapshot/types.js'
import { buildSnapshot, type TreeSpec } from '../testing/snapshots.js'
import { computeDeltas } from './deltas.js'
import type { PairDelta } from './types.js'

const PROPS = [
  'display',
  'flex-direction',
  'color',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'opacity',
  'border-top-style',
  'border-top-color',
]
const BASE: Record<string, string> = {
  display: 'block',
  'flex-direction': 'row',
  color: 'rgb(0, 0, 0)',
  'font-size': '16px',
  'font-weight': '400',
  'line-height': 'normal',
  'letter-spacing': 'normal',
  opacity: '1',
  'border-top-style': 'none',
  'border-top-color': 'rgb(0, 0, 0)',
}
const style = (overrides: Record<string, string> = {}): string[] =>
  PROPS.map((p) => overrides[p] ?? BASE[p] ?? '')

/** Pairs node i with node i: both sides were built from parallel specs. */
function identity(count: number): Matching {
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

const build = (specs: TreeSpec[], origin: readonly [number, number] = [0, 0]): SnapshotV1 =>
  buildSnapshot(specs, { props: PROPS, origin })
const deltas = (
  before: TreeSpec[],
  after: TreeSpec[],
  regions: Rect[] = []
): readonly PairDelta[] => {
  const a = build(before)
  const b = build(after)
  return computeDeltas(a, b, identity(a.nodes.length), { regions }).pairs
}
const kinds = (pairs: readonly PairDelta[]): string[] => pairs.map((p) => p.kind)
const page = (children: TreeSpec[], root: Partial<TreeSpec> = {}): TreeSpec[] => [
  {
    tag: 'html',
    box: [0, 0, 1000, 800],
    style: style(),
    children: [{ tag: 'body', box: [0, 0, 1000, 800], style: style(), children, ...root }],
  },
]

describe('computeDeltas: styles', () => {
  it('lists every changed property, marks derived ones and classifies a real change as own', () => {
    const before = page([{ tag: 'p', box: [0, 0, 100, 20], style: style() }])
    const after = page([
      {
        tag: 'p',
        box: [0, 0, 100, 20],
        style: style({ color: 'rgb(9, 9, 9)', 'border-top-color': 'rgb(5, 5, 5)' }),
      },
    ])
    const [, , p] = deltas(before, after)
    expect(p?.kind).toBe('own')
    expect(p?.style).toEqual([
      { prop: 'color', from: 'rgb(0, 0, 0)', to: 'rgb(9, 9, 9)' },
      { prop: 'border-top-color', from: 'rgb(0, 0, 0)', to: 'rgb(5, 5, 5)', derived: 'unpainted' },
    ])
  })

  it('records the rule of each side on every change when both snapshots carry attributions', () => {
    const rules = { sheets: [{ href: 'http://app.test/a.css', hash: 'a1' }] }
    const before = buildSnapshot(page([{ tag: 'p', box: [0, 0, 100, 20], style: style(), a: 1 }]), {
      props: PROPS,
      ...rules,
      rules: [{ sheet: 0, selector: 'p' }],
      attributions: [PROPS.map(() => -1), PROPS.map((p) => (p === 'color' ? 0 : -1))],
    })
    const after = buildSnapshot(
      page([
        {
          tag: 'p',
          box: [0, 0, 100, 20],
          style: style({ color: 'rgb(9, 9, 9)', 'font-weight': '700' }),
          a: 1,
        },
      ]),
      {
        props: PROPS,
        ...rules,
        rules: [{ sheet: 0, selector: '.dark' }],
        attributions: [PROPS.map(() => -1), PROPS.map((p) => (p === 'color' ? 0 : -1))],
      }
    )
    const [, , p] = computeDeltas(before, after, identity(before.nodes.length), {
      regions: [],
    }).pairs
    expect(p?.style).toEqual([
      { prop: 'color', from: 'rgb(0, 0, 0)', to: 'rgb(9, 9, 9)', rule: { from: 0, to: 0 } },
      { prop: 'font-weight', from: '400', to: '700', rule: { from: null, to: null } },
    ])
    const [, , bare] = deltas(
      page([{ tag: 'p', box: [0, 0, 100, 20], style: style() }]),
      page([{ tag: 'p', box: [0, 0, 100, 20], style: style({ color: 'rgb(9, 9, 9)' }) }])
    )
    expect(bare?.style[0]?.rule).toBeUndefined()
  })

  it('collapses an inherited typography change onto the ancestor that carries it', () => {
    const bold = style({ 'font-weight': '700', 'letter-spacing': '1px' })
    const boldSmall = style({
      'font-weight': '700',
      'letter-spacing': '0.75px',
      'font-size': '12px',
    })
    const before = page([
      {
        tag: 'section',
        box: [0, 0, 500, 100],
        style: style(),
        children: [
          {
            tag: 'p',
            box: [0, 0, 500, 20],
            style: style(),
            children: [{ tag: 'span', box: [0, 0, 50, 20], style: style({ 'font-size': '12px' }) }],
          },
        ],
      },
    ])
    const after = page([
      {
        tag: 'section',
        box: [0, 0, 500, 100],
        style: bold,
        children: [
          {
            tag: 'p',
            box: [0, 0, 500, 20],
            style: bold,
            children: [{ tag: 'span', box: [0, 0, 50, 20], style: boldSmall }],
          },
        ],
      },
    ])
    const result = deltas(before, after)
    expect(kinds(result)).toEqual(['unchanged', 'unchanged', 'own', 'inherited', 'inherited'])
    expect(result[3]?.inheritedFrom).toBe(2)
    expect(result[4]?.inheritedFrom).toBe(2)
  })

  it('leaves a node without area unchanged whatever its styles did', () => {
    const before = page([
      { tag: 'div', box: [0, 0, 0, 0], style: style() },
      { tag: 'div', box: [0, 0, 100, 0], style: style() },
    ])
    const after = page([
      { tag: 'div', box: [0, 0, 300, 0], style: style({ color: 'rgb(9, 9, 9)' }) },
      { tag: 'div', box: [0, 0, 100, 0], style: style({ opacity: '0.5' }) },
    ])
    const result = deltas(before, after)
    expect(kinds(result).slice(2)).toEqual(['unchanged', 'unchanged'])
    expect(result[2]?.style.map((c) => c.prop)).toEqual(['color'])
  })

  it('leaves a node the capture flagged hidden on both sides unchanged, but not one that became hidden', () => {
    const before = page([
      { tag: 'span', box: [0, 0, 100, 40], flags: ['hidden'], style: style() },
      { tag: 'span', box: [0, 50, 100, 40], style: style() },
    ])
    const after = page([
      {
        tag: 'span',
        box: [0, 0, 100, 40],
        flags: ['hidden'],
        style: style({ color: 'rgb(9, 9, 9)' }),
      },
      { tag: 'span', box: [0, 50, 100, 40], flags: ['hidden'], style: style({ opacity: '0' }) },
    ])
    expect(kinds(deltas(before, after)).slice(2)).toEqual(['unchanged', 'own'])
  })

  it('keeps a child own when it changes differently from its parent', () => {
    const before = page([
      {
        tag: 'div',
        box: [0, 0, 500, 100],
        style: style(),
        children: [{ tag: 'p', box: [0, 0, 500, 20], style: style() }],
      },
    ])
    const after = page([
      {
        tag: 'div',
        box: [0, 0, 500, 100],
        style: style({ 'font-weight': '700' }),
        children: [{ tag: 'p', box: [0, 0, 500, 20], style: style({ 'font-weight': '500' }) }],
      },
    ])
    expect(kinds(deltas(before, after)).slice(2)).toEqual(['own', 'own'])
  })

  it('marks an unchanged descendant inside a diff region under a faded ancestor as painted by it', () => {
    const before = page([
      {
        tag: 'div',
        box: [100, 100, 200, 100],
        style: style(),
        children: [{ tag: 'span', box: [110, 110, 50, 20], style: style() }],
      },
    ])
    const after = page([
      {
        tag: 'div',
        box: [100, 100, 200, 100],
        style: style({ opacity: '0.5' }),
        children: [{ tag: 'span', box: [110, 110, 50, 20], style: style() }],
      },
    ])
    expect(kinds(deltas(before, after, [[100, 100, 200, 100]])).slice(2)).toEqual([
      'own',
      'painted-by-ancestor',
    ])
    expect(kinds(deltas(before, after)).slice(2)).toEqual(['own', 'unchanged'])
  })

  it('takes a mask-image change alone as own and as painting the descendants in the region', () => {
    const fade = 'linear-gradient(rgba(0, 0, 0, 0) 0px, rgb(0, 0, 0) 16px)'
    const masked = (mask: string): SnapshotV1 =>
      buildSnapshot(
        [
          {
            tag: 'div',
            box: [100, 100, 200, 100],
            style: [...style(), mask],
            children: [{ tag: 'span', box: [110, 110, 50, 20], style: [...style(), 'none'] }],
          },
        ],
        { props: [...PROPS, 'mask-image'] }
      )
    const { pairs } = computeDeltas(masked('none'), masked(fade), identity(2), {
      regions: [[100, 100, 200, 100]],
    })
    expect(kinds(pairs)).toEqual(['own', 'painted-by-ancestor'])
    expect(pairs[0]?.style).toEqual([{ prop: 'mask-image', from: 'none', to: fade }])
  })

  describe('em lengths that follow the font-size', () => {
    const props = [...PROPS, 'filter']
    type Rules = Pick<SnapshotV1, 'sheets' | 'rules' | 'attributions'>
    const row = (rules: Record<string, number>): number[] => props.map((p) => rules[p] ?? -1)
    const sides = (caps: string): [Rules, Rules] => [
      {
        sheets: [{ href: 'http://app.test/assets/app-Bx81kQ2c.css', hash: 'app1' }],
        rules: [
          { sheet: 0, selector: '.ui-panel' },
          { sheet: 0, selector: '.ui-caps' },
        ],
        attributions: [row({}), row({ 'font-size': 0, 'letter-spacing': 1, filter: 1 })],
      },
      {
        sheets: [{ href: 'http://app.test/assets/app-D4a0LmZe.css', hash: 'app2' }],
        rules: [
          { sheet: 0, selector: caps },
          { sheet: 0, selector: '.ui-panel-lg' },
        ],
        attributions: [row({}), row({ 'font-size': 1, 'letter-spacing': 0, filter: 0 })],
      },
    ]
    const panel = (size: string, spacing: string, blur: string, rules: Rules | null): SnapshotV1 =>
      buildSnapshot(
        page([
          {
            tag: 'div',
            box: [100, 100, 200, 100],
            style: [...style({ 'font-size': size, 'letter-spacing': spacing }), `blur(${blur})`],
            a: 1,
            children: [{ tag: 'img', box: [110, 110, 50, 20], style: [...style(), 'none'] }],
          },
        ]),
        { props, ...rules }
      )
    const pairs = ([from, to]: [Rules, Rules] | [null, null]): readonly PairDelta[] => {
      const a = panel('16px', '0.8px', '1.6px', from)
      const b = panel('24px', '1.2px', '2.4px', to)
      return computeDeltas(a, b, identity(a.nodes.length), { regions: [[100, 100, 200, 100]] })
        .pairs
    }
    const reasons = (pair: PairDelta | undefined) =>
      pair?.style.map((c) => [c.prop, c.derived ?? null])

    it('marks them derived when one rule set them on both sides, across a rebuilt sheet', () => {
      expect(reasons(pairs(sides('.ui-caps'))[2])).toEqual([
        ['font-size', null],
        ['letter-spacing', 'font-size'],
        ['filter', 'font-size'],
      ])
    })

    it('keeps them as changes when another rule set them or the snapshots name no rules', () => {
      const kept = [
        ['font-size', null],
        ['letter-spacing', null],
        ['filter', null],
      ]
      expect(reasons(pairs(sides('.ui-wide'))[2])).toEqual(kept)
      expect(reasons(pairs([null, null])[2])).toEqual(kept)
    })

    it('still lets a filter that grew with the font paint the descendants in the region', () => {
      expect(kinds(pairs(sides('.ui-caps'))).slice(2)).toEqual(['own', 'painted-by-ancestor'])
    })
  })
})

describe('computeDeltas: content and geometry', () => {
  it('tells text, wrap and font-metrics changes apart', () => {
    const before = page([
      { tag: 'p', box: [0, 0, 300, 20], text: 'Save', style: style() },
      { tag: 'p', box: [0, 40, 300, 20], text: 'Long line', style: style() },
      { tag: 'p', box: [0, 80, 100, 20], text: 'Same', style: style() },
    ])
    const after = page([
      { tag: 'p', box: [0, 0, 300, 20], text: 'Saved', style: style() },
      { tag: 'p', box: [0, 40, 300, 40], text: 'Long line', lines: 2, style: style() },
      { tag: 'p', box: [0, 80, 112, 20], text: 'Same', style: style() },
    ])
    const result = deltas(before, after)
    expect(kinds(result).slice(2)).toEqual(['content:text', 'content:wrap', 'content:font-metrics'])
    expect(result[3]?.lines).toEqual({ from: 1, to: 2 })
    expect(result[2]?.text).toEqual({ from: 'Save', to: 'Saved' })
  })

  it('calls a size change font metrics only when the platform font changed or is unknown', () => {
    const before = page([
      { tag: 'p', box: [0, 0, 100, 20], text: 'Same', font: 'Inter-Regular', style: style() },
      { tag: 'p', box: [0, 40, 100, 20], text: 'Same', font: 'Inter-Regular', style: style() },
    ])
    const after = page([
      { tag: 'p', box: [0, 0, 112, 20], text: 'Same', font: 'Inter-Regular', style: style() },
      { tag: 'p', box: [0, 40, 112, 20], text: 'Same', font: 'NotoSans-Regular', style: style() },
    ])
    const result = deltas(before, after)
    expect(kinds(result).slice(2)).toEqual(['resized', 'content:font-metrics'])
    expect(result[2]?.font).toBeUndefined()
    expect(result[3]?.font).toEqual({ from: 'Inter-Regular', to: 'NotoSans-Regular' })
  })

  it('explains sizes by children, parent and flex siblings, shifts what follows, and leaves the rest resized', () => {
    const before = page([
      {
        tag: 'section',
        box: [0, 0, 400, 100],
        style: style(),
        children: [{ tag: 'img', box: [0, 0, 400, 100], style: style() }],
      },
      {
        tag: 'div',
        box: [0, 200, 400, 50],
        style: style({ display: 'flex' }),
        children: [
          { tag: 'a', box: [0, 200, 200, 50], style: style() },
          { tag: 'a', box: [200, 200, 200, 50], style: style() },
        ],
      },
      {
        tag: 'div',
        box: [0, 300, 400, 50],
        style: style({ display: 'grid' }),
        children: [{ tag: 'b', box: [0, 300, 400, 50], style: style() }],
      },
      { tag: 'div', box: [0, 400, 400, 50], style: style() },
    ])
    const after = page([
      {
        tag: 'section',
        box: [0, 0, 400, 140],
        style: style(),
        children: [{ tag: 'img', box: [0, 0, 400, 140], style: style() }],
      },
      {
        tag: 'div',
        box: [0, 240, 400, 50],
        style: style({ display: 'flex' }),
        children: [
          { tag: 'a', box: [0, 240, 240, 50], style: style() },
          { tag: 'a', box: [240, 240, 160, 50], style: style() },
        ],
      },
      {
        tag: 'div',
        box: [0, 340, 500, 50],
        style: style({ display: 'grid' }),
        children: [{ tag: 'b', box: [0, 340, 500, 50], style: style() }],
      },
      { tag: 'div', box: [0, 440, 400, 70], style: style() },
    ])
    expect(kinds(deltas(before, after)).slice(2)).toEqual([
      'resized-by-child',
      'resized-by-parent',
      'shifted',
      'resized-by-sibling',
      'resized-by-sibling',
      'resized-by-child',
      'resized-by-parent',
      'resized',
    ])
  })

  it('separates nodes that moved with their parent from nodes that shifted inside it', () => {
    const before = page([
      {
        tag: 'ul',
        box: [0, 0, 200, 100],
        style: style(),
        children: [
          { tag: 'li', box: [0, 0, 200, 20], style: style() },
          { tag: 'li', box: [0, 20, 200, 20], style: style() },
        ],
      },
    ])
    const after = page([
      {
        tag: 'ul',
        box: [0, 50, 200, 100],
        style: style(),
        children: [
          { tag: 'li', box: [0, 50, 200, 20], style: style() },
          { tag: 'li', box: [0, 80, 200, 20], style: style() },
        ],
      },
    ])
    const result = deltas(before, after)
    expect(kinds(result).slice(2)).toEqual(['shifted', 'moved-with-ancestor', 'shifted'])
    expect(result[4]?.geometry).toEqual({ abs: [0, 60], rel: [0, 10], size: [0, 0] })
  })

  it('reports an inner scroller whose offset changed as scrolled', () => {
    const before = page([
      { tag: 'div', box: [0, 0, 200, 100], scroll: [0, 0, 200, 400], style: style() },
    ])
    const after = page([
      { tag: 'div', box: [0, 0, 200, 100], scroll: [0, 40, 200, 400], style: style() },
    ])
    const result = deltas(before, after)
    expect(result[2]).toMatchObject({ kind: 'scrolled', scroll: { from: [0, 0], to: [0, 40] } })
  })

  it('maps regions through origin and scale of each side', () => {
    const a = build(page([{ tag: 'p', box: [0, 500, 100, 20], style: style() }]), [0, 400])
    const b = build(page([{ tag: 'p', box: [0, 500, 100, 20], style: style() }]), [0, 400])
    const touching = computeDeltas(a, b, identity(a.nodes.length), {
      regions: [[0, 100, 50, 10]],
    }).pairs
    const missing = computeDeltas(a, b, identity(a.nodes.length), {
      regions: [[0, 50, 50, 10]],
    }).pairs
    expect(touching[2]?.inRegion).toBe(true)
    expect(missing[2]?.inRegion).toBe(false)
  })
})

describe('computeDeltas: properties', () => {
  const word = fc.constantFrom('div', 'span', 'p', 'li')
  const box = fc
    .tuple(
      fc.nat({ max: 900 }),
      fc.nat({ max: 700 }),
      fc.integer({ min: 1, max: 200 }),
      fc.integer({ min: 1, max: 100 })
    )
    .map(([x, y, w, h]): Rect => [x, y, w, h])
  const styles = fc.constantFrom(
    style(),
    style({ 'font-weight': '700' }),
    style({ color: 'rgb(9, 9, 9)' }),
    style({ opacity: '0.5' })
  )
  const text = fc.constantFrom('Save', 'Cancel', 'x')
  const shape = (depth: number): fc.Arbitrary<TreeSpec[]> =>
    fc.array(
      fc.record(
        {
          tag: word,
          box,
          style: styles,
          text,
          children: depth === 0 ? fc.constant([] as TreeSpec[]) : shape(depth - 1),
        },
        { requiredKeys: ['tag', 'box', 'style', 'children'] }
      ),
      { minLength: 1, maxLength: 3 }
    )
  /** Two sides with the same shape: the specs differ only in boxes, styles and text. */
  const sameShape = (depth: number): fc.Arbitrary<[TreeSpec[], TreeSpec[]]> =>
    fc
      .array(
        fc.tuple(
          fc.record(
            { tag: word, box, style: styles, text },
            { requiredKeys: ['tag', 'box', 'style'] }
          ),
          fc.record({ box, style: styles, text }, { requiredKeys: ['box', 'style'] }),
          depth === 0
            ? fc.constant([] as [TreeSpec[], TreeSpec[]][])
            : fc.array(sameShape(depth - 1), { maxLength: 2 })
        ),
        { minLength: 1, maxLength: 3 }
      )
      .map((items) => {
        const before: TreeSpec[] = []
        const after: TreeSpec[] = []
        for (const [b, a, nested] of items) {
          const childrenBefore = nested.flatMap(([cb]) => cb)
          const childrenAfter = nested.flatMap(([, ca]) => ca)
          before.push({ ...b, children: childrenBefore })
          after.push({ ...b, ...a, children: childrenAfter })
        }
        return [before, after]
      })

  it('finds nothing when a snapshot is compared with itself', () => {
    fc.assert(
      fc.property(shape(2), (specs) => {
        const snapshot = build(specs)
        const result = computeDeltas(snapshot, snapshot, identity(snapshot.nodes.length), {
          regions: [],
        })
        expect(
          result.pairs.every(
            (p) => p.kind === 'unchanged' && p.style.length === 0 && p.text === undefined
          )
        ).toBe(true)
      })
    )
  })

  it('mirrors under a swap of the sides', () => {
    const symmetric = new Set([
      'own',
      'inherited',
      'content:text',
      'content:wrap',
      'moved-with-ancestor',
      'shifted',
      'scrolled',
      'unchanged',
      'resized',
      'resized-by-child',
      'resized-by-parent',
      'resized-by-sibling',
    ])
    fc.assert(
      fc.property(sameShape(2), ([specsB, specsA]) => {
        const before = build(specsB)
        const after = build(specsA)
        const matching = identity(before.nodes.length)
        const straight = computeDeltas(before, after, matching, { regions: [] }).pairs
        const swapped = computeDeltas(after, before, matching, { regions: [] }).pairs
        straight.forEach((p, i) => {
          const q = swapped[i]
          expect(q?.geometry).toEqual({
            abs: p.geometry.abs.map((v) => 0 - v),
            rel: p.geometry.rel.map((v) => 0 - v),
            size: p.geometry.size.map((v) => 0 - v),
          })
          expect(q?.style).toEqual(p.style.map((c) => ({ ...c, from: c.to, to: c.from })))
          if (symmetric.has(p.kind)) expect(q?.kind).toBe(p.kind)
        })
      })
    )
  })
})

describe('computeDeltas: golden cases', () => {
  const cases: Record<string, [TreeSpec[], TreeSpec[], Rect[]]> = {
    'inherited-typography': [
      page([
        {
          tag: 'main',
          box: [0, 0, 600, 200],
          style: style(),
          children: [
            {
              tag: 'h1',
              box: [0, 0, 600, 40],
              text: 'Title',
              style: style({ 'font-size': '32px' }),
            },
            {
              tag: 'p',
              box: [0, 50, 600, 20],
              text: 'Body',
              style: style(),
              children: [{ tag: 'em', box: [0, 50, 60, 20], text: 'Body', style: style() }],
            },
          ],
        },
      ]),
      page([
        {
          tag: 'main',
          box: [0, 0, 600, 200],
          style: style({ 'font-weight': '500', 'letter-spacing': '0.5px' }),
          children: [
            {
              tag: 'h1',
              box: [0, 0, 600, 40],
              text: 'Title',
              style: style({ 'font-size': '32px', 'font-weight': '500', 'letter-spacing': '1px' }),
            },
            {
              tag: 'p',
              box: [0, 50, 600, 20],
              text: 'Body',
              style: style({ 'font-weight': '500', 'letter-spacing': '0.5px' }),
              children: [
                {
                  tag: 'em',
                  box: [0, 50, 60, 20],
                  text: 'Body',
                  style: style({ 'font-weight': '500', 'letter-spacing': '0.5px' }),
                },
              ],
            },
          ],
        },
      ]),
      [[0, 0, 600, 70]],
    ],
    'reset-border-colour': [
      page([
        {
          tag: 'div',
          box: [0, 0, 200, 50],
          style: style(),
          children: [{ tag: 'span', box: [0, 0, 100, 50], style: style() }],
        },
      ]),
      page([
        {
          tag: 'div',
          box: [0, 0, 200, 50],
          style: style({ 'border-top-color': 'rgb(229, 231, 235)' }),
          children: [
            {
              tag: 'span',
              box: [0, 0, 100, 50],
              style: style({ 'border-top-color': 'rgb(229, 231, 235)' }),
            },
          ],
        },
      ]),
      [],
    ],
    'child-pushes-parent': [
      page([
        {
          tag: 'section',
          box: [0, 0, 400, 120],
          style: style(),
          children: [
            { tag: 'p', box: [0, 0, 400, 20], text: 'Short', style: style() },
            { tag: 'p', box: [0, 20, 400, 100], text: 'Below', style: style() },
          ],
        },
        { tag: 'footer', box: [0, 120, 400, 40], style: style() },
      ]),
      page([
        {
          tag: 'section',
          box: [0, 0, 400, 140],
          style: style(),
          children: [
            {
              tag: 'p',
              box: [0, 0, 400, 40],
              text: 'Short',
              style: style({ 'font-size': '32px' }),
            },
            { tag: 'p', box: [0, 40, 400, 100], text: 'Below', style: style() },
          ],
        },
        { tag: 'footer', box: [0, 140, 400, 40], style: style() },
      ]),
      [[0, 0, 400, 180]],
    ],
    'container-reflow': [
      page([
        {
          tag: 'div',
          box: [0, 0, 300, 100],
          style: style({ display: 'flex' }),
          children: [
            { tag: 'a', box: [0, 0, 150, 100], style: style() },
            { tag: 'a', box: [150, 0, 150, 100], style: style() },
          ],
        },
      ]),
      page([
        {
          tag: 'div',
          box: [0, 0, 400, 100],
          style: style({ display: 'flex' }),
          children: [
            { tag: 'a', box: [0, 0, 200, 100], style: style() },
            { tag: 'a', box: [200, 0, 200, 100], style: style() },
          ],
        },
      ]),
      [[150, 0, 250, 100]],
    ],
    'scrolled-list': [
      page([
        {
          tag: 'ul',
          box: [0, 0, 200, 100],
          scroll: [0, 0, 200, 300],
          style: style(),
          children: [
            { tag: 'li', box: [0, 0, 200, 50], text: 'One', style: style() },
            { tag: 'li', box: [0, 50, 200, 50], text: 'Two', style: style() },
          ],
        },
      ]),
      page([
        {
          tag: 'ul',
          box: [0, 0, 200, 100],
          scroll: [0, 25, 200, 300],
          style: style(),
          children: [
            { tag: 'li', box: [0, -25, 200, 50], text: 'One', style: style() },
            { tag: 'li', box: [0, 25, 200, 50], text: 'Two', style: style() },
          ],
        },
      ]),
      [[0, 0, 200, 100]],
    ],
    'faded-ancestor': [
      page([
        {
          tag: 'div',
          box: [0, 0, 200, 100],
          style: style(),
          children: [{ tag: 'p', box: [0, 0, 200, 20], text: 'Text', style: style() }],
        },
      ]),
      page([
        {
          tag: 'div',
          box: [0, 0, 200, 100],
          style: style({ opacity: '0.4' }),
          children: [{ tag: 'p', box: [0, 0, 200, 20], text: 'Text', style: style() }],
        },
      ]),
      [[0, 0, 200, 100]],
    ],
  }

  it.each(Object.entries(cases))('%s', async (name, [specsB, specsA, regions]) => {
    const before = build(specsB)
    const after = build(specsA)
    await expect(serializeSnapshot(before)).toMatchFileSnapshot(
      `../../fixtures/deltas/${name}/before.whydiff.json`
    )
    await expect(serializeSnapshot(after)).toMatchFileSnapshot(
      `../../fixtures/deltas/${name}/after.whydiff.json`
    )
    const result = computeDeltas(before, after, matchSnapshots(before, after, { regions }), {
      regions,
    })
    await expect(`${JSON.stringify(result, null, 2)}\n`).toMatchFileSnapshot(
      `../../fixtures/deltas/${name}/deltas.json`
    )
  })
})
