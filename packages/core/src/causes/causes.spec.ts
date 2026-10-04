import { computeDeltas } from '../deltas/deltas.js'
import { matchSnapshots } from '../match/match.js'
import {
  diffRegions,
  PIXEL_DIFFERENT,
  PIXEL_SAME,
  type DiffMask,
  type Region,
} from '../pixels/index.js'
import { serializeSnapshot } from '../snapshot/serialize.js'
import type { Rect, SnapshotV1 } from '../snapshot/types.js'
import { buildSnapshot, type TreeSpec } from '../testing/snapshots.js'
import { explainChanges } from './causes.js'
import type { Explanation } from './types.js'

const PROPS = [
  'display',
  'justify-content',
  'flex-direction',
  'direction',
  'float',
  'order',
  'padding-top',
  'padding-left',
  'margin-top',
  'margin-bottom',
  'margin-right',
  'font-size',
  'color',
  'opacity',
  'contain',
  'z-index',
  'position',
]
const BASE: Record<string, string> = {
  display: 'block',
  'justify-content': 'normal',
  'flex-direction': 'row',
  direction: 'ltr',
  float: 'none',
  order: '0',
  'padding-top': '0px',
  'padding-left': '0px',
  'margin-top': '0px',
  'margin-bottom': '0px',
  'margin-right': '0px',
  'font-size': '16px',
  color: 'rgb(0, 0, 0)',
  opacity: '1',
  contain: 'none',
  'z-index': 'auto',
  position: 'static',
}
const style = (overrides: Record<string, string> = {}): string[] =>
  PROPS.map((p) => overrides[p] ?? BASE[p] ?? '')
const page = (children: TreeSpec[], body: Partial<TreeSpec> = {}): TreeSpec[] => [
  {
    tag: 'html',
    box: [0, 0, 1000, 800],
    style: style(),
    children: [{ tag: 'body', box: [0, 0, 1000, 800], style: style(), children, ...body }],
  },
]

/** A mask whose differing pixels are exactly the given rects. */
function maskOf(rects: readonly Rect[], width = 1000, height = 800): DiffMask {
  const classes = new Uint8Array(width * height).fill(PIXEL_SAME)
  let differing = 0
  for (const [x, y, w, h] of rects) {
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        if (classes[j * width + i] === PIXEL_SAME) differing++
        classes[j * width + i] = PIXEL_DIFFERENT
      }
    }
  }
  return { width, height, classes, differing, sizeMismatch: null }
}

function explain(
  before: SnapshotV1,
  after: SnapshotV1,
  diff: readonly Rect[]
): { explanation: Explanation; regions: readonly Region[] } {
  const mask = maskOf(diff)
  const { regions, massChange } = diffRegions(mask)
  const rects: Rect[] = regions.map((r) => [r.x, r.y, r.width, r.height])
  const matching = matchSnapshots(before, after, { regions: rects, massChange })
  const deltas = computeDeltas(before, after, matching, { regions: rects })
  return {
    explanation: explainChanges(before, after, matching, deltas, { regions, mask }),
    regions,
  }
}

const build = (specs: TreeSpec[]): SnapshotV1 => buildSnapshot(specs, { props: PROPS })
const run = (before: TreeSpec[], after: TreeSpec[], diff: readonly Rect[]): Explanation =>
  explain(build(before), build(after), diff).explanation
const summary = (explanation: Explanation): string[] =>
  explanation.causes.map((c) => {
    const node =
      'before' in c.node
        ? `b${String(c.node.before)}`
        : 'added' in c.node
          ? `a${String(c.node.added)}`
          : `r${String(c.node.removed)}`
    const effects = c.effects
      .map((e) => `${e.kind}[${e.nodes.join(',')}]${e.vector ? `(${e.vector.join(',')})` : ''}`)
      .join(' ')
    return `${node} ${c.kind}${c.multiCause ? '*' : ''} ${effects}`.trim()
  })

describe('explainChanges: shift groups', () => {
  it('blames a parent whose padding pushed every child', () => {
    const before = page([
      {
        tag: 'section',
        box: [0, 0, 400, 200],
        style: style(),
        children: [
          { tag: 'p', box: [0, 0, 400, 20], style: style() },
          { tag: 'p', box: [0, 20, 400, 20], style: style() },
        ],
      },
    ])
    const after = page([
      {
        tag: 'section',
        box: [0, 0, 400, 200],
        style: style({ 'padding-top': '16px' }),
        children: [
          { tag: 'p', box: [0, 16, 400, 20], style: style() },
          { tag: 'p', box: [0, 36, 400, 20], style: style() },
        ],
      },
    ])
    expect(summary(run(before, after, [[0, 0, 400, 60]]))).toEqual([
      'b2 container shifted[3,4](0,16)',
    ])
  })

  it('blames a parent whose padding in em grew with its font-size and pushed every child', () => {
    const card = (size: string, padding: string, y: number): SnapshotV1 =>
      buildSnapshot(
        page([
          {
            tag: 'section',
            box: [0, 0, 400, 200],
            style: style({ 'font-size': size, 'padding-top': padding }),
            a: 1,
            children: [
              { tag: 'p', box: [0, y, 400, 20], style: style() },
              { tag: 'p', box: [0, y + 20, 400, 20], style: style() },
            ],
          },
        ]),
        {
          props: PROPS,
          sheets: [{ href: 'http://app.test/app.css', hash: 'app1' }],
          rules: [{ sheet: 0, selector: '.ui-card' }],
          attributions: [
            PROPS.map(() => -1),
            PROPS.map((p) => (p === 'font-size' || p === 'padding-top' ? 0 : -1)),
          ],
        }
      )
    const { explanation } = explain(card('16px', '16px', 16), card('24px', '24px', 24), [
      [0, 0, 400, 70],
    ])
    expect(summary(explanation)).toEqual(['b2 container shifted[3,4](0,8)'])
  })

  it('blames the upstream sibling whose end edge moved by the vector, in block flow and in rtl rows', () => {
    const column = run(
      page([
        { tag: 'h1', box: [0, 0, 400, 30], text: 'Title', style: style() },
        { tag: 'p', box: [0, 30, 400, 20], style: style() },
        { tag: 'p', box: [0, 50, 400, 20], style: style() },
      ]),
      page([
        { tag: 'h1', box: [0, 0, 400, 50], text: 'Title', style: style({ 'font-size': '32px' }) },
        { tag: 'p', box: [0, 50, 400, 20], style: style() },
        { tag: 'p', box: [0, 70, 400, 20], style: style() },
      ]),
      [[0, 0, 400, 90]]
    )
    expect(summary(column)).toEqual(['b2 own shifted[3,4](0,20)'])
    const rtl = run(
      page([
        {
          tag: 'nav',
          box: [0, 0, 400, 20],
          style: style({ display: 'flex', direction: 'rtl' }),
          children: [
            { tag: 'a', box: [360, 0, 40, 20], text: 'Home', style: style() },
            { tag: 'a', box: [300, 0, 60, 20], text: 'Docs', style: style() },
          ],
        },
      ]),
      page([
        {
          tag: 'nav',
          box: [0, 0, 400, 20],
          style: style({ display: 'flex', direction: 'rtl' }),
          children: [
            {
              tag: 'a',
              box: [340, 0, 60, 20],
              text: 'Home',
              style: style({ 'font-size': '20px' }),
            },
            { tag: 'a', box: [280, 0, 60, 20], text: 'Docs', style: style() },
          ],
        },
      ]),
      [[280, 0, 120, 20]]
    )
    expect(summary(rtl)).toEqual(['b3 own shifted[4](-20,0)'])
  })

  it('blames an inserted sibling for the push and a removed one for the pull', () => {
    const list = (items: string[], from = 0): TreeSpec[] =>
      page([
        {
          tag: 'ul',
          box: [0, 0, 200, 200],
          style: style(),
          children: items.map((text, i) => ({
            tag: 'li',
            box: [0, from + i * 20, 200, 20],
            text,
            style: style(),
          })),
        },
      ])
    const inserted = run(
      list(['alpha', 'beta']),
      page([
        {
          tag: 'ul',
          box: [0, 0, 200, 200],
          style: style(),
          children: [
            { tag: 'li', box: [0, 0, 200, 20], text: 'alpha', style: style() },
            { tag: 'li', box: [0, 20, 200, 20], text: 'new row', style: style() },
            { tag: 'li', box: [0, 40, 200, 20], text: 'beta', style: style() },
          ],
        },
      ]),
      [[0, 20, 200, 40]]
    )
    expect(summary(inserted)).toEqual(['a4 added shifted[4](0,20)'])
    const removed = run(
      page([
        {
          tag: 'ul',
          box: [0, 0, 200, 200],
          style: style(),
          children: [
            { tag: 'li', box: [0, 0, 200, 20], text: 'alpha', style: style() },
            { tag: 'li', box: [0, 20, 200, 20], text: 'gone', style: style() },
            { tag: 'li', box: [0, 40, 200, 20], text: 'beta', style: style() },
          ],
        },
      ]),
      list(['alpha', 'beta']),
      [[0, 20, 200, 40]]
    )
    expect(summary(removed)).toEqual(['r4 removed shifted[5](0,-20)'])
  })

  it('treats a centered flex row as one reflowed unit with every changed child as a candidate', () => {
    const before = page([
      {
        tag: 'div',
        box: [0, 0, 600, 40],
        style: style({ display: 'flex', 'justify-content': 'center' }),
        children: [
          { tag: 'a', box: [200, 0, 100, 40], text: 'One', style: style() },
          { tag: 'a', box: [300, 0, 100, 40], text: 'Two', style: style() },
        ],
      },
    ])
    const one = page([
      {
        tag: 'div',
        box: [0, 0, 600, 40],
        style: style({ display: 'flex', 'justify-content': 'center' }),
        children: [
          { tag: 'a', box: [180, 0, 140, 40], text: 'One', style: style({ 'font-size': '24px' }) },
          { tag: 'a', box: [320, 0, 100, 40], text: 'Two', style: style() },
        ],
      },
    ])
    expect(summary(run(before, one, [[180, 0, 240, 40]]))).toEqual(['b3 own reflowed[4]'])
    const two = page([
      {
        tag: 'div',
        box: [0, 0, 600, 40],
        style: style({ display: 'flex', 'justify-content': 'center' }),
        children: [
          { tag: 'a', box: [160, 0, 140, 40], text: 'One', style: style({ 'font-size': '24px' }) },
          { tag: 'a', box: [300, 0, 140, 40], text: 'Two', style: style({ 'font-size': '24px' }) },
        ],
      },
    ])
    const both = run(before, two, [[160, 0, 280, 40]])
    expect(both.causes.map((c) => c.kind)).toEqual(['own', 'own'])
    expect(both.unexplained).toEqual([])
  })

  it('finds a collapsed margin and a centered resize', () => {
    const margin = run(
      page([
        {
          tag: 'section',
          box: [0, 0, 400, 100],
          style: style(),
          children: [{ tag: 'p', box: [0, 0, 400, 20], style: style() }],
        },
        { tag: 'footer', box: [0, 100, 400, 20], style: style() },
      ]),
      page([
        {
          tag: 'section',
          box: [0, 0, 400, 116],
          style: style(),
          children: [{ tag: 'p', box: [0, 0, 400, 20], style: style({ 'margin-bottom': '16px' }) }],
        },
        { tag: 'footer', box: [0, 116, 400, 20], style: style() },
      ]),
      [[0, 100, 400, 36]]
    )
    expect(summary(margin)).toEqual(['b3 own shifted[4](0,16) resized[2]'])
    const centered = run(
      page([{ tag: 'div', box: [100, 0, 200, 50], style: style() }]),
      page([{ tag: 'div', box: [80, 0, 240, 50], style: style() }]),
      [[80, 0, 240, 50]]
    )
    expect(summary(centered)).toEqual(['b2 resized'])
  })

  it('attaches children of a scrolled container to it and resolves a size chain to the node that changed', () => {
    const scrolled = run(
      page([
        {
          tag: 'ul',
          box: [0, 0, 200, 100],
          scroll: [0, 0, 200, 300],
          style: style(),
          children: [{ tag: 'li', box: [0, 0, 200, 50], style: style() }],
        },
      ]),
      page([
        {
          tag: 'ul',
          box: [0, 0, 200, 100],
          scroll: [0, 30, 200, 300],
          style: style(),
          children: [{ tag: 'li', box: [0, -30, 200, 50], style: style() }],
        },
      ]),
      [[0, 0, 200, 100]]
    )
    expect(summary(scrolled)).toEqual(['b2 scrolled shifted[3](0,-30)'])
    const chain = run(
      page([
        {
          tag: 'section',
          box: [0, 0, 400, 60],
          style: style(),
          children: [
            {
              tag: 'div',
              box: [0, 0, 400, 60],
              style: style(),
              children: [{ tag: 'p', box: [0, 0, 400, 60], text: 'Deep', style: style() }],
            },
          ],
        },
        { tag: 'footer', box: [0, 60, 400, 20], style: style() },
      ]),
      page([
        {
          tag: 'section',
          box: [0, 0, 400, 90],
          style: style(),
          children: [
            {
              tag: 'div',
              box: [0, 0, 400, 90],
              style: style(),
              children: [
                {
                  tag: 'p',
                  box: [0, 0, 400, 90],
                  text: 'Deep',
                  style: style({ 'font-size': '24px' }),
                },
              ],
            },
          ],
        },
        { tag: 'footer', box: [0, 90, 400, 20], style: style() },
      ]),
      [[0, 0, 400, 110]]
    )
    expect(summary(chain)).toEqual(['b4 own shifted[5](0,30) resized[2,3]'])
  })

  it('lists what it cannot explain with the nearest changed candidates', () => {
    const result = run(
      page([
        { tag: 'div', box: [0, 0, 400, 20], style: style({ color: 'rgb(9, 9, 9)' }) },
        { tag: 'p', box: [0, 100, 400, 20], style: style() },
      ]),
      page([
        { tag: 'div', box: [0, 0, 400, 20], style: style() },
        { tag: 'p', box: [0, 130, 400, 20], style: style() },
      ]),
      [[0, 100, 400, 50]]
    )
    expect(result.unexplained).toEqual([
      { parent: 1, vector: [0, 30], nodes: [3], candidates: [2] },
    ])
  })
})

describe('explainChanges: containers grown by their children', () => {
  const grown = (box: Rect, children: [Rect, Rect][]): Explanation =>
    run(
      page([
        {
          tag: 'div',
          box: [0, 0, 400, 50],
          style: style(),
          children: children.map(([from]) => ({ tag: 'span', box: from, style: style() })),
        },
      ]),
      page([
        {
          tag: 'div',
          box,
          style: style(),
          children: children.map(([, to]) => ({
            tag: 'span',
            box: to,
            style: style({ 'padding-top': '2px' }),
          })),
        },
      ]),
      [[0, 0, 400, 70]]
    )

  it('makes a container with no change of its own a consequence of the child it grew with', () => {
    const one = grown(
      [0, 0, 400, 51],
      [
        [
          [0, 10, 400, 30],
          [0, 10, 400, 32],
        ],
      ]
    )
    expect(summary(one)).toEqual(['b3 own resized[2]'])
  })

  it('takes the child that grew most, the first on a tie, when children on two lines grew more than the container', () => {
    const lines = grown(
      [0, 0, 400, 53],
      [
        [
          [0, 3, 85, 19],
          [0, 4, 85, 21],
        ],
        [
          [85, 3, 85, 19],
          [85, 4, 85, 21],
        ],
        [
          [42, 24, 85, 26],
          [42, 27, 85, 28],
        ],
      ]
    )
    expect(summary(lines)).toEqual(['b3 own resized[2]', 'b4 own', 'b5 own'])
  })

  it('keeps a container that grew by more than its children as a cause of its own', () => {
    const more = grown(
      [0, 0, 400, 60],
      [
        [
          [0, 10, 400, 30],
          [0, 10, 400, 32],
        ],
      ]
    )
    expect(summary(more)).toEqual(['b2 resized', 'b3 own'])
  })
})

describe('explainChanges: paint, regions and counts', () => {
  it('finds the stacking change behind two unchanged nodes that overlap in a new order', () => {
    const before = page([
      {
        tag: 'div',
        box: [0, 100, 400, 60],
        style: style({ position: 'sticky', 'z-index': 'auto' }),
        layer: 5,
        text: 'Action bar',
      },
      {
        tag: 'div',
        box: [0, 80, 400, 100],
        style: style({ contain: 'layout' }),
        stacking: true,
        layer: 2,
        children: [
          {
            tag: 'label',
            box: [10, 110, 60, 20],
            style: style({ position: 'absolute', 'z-index': '1' }),
            layer: 3,
            text: 'Email',
          },
        ],
      },
    ])
    const after = page([
      {
        tag: 'div',
        box: [0, 100, 400, 60],
        style: style({ position: 'sticky', 'z-index': 'auto' }),
        layer: 2,
        text: 'Action bar',
      },
      {
        tag: 'div',
        box: [0, 80, 400, 100],
        style: style({ contain: 'none' }),
        layer: 3,
        children: [
          {
            tag: 'label',
            box: [10, 110, 60, 20],
            style: style({ position: 'absolute', 'z-index': '1' }),
            layer: 5,
            text: 'Email',
          },
        ],
      },
    ])
    const result = run(before, after, [[10, 110, 60, 20]])
    expect(summary(result)).toEqual(['b3 paint-order painted[2,4]'])
    expect(result.regions[0]?.causes).toEqual([0])
  })

  it('ignores nodes without area as candidates and as added or removed causes', () => {
    const before = page([
      {
        tag: 'div',
        box: [0, 0, 100, 40],
        style: style(),
        children: [{ tag: 'i', box: [0, 20, 0, 0], style: style() }],
      },
    ])
    const after = page([
      {
        tag: 'div',
        box: [0, 0, 100, 40],
        style: style({ color: 'rgb(9, 9, 9)' }),
        children: [
          { tag: 'i', box: [0, 20, 100, 0], style: style() },
          { tag: 'u', box: [50, 20, 0, 0], style: style() },
        ],
      },
    ])
    const result = run(before, after, [[0, 0, 100, 40]])
    expect(summary(result)).toEqual(['b2 own'])
    expect(result.regions[0]?.candidates.map((c) => c.before)).toEqual([2, 1, 0])
  })

  it('finds a paint-order flip even when the overlapping nodes moved with the page', () => {
    const before = page([
      {
        tag: 'div',
        box: [0, 100, 400, 60],
        style: style({ position: 'sticky' }),
        layer: 5,
        text: 'Action bar',
      },
      {
        tag: 'div',
        box: [0, 80, 400, 100],
        style: style({ contain: 'layout' }),
        stacking: true,
        layer: 2,
        children: [
          {
            tag: 'label',
            box: [10, 110, 60, 20],
            style: style({ position: 'absolute', 'z-index': '1' }),
            layer: 3,
            text: 'Email',
          },
        ],
      },
    ])
    const after = page([
      {
        tag: 'div',
        box: [0, 160, 400, 60],
        style: style({ position: 'sticky' }),
        layer: 2,
        text: 'Action bar',
      },
      {
        tag: 'div',
        box: [0, 140, 400, 100],
        style: style({ contain: 'none' }),
        layer: 3,
        children: [
          {
            tag: 'label',
            box: [10, 170, 60, 20],
            style: style({ position: 'absolute', 'z-index': '1' }),
            layer: 5,
            text: 'Email',
          },
        ],
      },
    ])
    const result = run(before, after, [[10, 170, 60, 20]])
    const flip = result.causes.find((c) => c.kind === 'paint-order')
    expect(flip?.node).toEqual({ before: 3, after: 3 })
    expect(flip?.effects).toContainEqual({ kind: 'painted', nodes: [2, 4] })
  })

  it('ranks region candidates by the share of differing pixels inside their box', () => {
    const before = page([
      {
        tag: 'div',
        box: [0, 0, 400, 100],
        style: style(),
        children: [
          { tag: 'b', box: [0, 0, 40, 40], text: 'x', style: style() },
          { tag: 'i', box: [200, 0, 200, 100], text: 'y', style: style() },
        ],
      },
    ])
    const after = page([
      {
        tag: 'div',
        box: [0, 0, 400, 100],
        style: style(),
        children: [
          { tag: 'b', box: [0, 0, 40, 40], text: 'x', style: style({ color: 'rgb(9, 9, 9)' }) },
          { tag: 'i', box: [200, 0, 200, 100], text: 'y', style: style() },
        ],
      },
    ])
    const { regions } = run(before, after, [[0, 0, 40, 40]])
    expect(regions[0]?.candidates.map((c) => [c.before, c.share])).toEqual([
      [3, 1000],
      [2, 40],
      [1, 2],
    ])
    expect(regions[0]?.causes).toEqual([0])
  })

  it('counts suppressed noise and attaches painted descendants to their ancestor', () => {
    const before = page([
      {
        tag: 'div',
        box: [0, 0, 200, 100],
        style: style(),
        children: [
          { tag: 'p', box: [0, 0, 200, 20], style: style() },
          { tag: 'p', box: [0, 20, 200, 20], style: style({ color: 'rgb(1, 1, 1)' }) },
        ],
      },
      {
        tag: 'aside',
        box: [0, 200, 200, 50],
        style: style(),
        children: [{ tag: 'span', box: [0, 200, 50, 20], style: style() }],
      },
    ])
    const after = page([
      {
        tag: 'div',
        box: [0, 0, 200, 100],
        style: style({ opacity: '0.5' }),
        children: [
          { tag: 'p', box: [0, 0, 200, 20], style: style() },
          { tag: 'p', box: [0, 20, 200, 20], style: style({ color: 'rgb(1, 1, 1)' }) },
        ],
      },
      {
        tag: 'aside',
        box: [0, 300, 200, 50],
        style: style(),
        children: [{ tag: 'span', box: [0, 300, 50, 20], style: style() }],
      },
    ])
    const result = run(before, after, [[0, 0, 200, 100]])
    expect(summary(result)).toEqual(['b2 own painted[3,4]'])
    expect(result.suppressed).toEqual({ movedWithAncestor: 1, inherited: 0, derivedOnly: 0 })
    expect(result.unexplained).toHaveLength(1)
  })

  it('explains a region with the box an effect node has after the change', () => {
    const result = run(
      page([
        { tag: 'h1', box: [0, 0, 400, 30], text: 'Title', style: style() },
        { tag: 'p', box: [0, 30, 400, 20], style: style() },
        { tag: 'p', box: [0, 50, 400, 20], style: style() },
      ]),
      page([
        { tag: 'h1', box: [0, 0, 400, 50], text: 'Title', style: style({ 'font-size': '32px' }) },
        { tag: 'p', box: [0, 50, 400, 20], style: style() },
        { tag: 'p', box: [0, 70, 400, 20], style: style() },
      ]),
      [[0, 72, 400, 16]]
    )
    expect(summary(result)).toEqual(['b2 own shifted[3,4](0,20)'])
    expect(result.regions[0]?.causes).toEqual([0])
  })

  it('explains a region with the effects of an inserted or removed sibling', () => {
    const rows = (texts: string[]): TreeSpec[] =>
      page([
        {
          tag: 'ul',
          box: [0, 0, 200, 200],
          style: style(),
          children: texts.map((text, i) => ({
            tag: 'li',
            box: [0, i * 20, 200, 20],
            text,
            style: style(),
          })),
        },
      ])
    const inserted = run(rows(['alpha', 'beta']), rows(['alpha', 'new row', 'beta']), [
      [0, 44, 200, 12],
    ])
    expect(summary(inserted)).toEqual(['a4 added shifted[4](0,20)'])
    expect(inserted.regions[0]?.causes).toEqual([0])
    const removed = run(rows(['alpha', 'gone', 'beta']), rows(['alpha', 'beta']), [
      [0, 44, 200, 12],
    ])
    expect(summary(removed)).toEqual(['r4 removed shifted[5](0,-20)'])
    expect(removed.regions[0]?.causes).toEqual([0])
  })
})

describe('explainChanges: resize corners', () => {
  const FIELD = [
    'display',
    'direction',
    'font-size',
    'color',
    'opacity',
    'padding-top',
    'padding-bottom',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
  ]
  const VALUES: Record<string, string> = {
    display: 'block',
    direction: 'ltr',
    'font-size': '13px',
    color: 'rgb(0, 0, 0)',
    opacity: '1',
    'padding-top': '2px',
    'padding-bottom': '2px',
    'border-right-width': '1px',
    'border-bottom-width': '1px',
    'border-left-width': '1px',
  }
  const row = (props: readonly string[], values: Record<string, string> = {}): string[] =>
    props.map((p) => values[p] ?? VALUES[p] ?? '')
  /** A form with one field at [16, 44, 320, 96]; its resizer square is [320, 124, 15, 15], or [17, 124, 15, 15] in rtl. */
  const field = (
    props: readonly string[],
    values: Record<string, string> = {},
    tag = 'textarea',
    box: Rect = [16, 44, 320, 96],
    extra: Pick<TreeSpec, 'text' | 'scroll'> = {}
  ): SnapshotV1 =>
    buildSnapshot(
      [
        {
          tag: 'form',
          box: [0, 0, 1000, 800],
          style: row(props),
          children: [{ tag, cls: ['ui-field'], box, style: row(props, values), ...extra }],
        },
      ],
      { props }
    )
  const TEXT: Rect = [20, 48, 76, 12]
  const GRIP: Rect = [326, 130, 7, 7]
  const regionsOf = (
    before: SnapshotV1,
    after: SnapshotV1,
    diff: readonly Rect[]
  ): Explanation['regions'] => explain(before, after, diff).explanation.regions

  it('refuses a text or spacing change of a textarea inside its resize corner and names the corner', () => {
    const regions = regionsOf(field(FIELD), field(FIELD, { 'font-size': '15px' }), [TEXT, GRIP])
    expect(regions.map((r) => r.causes)).toEqual([[0], []])
    expect(regions[0]).not.toHaveProperty('corner')
    expect(regions[1]?.corner).toBe(1)
    const spacing = regionsOf(
      field(FIELD),
      field(FIELD, { 'padding-bottom': '6px', color: 'rgb(9, 9, 9)' }),
      [GRIP]
    )
    expect(spacing.map((r) => [r.causes, r.corner])).toEqual([[[], 1]])
  })

  it('still counts a moved box, other properties, and a text or scroll change of the textarea', () => {
    const text = { 'font-size': '15px' }
    const moved = regionsOf(field(FIELD), field(FIELD, text, 'textarea', [16, 48, 320, 96]), [GRIP])
    expect(moved[0]?.causes).toEqual([0])
    const resized = regionsOf(field(FIELD), field(FIELD, text, 'textarea', [16, 44, 320, 100]), [
      GRIP,
    ])
    expect(resized[0]?.causes).toEqual([0])
    const shown = regionsOf(
      field(FIELD, { opacity: '0' }),
      field(FIELD, { ...text, opacity: '1' }),
      [GRIP]
    )
    expect(shown[0]?.causes).toEqual([0])
    const typed = regionsOf(
      field(FIELD, {}, 'textarea', [16, 44, 320, 96], { text: 'A short note' }),
      field(FIELD, text, 'textarea', [16, 44, 320, 96], { text: 'A longer note ending here' }),
      [GRIP]
    )
    expect(typed[0]?.causes).toEqual([0])
    const scrolled = regionsOf(
      field(FIELD, {}, 'textarea', [16, 44, 320, 96], { scroll: [0, 0, 320, 400] }),
      field(FIELD, text, 'textarea', [16, 44, 320, 96], { scroll: [0, 40, 320, 400] }),
      [GRIP]
    )
    expect(scrolled[0]?.causes).toEqual([0])
  })

  it('puts the corner inside the border, grown by 1 px, at the bottom right or in rtl the bottom left', () => {
    const thick = {
      'border-right-width': '4px',
      'border-bottom-width': '4px',
      'border-left-width': '4px',
    }
    const corners = (direction: string): unknown[] =>
      regionsOf(
        field(FIELD, { ...thick, direction }),
        field(FIELD, { ...thick, direction, 'font-size': '15px' }),
        [
          [316, 120, 7, 7],
          [29, 130, 7, 7],
        ]
      ).map((r) => [r.region.x, r.causes, r.corner])
    expect(corners('ltr')).toEqual([
      [316, [], 1],
      [29, [0], undefined],
    ])
    expect(corners('rtl')).toEqual([
      [316, [0], undefined],
      [29, [], 1],
    ])
    const flipped = regionsOf(
      field(FIELD, thick),
      field(FIELD, { ...thick, direction: 'rtl', 'font-size': '15px' }),
      [[29, 130, 7, 7]]
    )
    expect(flipped.map((r) => [r.causes, r.corner])).toEqual([[[], 1]])
  })

  it('gives a resize corner to textareas only', () => {
    const causesOf = (tag: string) =>
      regionsOf(field(FIELD, {}, tag), field(FIELD, { 'font-size': '15px' }, tag), [GRIP])[0]
        ?.causes
    expect(causesOf('textarea')).toEqual([])
    expect(causesOf('div')).toEqual([0])
  })

  it('refuses an inherited effect on the corner element but counts other nodes', () => {
    const black = { color: 'rgb(0, 0, 0)' }
    const grey = { color: 'rgb(9, 9, 9)' }
    const tree = (wrapper: Record<string, string>, badge: Record<string, string>): SnapshotV1 =>
      buildSnapshot(
        [
          {
            tag: 'div',
            box: [16, 44, 320, 20],
            style: row(FIELD, wrapper),
            children: [
              { tag: 'textarea', box: [16, 44, 320, 96], style: row(FIELD, wrapper) },
              { tag: 'span', box: [300, 120, 40, 20], style: row(FIELD, badge) },
            ],
          },
        ],
        { props: FIELD }
      )
    const inherited = regionsOf(tree(black, black), tree(grey, black), [GRIP])
    expect(inherited.map((r) => [r.causes, r.corner])).toEqual([[[], 1]])
    const badge = regionsOf(tree(black, black), tree(black, grey), [GRIP])
    expect(badge.map((r) => r.causes)).toEqual([[0]])
  })
})

describe('explainChanges: golden cases', () => {
  const cases: Record<string, [TreeSpec[], TreeSpec[], Rect[]]> = {
    'typography-cascade': [
      page([
        {
          tag: 'main',
          box: [0, 0, 600, 100],
          style: style(),
          children: [
            {
              tag: 'p',
              box: [0, 0, 600, 40],
              text: 'Body',
              style: style(),
              children: [{ tag: 'em', box: [0, 0, 60, 40], text: 'Body', style: style() }],
            },
          ],
        },
        { tag: 'footer', box: [0, 100, 600, 30], style: style() },
      ]),
      page([
        {
          tag: 'main',
          box: [0, 0, 600, 120],
          style: style({ 'font-size': '20px' }),
          children: [
            {
              tag: 'p',
              box: [0, 0, 600, 60],
              text: 'Body',
              style: style({ 'font-size': '20px' }),
              children: [
                {
                  tag: 'em',
                  box: [0, 0, 60, 60],
                  text: 'Body',
                  style: style({ 'font-size': '20px' }),
                },
              ],
            },
          ],
        },
        { tag: 'footer', box: [0, 120, 600, 30], style: style() },
      ]),
      [[0, 0, 600, 150]],
    ],
    'container-padding': [
      page([
        {
          tag: 'section',
          box: [0, 0, 400, 200],
          style: style(),
          children: [
            { tag: 'p', box: [0, 0, 400, 20], style: style() },
            { tag: 'p', box: [0, 20, 400, 20], style: style() },
          ],
        },
      ]),
      page([
        {
          tag: 'section',
          box: [0, 0, 400, 200],
          style: style({ 'padding-top': '16px', 'padding-left': '8px' }),
          children: [
            { tag: 'p', box: [8, 16, 392, 20], style: style() },
            { tag: 'p', box: [8, 36, 392, 20], style: style() },
          ],
        },
      ]),
      [[0, 0, 400, 60]],
    ],
    'flex-centered-reflow': [
      page([
        {
          tag: 'div',
          box: [0, 0, 600, 40],
          style: style({ display: 'flex', 'justify-content': 'center' }),
          children: [
            { tag: 'a', box: [200, 0, 100, 40], text: 'One', style: style() },
            { tag: 'a', box: [300, 0, 100, 40], text: 'Two', style: style() },
          ],
        },
      ]),
      page([
        {
          tag: 'div',
          box: [0, 0, 600, 40],
          style: style({ display: 'flex', 'justify-content': 'center' }),
          children: [
            {
              tag: 'a',
              box: [180, 0, 140, 40],
              text: 'One',
              style: style({ 'font-size': '24px' }),
            },
            { tag: 'a', box: [320, 0, 100, 40], text: 'Two', style: style() },
          ],
        },
      ]),
      [[180, 0, 240, 40]],
    ],
    'inserted-row': [
      page([
        {
          tag: 'table',
          box: [0, 0, 400, 60],
          style: style(),
          children: [
            { tag: 'tr', box: [0, 0, 400, 20], text: 'alpha', style: style() },
            { tag: 'tr', box: [0, 20, 400, 20], text: 'beta', style: style() },
            { tag: 'tr', box: [0, 40, 400, 20], text: 'gamma', style: style() },
          ],
        },
      ]),
      page([
        {
          tag: 'table',
          box: [0, 0, 400, 80],
          style: style(),
          children: [
            { tag: 'tr', box: [0, 0, 400, 20], text: 'alpha', style: style() },
            { tag: 'tr', box: [0, 20, 400, 20], text: 'new row', style: style() },
            { tag: 'tr', box: [0, 40, 400, 20], text: 'beta', style: style() },
            { tag: 'tr', box: [0, 60, 400, 20], text: 'gamma', style: style() },
          ],
        },
      ]),
      [[0, 20, 400, 60]],
    ],
    'paint-order-flip': [
      page([
        {
          tag: 'div',
          box: [0, 100, 400, 60],
          style: style({ position: 'sticky' }),
          layer: 5,
          text: 'Bar',
        },
        {
          tag: 'div',
          box: [0, 80, 400, 100],
          style: style({ contain: 'layout' }),
          stacking: true,
          layer: 2,
          children: [
            {
              tag: 'label',
              box: [10, 110, 60, 20],
              style: style({ position: 'absolute', 'z-index': '1' }),
              layer: 3,
              text: 'Email',
            },
          ],
        },
      ]),
      page([
        {
          tag: 'div',
          box: [0, 100, 400, 60],
          style: style({ position: 'sticky' }),
          layer: 2,
          text: 'Bar',
        },
        {
          tag: 'div',
          box: [0, 80, 400, 100],
          style: style(),
          layer: 3,
          children: [
            {
              tag: 'label',
              box: [10, 110, 60, 20],
              style: style({ position: 'absolute', 'z-index': '1' }),
              layer: 5,
              text: 'Email',
            },
          ],
        },
      ]),
      [[10, 110, 60, 20]],
    ],
    'faded-card': [
      page([
        {
          tag: 'article',
          box: [0, 0, 300, 120],
          style: style(),
          children: [
            { tag: 'h2', box: [0, 0, 300, 30], text: 'Card', style: style() },
            { tag: 'p', box: [0, 30, 300, 60], text: 'Text', style: style() },
          ],
        },
      ]),
      page([
        {
          tag: 'article',
          box: [0, 0, 300, 120],
          style: style({ opacity: '0.3' }),
          children: [
            { tag: 'h2', box: [0, 0, 300, 30], text: 'Card', style: style() },
            { tag: 'p', box: [0, 30, 300, 60], text: 'Text', style: style() },
          ],
        },
      ]),
      [[0, 0, 300, 120]],
    ],
  }

  it.each(Object.entries(cases))('%s', async (name, [specsB, specsA, diff]) => {
    const before = build(specsB)
    const after = build(specsA)
    await expect(serializeSnapshot(before)).toMatchFileSnapshot(
      `../../fixtures/causes/${name}/before.whydiff.json`
    )
    await expect(serializeSnapshot(after)).toMatchFileSnapshot(
      `../../fixtures/causes/${name}/after.whydiff.json`
    )
    const { explanation } = explain(before, after, diff)
    await expect(`${JSON.stringify(explanation, null, 2)}\n`).toMatchFileSnapshot(
      `../../fixtures/causes/${name}/explanation.json`
    )
  })
})
