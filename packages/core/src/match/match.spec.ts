import { serializeSnapshot } from '../snapshot/serialize.js'
import type { Rect, SnapshotV1 } from '../snapshot/types.js'
import { validateSnapshot } from '../snapshot/validate.js'
import { buildSnapshot, type TreeSpec } from '../testing/snapshots.js'
import { matchSnapshots } from './match.js'
import type { Matching } from './types.js'

const row = (y: number, text: string, extra: Partial<TreeSpec> = {}): TreeSpec => ({
  tag: 'tr',
  box: [0, y, 400, 20],
  text,
  cls: ['row'],
  ...extra,
})
const cell = (x: number, y: number, text: string): TreeSpec => ({
  tag: 'td',
  box: [x, y, 200, 20],
  text,
})
const record = (y: number, name: string, amount: string): TreeSpec => ({
  tag: 'tr',
  box: [0, y, 400, 20],
  cls: ['row'],
  children: [cell(0, y, name), cell(200, y, amount)],
})
const section = (y: number, heading: string, body: string): TreeSpec => ({
  tag: 'section',
  box: [0, y, 1000, 100],
  cls: ['faq'],
  children: [
    { tag: 'h2', text: heading, box: [0, y, 1000, 40] },
    { tag: 'p', text: body, box: [0, y + 40, 1000, 60] },
  ],
})
const entry = (y: number, title: string, version: string): TreeSpec => ({
  tag: 'li',
  box: [0, y, 600, 60],
  cls: ['entry'],
  children: [
    { tag: 'h3', text: title, box: [0, y, 600, 30] },
    { tag: 'span', text: version, box: [0, y + 30, 100, 30] },
  ],
})
const page = (children: readonly TreeSpec[]): TreeSpec[] => [
  {
    tag: 'html',
    box: [0, 0, 1000, 800],
    children: [{ tag: 'body', box: [0, 0, 1000, 800], children }],
  },
]
const match = (before: TreeSpec[], after: TreeSpec[], regions: Rect[] = []): Matching =>
  matchSnapshots(buildSnapshot(before), buildSnapshot(after), { regions })
const pairOf = (matching: Matching, before: number) =>
  matching.pairs.find((p) => p.before === before)

describe('pass 1: anchors', () => {
  it('pairs unique keys in order testId, role+name, id, tag+text', () => {
    const before = page([
      { tag: 'button', testId: 'save', box: [0, 0, 80, 30] },
      { tag: 'a', role: 'link', name: 'Docs', box: [0, 40, 80, 30] },
      { tag: 'div', id: 'hero', box: [0, 80, 80, 30] },
      { tag: 'p', text: 'Welcome back', box: [0, 120, 80, 30] },
      { tag: 'p', text: 'Hi', box: [0, 160, 80, 30] },
    ])
    const after = page([
      { tag: 'p', text: 'Hi', box: [0, 160, 80, 30] },
      { tag: 'p', text: 'Welcome back', box: [0, 120, 80, 30] },
      { tag: 'section', id: 'hero', box: [0, 80, 80, 30] },
      { tag: 'a', role: 'link', name: 'Docs', box: [0, 40, 80, 30] },
      { tag: 'button', testId: 'save', box: [0, 0, 80, 30] },
    ])
    const matching = match(before, after)
    expect(
      matching.pairs.filter((p) => p.pass === 1).map((p) => [p.before, p.after, p.anchor])
    ).toEqual([
      [2, 6, 'testId'],
      [3, 5, 'roleName'],
      [4, 4, 'id'],
      [5, 3, 'tagText'],
    ])
    expect(matching.afterOf[6]).toBe(-1)
    const withRegions = match(before, after, [[0, 0, 1000, 800]])
    expect(pairOf(withRegions, 6)).toMatchObject({ after: 2, pass: 3 })
  })

  it('ignores keys that occur twice on a side', () => {
    const before = page([
      { tag: 'li', id: 'x' },
      { tag: 'li', id: 'x' },
    ])
    const after = page([{ tag: 'li', id: 'x' }])
    expect(match(before, after).pairs.some((p) => p.anchor === 'id')).toBe(false)
  })

  it('vetoes a text anchor whose matched ancestors disagree', () => {
    const before = page([
      {
        tag: 'nav',
        id: 'nav',
        box: [0, 0, 1000, 40],
        children: [{ tag: 'span', text: 'Settings', box: [0, 0, 80, 40] }],
      },
      {
        tag: 'main',
        id: 'main',
        box: [0, 40, 1000, 700],
        children: [{ tag: 'h1', text: 'Page', box: [0, 40, 200, 40] }],
      },
    ])
    const after = page([
      {
        tag: 'nav',
        id: 'nav',
        box: [0, 0, 1000, 40],
        children: [{ tag: 'span', text: 'Preferences', box: [0, 0, 80, 40] }],
      },
      {
        tag: 'main',
        id: 'main',
        box: [0, 40, 1000, 700],
        children: [
          { tag: 'h1', text: 'Page', box: [0, 40, 200, 40] },
          { tag: 'span', text: 'Settings', box: [0, 90, 80, 40] },
        ],
      },
    ])
    const matching = match(before, after)
    expect(pairOf(matching, 3)?.anchor).toBeUndefined()
    expect(pairOf(matching, 3)?.pass).toBe(2)
  })
})

describe('pass 2: propagation', () => {
  it('survives a class rename through the loose tier and keeps strict pairs at 950', () => {
    const before = page([
      {
        tag: 'div',
        cls: ['ui-row'],
        box: [0, 0, 1000, 100],
        children: [{ tag: 'div', cls: ['ui-col-wide'], box: [0, 0, 1000, 100] }],
      },
      { tag: 'footer', cls: ['foot'], box: [0, 700, 1000, 100] },
    ])
    const after = page([
      {
        tag: 'div',
        cls: ['ui-row'],
        box: [0, 0, 1000, 100],
        children: [{ tag: 'div', cls: ['ui-col--wide'], box: [0, 0, 1000, 100] }],
      },
      { tag: 'footer', cls: ['foot'], box: [0, 700, 1000, 100] },
    ])
    const matching = match(before, after)
    expect(matching.pairs.map((p) => [p.before, p.after, p.confidence, p.pass])).toEqual([
      [0, 0, 950, 2],
      [1, 1, 950, 2],
      [2, 2, 950, 2],
      [3, 3, 850, 2],
      [4, 4, 950, 2],
    ])
  })

  it('pairs by position when a gap has equal counts and tags', () => {
    const before = page([
      { tag: 'span', cls: ['a'] },
      { tag: 'span', cls: ['b'] },
    ])
    const after = page([
      { tag: 'span', cls: ['c'], role: 'note' },
      { tag: 'span', cls: ['d'], role: 'note' },
    ])
    const matching = match(before, after)
    expect(
      matching.pairs.filter((p) => p.confidence === 800).map((p) => [p.before, p.after])
    ).toEqual([
      [2, 2],
      [3, 3],
    ])
  })

  it('looks through an inserted wrapper and reports it as absorbed', () => {
    const inner: TreeSpec = { tag: 'button', text: 'Go on', box: [10, 10, 80, 30] }
    const before = page([inner])
    const after = page([{ tag: 'div', cls: ['wrap'], box: [10, 10, 80, 30], children: [inner] }])
    const matching = match(before, after)
    expect(pairOf(matching, 2)).toMatchObject({ after: 3, anchor: 'tagText' })
    expect(matching.added).toEqual([{ node: 2, descendants: 0, absorbed: true }])
    const unanchored = match(
      page([{ tag: 'button', box: [10, 10, 80, 30] }]),
      page([
        {
          tag: 'div',
          cls: ['wrap'],
          box: [10, 10, 80, 30],
          children: [{ tag: 'button', box: [10, 10, 80, 30] }],
        },
      ])
    )
    expect(pairOf(unanchored, 2)).toMatchObject({ after: 3, confidence: 950 })
    expect(unanchored.added).toEqual([{ node: 2, descendants: 0, absorbed: true }])
  })

  it('pairs runs of identical rows in order and leaves the extra one added', () => {
    const before = page([{ tag: 'table', children: [row(0, 'a'), row(20, 'a'), row(40, 'a')] }])
    const after = page([
      { tag: 'table', children: [row(0, 'a'), row(20, 'a'), row(40, 'a'), row(60, 'a')] },
    ])
    const matching = match(before, after)
    expect(matching.pairs.map((p) => [p.before, p.after])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
    ])
    expect(matching.added).toEqual([{ node: 6, descendants: 0 }])
    expect(matching.pairs.some((p) => p.ambiguous)).toBe(false)
  })
})

describe('pass 3: similarity', () => {
  it('pairs a renamed node that moved to another parent near a diff region and leaves far nodes alone', () => {
    const before = page([
      {
        tag: 'div',
        cls: ['card'],
        box: [80, 80, 200, 100],
        children: [
          { tag: 'span', role: 'status', cls: ['badge'], text: 'Old', box: [100, 100, 40, 20] },
        ],
      },
      { tag: 'p', cls: ['far'], text: 'Elsewhere', box: [900, 700, 40, 20] },
    ])
    const after = page([
      { tag: 'div', cls: ['card'], box: [80, 80, 200, 100] },
      { tag: 'span', role: 'status', cls: ['chip'], text: 'New', box: [120, 100, 40, 20] },
    ])
    const matching = match(before, after, [[100, 100, 60, 20]])
    expect(pairOf(matching, 3)).toMatchObject({ after: 3, pass: 3, reparented: true })
    expect(matching.removed).toEqual([{ node: 4, descendants: 0 }])
  })

  it('flags a pair ambiguous only when the rival would change the deltas', () => {
    const before = page([
      {
        tag: 'div',
        cls: ['card'],
        box: [80, 80, 200, 100],
        children: [
          { tag: 'span', text: 'Price', box: [100, 100, 40, 20] },
          { tag: 'em', text: 'per month', box: [150, 100, 60, 20] },
        ],
      },
    ])
    const twins = page([
      { tag: 'span', text: 'Price', box: [100, 100, 40, 20], style: ['block'] },
      { tag: 'span', text: 'Price', box: [100, 100, 40, 20], style: ['block'] },
    ])
    const rivals = page([
      { tag: 'span', text: 'Price', box: [100, 100, 40, 20], style: ['block'] },
      { tag: 'span', text: 'Price', box: [100, 100, 40, 20], style: ['flex'] },
    ])
    const paired = pairOf(match(before, twins, [[100, 100, 40, 20]]), 3)
    expect(paired).toMatchObject({ pass: 3 })
    expect(paired?.ambiguous).toBeUndefined()
    expect(pairOf(match(before, rivals, [[100, 100, 40, 20]]), 3)?.ambiguous).toBe(true)
  })
})

describe('pass 4: residue', () => {
  it('collapses unmatched subtrees to their root with a descendant count', () => {
    const before = page([])
    const after = page([
      { tag: 'aside', children: [{ tag: 'ul', children: [{ tag: 'li' }, { tag: 'li' }] }] },
    ])
    expect(match(before, after).added).toEqual([{ node: 2, descendants: 3 }])
  })

  it('marks a node whose matched ancestors changed as reparented', () => {
    const dialog: TreeSpec = {
      tag: 'div',
      role: 'dialog',
      name: 'Confirm',
      box: [300, 300, 400, 200],
    }
    const before = page([
      { tag: 'main', id: 'main', children: [dialog] },
      { tag: 'div', id: 'portal' },
    ])
    const after = page([
      { tag: 'main', id: 'main' },
      { tag: 'div', id: 'portal', children: [dialog] },
    ])
    const matching = match(before, after)
    expect(pairOf(matching, 3)).toMatchObject({ after: 4, anchor: 'roleName', reparented: true })
  })
})

describe('golden cases', () => {
  const cases: Record<string, [TreeSpec[], TreeSpec[], Rect[]]> = {
    'bem-rename': [
      page([
        {
          tag: 'div',
          cls: ['ui-row', 'ui-row--tight'],
          children: [
            { tag: 'div', cls: ['ui-col-wide'], children: [{ tag: 'p', text: 'Body text' }] },
          ],
        },
      ]),
      page([
        {
          tag: 'div',
          cls: ['ui-row', 'ui-row--tight', 'ui-row--wrap'],
          children: [
            { tag: 'div', cls: ['ui-col--wide'], children: [{ tag: 'p', text: 'Body text' }] },
          ],
        },
      ]),
      [],
    ],
    'wrapper-insertion': [
      page([
        { tag: 'input', id: 'email', box: [0, 0, 200, 32] },
        { tag: 'button', text: 'Submit', box: [0, 40, 100, 32] },
      ]),
      page([
        { tag: 'input', id: 'email', box: [0, 0, 200, 32] },
        {
          tag: 'div',
          cls: ['field'],
          box: [0, 40, 100, 32],
          children: [{ tag: 'button', text: 'Submit', box: [0, 40, 100, 32] }],
        },
      ]),
      [],
    ],
    'reordered-list': [
      page([
        {
          tag: 'ul',
          children: [
            { tag: 'li', text: 'Alpha', box: [0, 0, 100, 20] },
            { tag: 'li', text: 'Beta', box: [0, 20, 100, 20] },
            { tag: 'li', text: 'Gamma', box: [0, 40, 100, 20] },
          ],
        },
      ]),
      page([
        {
          tag: 'ul',
          children: [
            { tag: 'li', text: 'Gamma', box: [0, 0, 100, 20] },
            { tag: 'li', text: 'Alpha', box: [0, 20, 100, 20] },
            { tag: 'li', text: 'Beta', box: [0, 40, 100, 20] },
          ],
        },
      ]),
      [[0, 0, 100, 60]],
    ],
    'table-rows-added': [
      page([{ tag: 'table', children: [row(0, 'cell'), row(20, 'cell'), row(40, 'cell')] }]),
      page([
        {
          tag: 'table',
          children: [row(0, 'cell'), row(20, 'cell'), row(40, 'cell'), row(60, 'cell')],
        },
      ]),
      [[0, 60, 400, 20]],
    ],
    'portal-move': [
      page([
        {
          tag: 'main',
          id: 'main',
          children: [
            {
              tag: 'div',
              role: 'dialog',
              name: 'Confirm',
              box: [300, 300, 400, 200],
              children: [{ tag: 'button', text: 'OK', box: [600, 460, 60, 30] }],
            },
          ],
        },
        { tag: 'div', id: 'portal' },
      ]),
      page([
        { tag: 'main', id: 'main' },
        {
          tag: 'div',
          id: 'portal',
          children: [
            {
              tag: 'div',
              role: 'dialog',
              name: 'Confirm',
              box: [300, 300, 400, 200],
              children: [{ tag: 'button', text: 'OK', box: [600, 460, 60, 30] }],
            },
          ],
        },
      ]),
      [],
    ],
    'table-row-removed-and-moved': [
      page([
        {
          tag: 'table',
          box: [0, 0, 400, 100],
          children: [
            record(0, 'Alice', '$120.00'),
            record(20, 'Bob', '$250.00'),
            record(40, 'Carol', '$300.00'),
            record(60, 'Dave', '$450.00'),
            record(80, 'Erin', '$510.00'),
          ],
        },
      ]),
      page([
        {
          tag: 'table',
          box: [0, 0, 400, 80],
          children: [
            record(0, 'Dave', '$450.00'),
            record(20, 'Alice', '$120.00'),
            record(40, 'Bob', '$250.00'),
            record(60, 'Erin', '$510.00'),
          ],
        },
      ]),
      [[0, 0, 400, 100]],
    ],
    'reversed-sections': [
      page([
        {
          tag: 'main',
          box: [0, 0, 1000, 300],
          children: [
            section(0, 'Shipping', 'Orders ship within two days.'),
            section(100, 'Returns', 'Thirty days, no questions asked.'),
            section(200, 'Support', 'Chat with us at any time.'),
          ],
        },
      ]),
      page([
        {
          tag: 'main',
          box: [0, 0, 1000, 300],
          children: [
            section(0, 'Support', 'Chat with us at any time.'),
            section(100, 'Returns', 'Thirty days, no questions asked.'),
            section(200, 'Shipping', 'Orders ship within two days.'),
          ],
        },
      ]),
      [[0, 0, 1000, 300]],
    ],
    'cloned-entry': [
      page([
        {
          tag: 'ul',
          box: [0, 0, 600, 120],
          cls: ['changelog'],
          children: [entry(0, 'Release', 'v2'), entry(60, 'Hotfix', 'v1')],
        },
      ]),
      page([
        {
          tag: 'ul',
          box: [0, 0, 600, 180],
          cls: ['changelog'],
          children: [
            entry(0, 'Release', 'v3'),
            entry(60, 'Release', 'v2'),
            entry(120, 'Hotfix', 'v1'),
          ],
        },
      ]),
      [[0, 0, 600, 180]],
    ],
  }

  it.each(Object.entries(cases))('%s', async (name, [before, after, regions]) => {
    const a: SnapshotV1 = validateSnapshot(buildSnapshot(before))
    const b: SnapshotV1 = validateSnapshot(buildSnapshot(after))
    await expect(serializeSnapshot(a)).toMatchFileSnapshot(
      `../../fixtures/match/${name}/before.whydiff.json`
    )
    await expect(serializeSnapshot(b)).toMatchFileSnapshot(
      `../../fixtures/match/${name}/after.whydiff.json`
    )
    const matching = matchSnapshots(a, b, { regions })
    await expect(`${JSON.stringify(matching, null, 2)}\n`).toMatchFileSnapshot(
      `../../fixtures/match/${name}/matching.json`
    )
  })
})
