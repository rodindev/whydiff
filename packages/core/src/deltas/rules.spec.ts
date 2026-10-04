import type { RuleV1 } from '../snapshot/types.js'
import { buildSnapshot } from '../testing/snapshots.js'
import { ruleIndex, ruleTables, withRule } from './rules.js'

const PROPS = ['display', 'padding-left', 'color']
const snapshot = buildSnapshot([{ tag: 'div', a: 1 }, { tag: 'p' }], {
  props: PROPS,
  sheets: [
    { href: 'http://app.test/app.css', hash: 'app1' },
    { inline: true, hash: 'style1' },
  ],
  rules: [
    { sheet: 0, selector: '.a', layer: 'base', important: true },
    { sheet: 1, selector: '.b' },
    { inline: true, selector: '' },
  ],
  attributions: [
    [-1, -1, -1],
    [-1, 0, 2],
  ],
})

describe('ruleTables', () => {
  it('names a rule by its sheet name or inline, selector and importance', () => {
    expect(ruleTables(snapshot, snapshot).before.keys).toEqual([
      'app.css|.a|!',
      '<style> #1|.b|',
      'inline||',
    ])
  })

  it('keeps the identity of a rule across a hashed rename and a move between layers', () => {
    const side = (href: string, layer?: string) =>
      buildSnapshot([{ tag: 'div' }], {
        props: PROPS,
        sheets: [{ href, hash: href }],
        rules: [{ sheet: 0, selector: '.a', ...(layer === undefined ? {} : { layer }) }],
      })
    const before = side('http://app.test/assets/grid-DIlXbKeZ.css')
    const after = side('http://app.test/assets/grid-D79WzvNx.css', 'framework.components')
    const tables = ruleTables(before, after)
    expect(tables.after.keys).toEqual(['grid-*.css|.a|'])
    expect(tables.before.keys).toEqual(tables.after.keys)
  })

  it('keeps the identity of a rule across a rebuild of two sheets that read the same without their hash, unless both hold its selector', () => {
    const side = (first: string, second: string) =>
      buildSnapshot([{ tag: 'div' }], {
        props: PROPS,
        sheets: [
          { href: `http://app.test/assets/index-${first}.css`, hash: first },
          { href: `http://app.test/assets/index-${second}.css`, hash: second },
        ],
        rules: [
          { sheet: 0, selector: '.ui-btn:hover' },
          { sheet: 1, selector: '.ui-panel' },
          { sheet: 0, selector: '.ui-row' },
          { sheet: 1, selector: '.ui-row' },
        ],
      })
    const tables = ruleTables(side('DIlXbKeZ', 'Bx81kQ2c'), side('D79WzvNx', 'Cq3mT0aZ'))
    expect(tables.before.keys).toEqual([
      'index-*.css|.ui-btn:hover|',
      'index-*.css|.ui-panel|',
      'index-DIlXbKeZ.css|.ui-row|',
      'index-Bx81kQ2c.css|.ui-row|',
    ])
    expect(tables.after.keys.slice(0, 2)).toEqual(tables.before.keys.slice(0, 2))
  })

  it('keeps the layer where either side holds the sheet, selector and importance in more than one, unlayered counting as one', () => {
    const side = (rules: RuleV1[]) =>
      buildSnapshot([{ tag: 'div' }], {
        props: PROPS,
        sheets: [{ href: 'http://app.test/app.css', hash: 'app1' }],
        rules,
      })
    const tables = ruleTables(
      side([
        { sheet: 0, selector: 'body', layer: 'base' },
        { sheet: 0, selector: '.a' },
      ]),
      side([
        { sheet: 0, selector: 'body', layer: 'base' },
        { sheet: 0, selector: 'body' },
        { sheet: 0, selector: 'body', layer: 'theme', important: true },
        { sheet: 0, selector: '.a', layer: 'base' },
      ])
    )
    expect(tables.before.keys).toEqual(['app.css|body||layer base', 'app.css|.a|'])
    expect(tables.after.keys).toEqual([
      'app.css|body||layer base',
      'app.css|body||unlayered',
      'app.css|body|!',
      'app.css|.a|',
    ])
  })

  it('finds the first index of each identity, and nothing in a snapshot without rules', () => {
    const repeated = buildSnapshot([{ tag: 'div' }], {
      props: PROPS,
      sheets: [{ href: 'http://app.test/app.css', hash: 'app1' }],
      rules: [
        { sheet: 0, selector: '.b' },
        { sheet: 0, selector: '.a' },
        { sheet: 0, selector: '.a' },
      ],
    })
    const tables = ruleTables(repeated, buildSnapshot([{ tag: 'div' }]))
    expect([...tables.before.first]).toEqual([
      ['app.css|.b|', 0],
      ['app.css|.a|', 1],
    ])
    expect(tables.after).toEqual({ keys: [], first: new Map() })
  })
})

describe('ruleIndex', () => {
  it('reads the row of the node, null for -1, an unknown prop or a node without a row', () => {
    expect(ruleIndex(snapshot, 0, 'padding-left')).toBe(0)
    expect(ruleIndex(snapshot, 0, 'color')).toBe(2)
    expect(ruleIndex(snapshot, 0, 'display')).toBeNull()
    expect(ruleIndex(snapshot, 0, 'opacity')).toBeNull()
    expect(ruleIndex(snapshot, 1, 'padding-left')).toBeNull()
  })
})

describe('withRule', () => {
  const change = { prop: 'padding-left', from: '0px', to: '8px' }

  it('adds the rule index of each side when both snapshots carry attributions', () => {
    expect(withRule(change, snapshot, 0, snapshot, 1)).toEqual({
      ...change,
      rule: { from: 0, to: null },
    })
  })

  it('leaves the change alone when a side has no attributions', () => {
    const bare = buildSnapshot([{ tag: 'div' }], { props: PROPS })
    expect(withRule(change, snapshot, 0, bare, 0)).toBe(change)
    expect(withRule(change, bare, 0, snapshot, 0)).toBe(change)
  })

  it('adds the declaration each side lists for the longhand when both carry declarations, null where a side lists none', () => {
    const declared = buildSnapshot(
      [
        { tag: 'div', a: 1 },
        { tag: 'p', a: 0 },
      ],
      {
        props: PROPS,
        sheets: [{ href: 'http://app.test/app.css', hash: 'app1' }],
        rules: [
          { sheet: 0, selector: ':root' },
          { sheet: 0, selector: '.a' },
          { userAgent: true, selector: 'p' },
        ],
        attributions: [
          [-1, -1, -1],
          [-1, 1, -1],
        ],
        declarations: [
          { prop: '--ui-space', rule: 0, value: '4px', inherited: true },
          { prop: 'padding-left', rule: 1, value: 'var(--ui-space)', reads: [0] },
          { prop: 'padding-left', rule: 2, value: '1px' },
        ],
        uses: [[2], [1]],
      }
    )
    expect(withRule(change, declared, 0, declared, 1)).toEqual({
      ...change,
      rule: { from: 1, to: null },
      declaration: { from: 1, to: 2 },
    })
    expect(withRule({ ...change, prop: 'color' }, declared, 0, declared, 1).declaration).toEqual({
      from: null,
      to: null,
    })
    expect(withRule(change, snapshot, 0, declared, 1)).not.toHaveProperty('declaration')
  })
})

describe('ruleTables: the browser', () => {
  it('names a rule of the browser apart from every sheet', () => {
    const browser = buildSnapshot([{ tag: 'p' }], {
      props: PROPS,
      rules: [{ userAgent: true, selector: 'p' }],
    })
    expect(ruleTables(browser, browser).before.keys).toEqual(['user agent|p|'])
  })
})
