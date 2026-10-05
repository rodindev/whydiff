import { ruleTables, withRule } from '../deltas/rules.js'
import type { StyleChange } from '../deltas/types.js'
import type { DeclarationV1, RuleV1, SheetV1, SnapshotV1 } from '../snapshot/types.js'
import { buildSnapshot } from '../testing/snapshots.js'
import { sheetName } from '../snapshot/sheets.js'
import { parameter, plainKeys, ruleCandidates, ruleRef, styleKeys } from './keys.js'

describe('styleKeys', () => {
  it('builds the three levels from sorted, normalized changes', () => {
    const { keys, summaries } = styleKeys('ui-btn', 'style', [
      { prop: 'padding-left', from: '16px', to: '0px' },
      { prop: 'color', from: 'rgb(0, 0, 0)', to: 'rgb(9, 9, 9)' },
      { prop: 'font-weight', from: 'bold', to: '500' },
    ])
    expect(keys).toEqual([
      'k2|ui-btn|style|color=rgb(0, 0, 0)>rgb(9, 9, 9);font-weight=700>500;padding-left=16px>0',
      'k2|ui-btn|style|color:<color>;font-weight:<num -200>;padding-left:<len -16px>',
      'k2|ui-btn|style|color;font-weight;padding-left',
    ])
    expect(summaries[2]).toEqual({
      kind: 'style',
      changes: [{ prop: 'color' }, { prop: 'font-weight' }, { prop: 'padding-left' }],
    })
  })
})

describe('parameter', () => {
  it.each([
    ['16px', '24.25px', '<len +8.5px>'],
    ['1', '0.5', '<num -0.5>'],
    ['rgb(0, 0, 0)', 'oklch(0.7 0.1 200)', '<color>'],
    ['grid', 'flex', '<kw grid>flex>'],
  ])('describes %s to %s as %s', (from, to, expected) => {
    expect(parameter(from, to)).toBe(expected)
  })
})

describe('plainKeys', () => {
  it('uses one key for all levels', () => {
    expect(plainKeys('ui-badge', { kind: 'added' }).keys).toEqual([
      'k2|ui-badge|added',
      'k2|ui-badge|added',
      'k2|ui-badge|added',
    ])
  })

  it('keeps the content detail in the key', () => {
    const { keys, summaries } = plainKeys('ui-btn', { kind: 'content', detail: 'font-metrics' })
    expect(keys[0]).toBe('k2|ui-btn|content:font-metrics')
    expect(summaries[0]).toEqual({ kind: 'content', detail: 'font-metrics' })
  })
})

const PROPS = ['padding-left', 'color', 'font-weight']
const SHEETS: SheetV1[] = [
  { href: 'http://app.test/assets/app.css?v=3', hash: 'app1' },
  { inline: true, hash: 'style1' },
  { hash: 'constructed1' },
  { inline: true, hash: 'style2' },
]
const before = buildSnapshot([{ tag: 'div', a: 0 }], {
  props: PROPS,
  sheets: SHEETS,
  rules: [
    { sheet: 0, selector: '.old' },
    { sheet: 1, selector: '.other' },
  ],
  attributions: [[0, 0, 1]],
})
const after = buildSnapshot([{ tag: 'div', a: 0 }], {
  props: PROPS,
  sheets: SHEETS,
  rules: [
    { sheet: 0, selector: '.new', layer: 'base' },
    { inline: true, selector: '', important: true },
    { sheet: 0, selector: '.old' },
  ],
  attributions: [[0, 0, 1]],
})
const change = (prop: string, from: number | null, to: number | null) => ({
  prop,
  from: 'a',
  to: 'b',
  rule: { from, to },
})
const candidateOf = (b: SnapshotV1, a: SnapshotV1, changes: readonly StyleChange[]) =>
  ruleCandidates(b, a, ruleTables(b, a), changes)

describe('ruleCandidates', () => {
  it('lists every rule the changed longhands point at, the one covering most first, each with the rule its longhands lost to', () => {
    expect(
      candidateOf(before, after, [
        change('padding-left', 0, 0),
        change('color', 0, 0),
        change('font-weight', 1, 1),
      ])
    ).toEqual([
      {
        key: 'k2|rule|app.css|.new|',
        rule: { selector: '.new', sheet: 'app.css', layer: 'base' },
        after: true,
        sets: ['color', 'padding-left'],
        changed: [],
        unsets: [],
        loser: 'app.css|.old|',
        loserRef: { selector: '.old', sheet: 'app.css' },
        layers: null,
        vars: [],
        via: [],
        defaults: [],
        values: [
          { prop: 'color', from: 'a', to: 'b' },
          { prop: 'padding-left', from: 'a', to: 'b' },
        ],
      },
      {
        key: 'k2|rule|inline||!',
        rule: { selector: '', sheet: 'style attribute', important: true },
        after: true,
        sets: ['font-weight'],
        changed: [],
        unsets: [],
        loser: '<style> #1|.other|',
        loserRef: { selector: '.other', sheet: '<style> #1' },
        layers: null,
        vars: [],
        via: [],
        defaults: [],
        values: [{ prop: 'font-weight', from: 'a', to: 'b' }],
      },
    ])
  })

  it('leaves the loser out when the longhands lost to different rules', () => {
    const [candidate] = candidateOf(before, after, [
      change('color', 0, 1),
      change('font-weight', 1, 0),
      change('padding-left', null, 0),
    ])
    expect(candidate?.key).toBe('k2|rule|app.css|.new|')
    expect(candidate?.sets).toEqual(['font-weight', 'padding-left'])
    expect(candidate?.loser).toBeNull()
    expect(candidate?.loserRef).toBeNull()
  })

  it('orders rules with as many longhands by key, whatever the order of the changes', () => {
    const tie = [change('color', 0, 1), change('font-weight', 1, 0)]
    const keys = ['k2|rule|app.css|.new|', 'k2|rule|inline||!']
    expect(candidateOf(before, after, tie).map((c) => c.key)).toEqual(keys)
    expect(candidateOf(before, after, [...tie].reverse()).map((c) => c.key)).toEqual(keys)
  })

  it('counts the longhands a rule no longer sets toward its share', () => {
    expect(
      candidateOf(before, after, [
        change('font-weight', 1, 0),
        change('padding-left', 0, null),
        change('color', 0, null),
      ])
    ).toMatchObject([
      { key: 'k2|rule|app.css|.old|', unsets: ['color', 'padding-left'] },
      { key: 'k2|rule|app.css|.new|', sets: ['font-weight'] },
    ])
  })

  it('reads a declaration the layered rule changed as changed when only the other side holds the selector in two layers', () => {
    const side = (rules: RuleV1[]) =>
      buildSnapshot([{ tag: 'div', a: 0 }], {
        props: PROPS,
        sheets: SHEETS,
        rules,
        attributions: [[0, 0, 0]],
      })
    const one = side([{ sheet: 0, selector: 'body', layer: 'base' }])
    const two = side([
      { sheet: 0, selector: 'body', layer: 'base' },
      { sheet: 0, selector: 'body' },
    ])
    expect(candidateOf(one, two, [change('font-weight', 0, 0)])).toMatchObject([
      {
        key: 'k2|rule|app.css|body||layer base',
        sets: [],
        changed: ['font-weight'],
        loser: null,
        layers: { from: 'base', to: 'base' },
      },
    ])
  })

  it('reads the same rule on both sides as a changed declaration', () => {
    expect(candidateOf(before, after, [change('padding-left', 0, 2)])).toMatchObject([
      {
        key: 'k2|rule|app.css|.old|',
        rule: { selector: '.old', sheet: 'app.css' },
        sets: [],
        changed: ['padding-left'],
        loser: null,
        layers: {},
      },
    ])
  })

  it('files a declaration whose winner is gone under the rule that set it', () => {
    expect(
      candidateOf(before, after, [change('padding-left', 0, null), change('color', 0, null)])
    ).toEqual([
      {
        key: 'k2|rule|app.css|.old|',
        rule: { selector: '.old', sheet: 'app.css' },
        after: true,
        sets: [],
        changed: [],
        unsets: ['color', 'padding-left'],
        loser: null,
        loserRef: null,
        layers: {},
        vars: [],
        via: [],
        defaults: [],
        values: [
          { prop: 'color', from: 'a', to: 'b' },
          { prop: 'padding-left', from: 'a', to: 'b' },
        ],
      },
    ])
  })

  it('keeps one key for a rule that moved into a layer and gives its layer on each side', () => {
    const moved = buildSnapshot([{ tag: 'div', a: 0 }], {
      props: PROPS,
      sheets: SHEETS,
      rules: [{ sheet: 0, selector: '.old', layer: 'base' }],
      attributions: [[0, -1, -1]],
    })
    expect(
      candidateOf(before, moved, [change('padding-left', 0, 0), change('color', 0, null)])
    ).toEqual([
      {
        key: 'k2|rule|app.css|.old|',
        rule: { selector: '.old', sheet: 'app.css', layer: 'base' },
        after: true,
        sets: [],
        changed: ['padding-left'],
        unsets: ['color'],
        loser: null,
        loserRef: null,
        layers: { to: 'base' },
        vars: [],
        via: [],
        defaults: [],
        values: [
          { prop: 'color', from: 'a', to: 'b' },
          { prop: 'padding-left', from: 'a', to: 'b' },
        ],
      },
    ])
  })

  it('names a rule that is gone by its before side', () => {
    expect(candidateOf(before, after, [change('color', 1, null)])).toMatchObject([
      {
        key: 'k2|rule|<style> #1|.other|',
        rule: { selector: '.other', sheet: '<style> #1' },
        after: false,
        unsets: ['color'],
        layers: null,
      },
    ])
  })

  it('gives the layers of a rule that only sets longhands now', () => {
    const unlayered = buildSnapshot([{ tag: 'div', a: 0 }], {
      props: PROPS,
      sheets: SHEETS,
      rules: [
        { sheet: 0, selector: '.old' },
        { sheet: 0, selector: '.new' },
      ],
      attributions: [[0, 0, 0]],
    })
    expect(candidateOf(unlayered, after, [change('color', 0, 0)])).toMatchObject([
      {
        key: 'k2|rule|app.css|.new|',
        rule: { selector: '.new', sheet: 'app.css', layer: 'base' },
        sets: ['color'],
        loser: 'app.css|.old|',
        layers: { to: 'base' },
      },
    ])
  })

  it('is empty when no change points at a rule on either side', () => {
    expect(candidateOf(before, after, [change('color', null, null)])).toEqual([])
    expect(candidateOf(before, after, [{ prop: 'color', from: 'a', to: 'b' }])).toEqual([])
  })
})

describe('ruleCandidates through custom properties', () => {
  const RULES: RuleV1[] = [
    { sheet: 0, selector: ':root, :host', layer: 'theme' },
    { sheet: 0, selector: '.ui-card' },
    { sheet: 0, selector: '*, ::before, ::after', layer: 'base' },
    { inline: true, selector: '' },
    { sheet: 0, selector: '.ui-elevated' },
    { userAgent: true, selector: 'button' },
    { sheet: 0, selector: '@property --ui-border-style' },
  ]
  /** One element whose `prop` the rule at `rule` wins (-1 for none), the declarations as listed, the last one in its uses row. */
  const side = (rule: number, declarations: DeclarationV1[], prop = 'padding-left'): SnapshotV1 =>
    buildSnapshot([{ tag: 'div', a: 0 }], {
      props: PROPS,
      sheets: SHEETS,
      rules: RULES,
      attributions: [PROPS.map((p) => (p === prop ? rule : -1))],
      declarations,
      uses: [declarations.length === 0 ? [] : [declarations.length - 1]],
    })
  const walked = (b: SnapshotV1, a: SnapshotV1, prop = 'padding-left') =>
    candidateOf(b, a, [withRule({ prop, from: 'x', to: 'y' }, b, 0, a, 0)])
  const card = (value: string, reads: number[]): DeclarationV1 => ({
    prop: 'padding-left',
    rule: 1,
    value,
    reads,
  })
  const root = (prop: string, value?: string): DeclarationV1 => ({
    prop,
    ...(value === undefined ? {} : { rule: 0, value, inherited: true }),
  })

  it('files a longhand whose declaration kept its text under the rule that changed the token it reads, through a token that did not change', () => {
    const tokens = (space: string): DeclarationV1[] => [
      root('--ui-space', space),
      { ...root('--ui-pad', 'calc(var(--ui-space) * 2)'), reads: [0] },
      card('var(--ui-pad)', [1]),
    ]
    expect(walked(side(1, tokens('4px')), side(1, tokens('5px')))).toEqual([
      expect.objectContaining({
        key: 'k2|rule|app.css|:root, :host|',
        rule: { selector: ':root, :host', sheet: 'app.css', layer: 'theme' },
        sets: [],
        changed: ['--ui-space'],
        unsets: [],
        vars: [{ name: '--ui-space', from: '4px', to: '5px', readBy: ['padding-left'] }],
      }),
    ])
  })

  it('keeps a declaration whose text changed, or whose tokens did not, on the rule itself', () => {
    const space = root('--ui-space', '4px')
    const changed = walked(
      side(1, [space, card('var(--ui-space)', [0])]),
      side(1, [space, card('calc(var(--ui-space) * 2)', [0])])
    )
    const same = walked(
      side(1, [space, card('calc(var(--ui-space)  *  2)', [0])]),
      side(1, [space, card('calc(var(--ui-space) * 2)', [0])])
    )
    for (const candidates of [changed, same]) {
      expect(candidates).toEqual([
        expect.objectContaining({ key: 'k2|rule|app.css|.ui-card|', changed: ['padding-left'] }),
      ])
    }
    expect(changed[0]?.vars).toEqual([])
  })

  it('says a token no rule declares now, and whether its readers fall back or turn invalid', () => {
    const gap = (value?: string): DeclarationV1[] => [
      root('--ui-gap', value),
      card('var(--ui-gap, 6px)', [0]),
    ]
    expect(walked(side(1, gap('4px')), side(1, gap()))).toEqual([
      expect.objectContaining({
        key: 'k2|rule|app.css|:root, :host|',
        unsets: ['--ui-gap'],
        vars: [{ name: '--ui-gap', from: '4px', readBy: ['padding-left'], missing: 'fallback' }],
      }),
    ])
    const ring = (rule?: number): DeclarationV1[] => [
      { prop: '--ui-ring', ...(rule === undefined ? {} : { rule, value: '0 0 #0000' }) },
      card('var(--ui-ring)', [0]),
    ]
    expect(walked(side(1, ring()), side(1, ring(2)))).toEqual([
      expect.objectContaining({
        key: 'k2|rule|app.css|*, ::before, ::after|',
        sets: ['--ui-ring'],
        loser: null,
        vars: [
          { name: '--ui-ring', to: '0 0 #0000', readBy: ['padding-left'], missing: 'invalid' },
        ],
      }),
    ])
  })

  it('names a registration, and the style attribute of an ancestor apart from the element own', () => {
    const style = (registered: boolean): DeclarationV1[] => [
      registered
        ? { prop: '--ui-border-style', rule: 6, value: 'solid', initial: true }
        : { prop: '--ui-border-style' },
      card('var(--ui-border-style)', [0]),
    ]
    expect(walked(side(1, style(true)), side(1, style(false)))).toEqual([
      expect.objectContaining({
        key: 'k2|rule|app.css|@property --ui-border-style|',
        unsets: ['--ui-border-style'],
        vars: [
          {
            name: '--ui-border-style',
            from: 'solid',
            readBy: ['padding-left'],
            missing: 'invalid',
          },
        ],
      }),
    ])
    const surface = (value: string): DeclarationV1[] => [
      { prop: '--ui-surface', rule: 3, value, inherited: true },
      { prop: 'color', rule: 1, value: 'var(--ui-surface)', reads: [0] },
    ]
    expect(
      walked(side(1, surface('#353535'), 'color'), side(1, surface('#ffffff'), 'color'), 'color')
    ).toEqual([
      expect.objectContaining({
        key: 'k2|rule|inline|||ancestor',
        rule: { selector: '', sheet: 'style attribute of an ancestor' },
        changed: ['--ui-surface'],
      }),
    ])
  })

  it('names the token another rule declares for a longhand the rule now sets', () => {
    const before = side(4, [])
    const after = side(1, [{ prop: '--ui-pad', rule: 4, value: '8px' }, card('var(--ui-pad)', [0])])
    expect(walked(before, after)).toEqual([
      expect.objectContaining({
        key: 'k2|rule|app.css|.ui-card|',
        sets: ['padding-left'],
        loser: 'app.css|.ui-elevated|',
        via: [
          {
            name: '--ui-pad',
            key: 'app.css|.ui-elevated|',
            rule: { selector: '.ui-elevated', sheet: 'app.css' },
            readBy: ['padding-left'],
          },
        ],
      }),
    ])
  })

  it('names the browser rule a longhand the rule now sets took the place of, with its value', () => {
    const before = side(-1, [{ prop: 'padding-left', rule: 5, value: '6px' }])
    expect(walked(before, side(1, []))).toEqual([
      expect.objectContaining({
        key: 'k2|rule|app.css|.ui-card|',
        sets: ['padding-left'],
        loser: 'user agent|button|',
        loserRef: { selector: 'button', sheet: 'user agent stylesheet', userAgent: true },
        defaults: [{ prop: 'padding-left', value: '6px' }],
      }),
    ])
  })
})

describe('ruleRef and sheetName', () => {
  it('names sheets by the basename of the href, the style ordinal or the constructed ordinal', () => {
    expect([0, 1, 2, 3].map((index) => sheetName(after, index))).toEqual([
      'app.css',
      '<style> #1',
      'constructed #1',
      '<style> #2',
    ])
  })

  it('names the style attribute with an empty selector', () => {
    expect(ruleRef(after, 1)).toEqual({ selector: '', sheet: 'style attribute', important: true })
    expect(ruleRef(after, 3)).toBeNull()
  })
})

describe('styleKeys families', () => {
  it('separates a container change from an own change with the same properties', () => {
    const changes = [{ prop: 'padding-left', from: '0px', to: '8px' }]
    expect(styleKeys('ui-row', 'container', changes).keys[0]).toBe(
      'k2|ui-row|container|padding-left=0>8px'
    )
    expect(styleKeys('ui-row', 'paint-order', changes).summaries[0].kind).toBe('paint-order')
  })
})
