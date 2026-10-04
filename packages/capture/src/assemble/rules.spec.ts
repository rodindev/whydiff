import type { RuleV1 } from '@whydiff/core'

import type {
  MatchedStyles,
  RawDeclaration,
  RawInheritedStyle,
  RawLayer,
  RawRule,
  RuleGroup,
} from '../raw.js'
import { chains } from '../testing/chains.js'
import { rawSheet } from '../testing/columns.js'
import { layerNamer } from './layers.js'
import { attributeDocument, physical, RuleTable, type Flow, type RuleContext } from './rules.js'

const PROPS = ['color', 'padding-left', 'border-top-width', 'font-weight']
const SHEETS: ReadonlyMap<string, number> = new Map([
  ['s0', 0],
  ['s1', 1],
])
const NAMES = layerNamer([
  rawSheet(
    's0',
    '@layer { .a {} }\n@layer framework { @layer { .b {} } }\n@layer { @layer inner { .c {} } }'
  ),
  rawSheet('s1', '@layer { .d {} }'),
])
const CONTEXT: RuleContext = {
  props: PROPS,
  sheetIndex: SHEETS,
  layerName: NAMES,
  shorthands: new Map(),
}
const LTR: Flow = { writingMode: 'horizontal-tb', direction: 'ltr' }
const PADDING = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']

/** One group attributed: the rule that won each prop and the row's declarations written out. */
function attribute(
  matched: MatchedStyles,
  context: RuleContext = CONTEXT,
  flow: Flow = LTR
): { winners: (RuleV1 | null)[]; uses: ReturnType<typeof chains> } {
  const table = new RuleTable()
  const row = attributeDocument([{ nodes: [0], matched }], table, context, () => flow).get(0) ?? -1
  return {
    winners: (table.rows[row] ?? []).map((rule) => table.rules[rule] ?? null),
    uses: chains(
      { rules: table.rules, declarations: table.declarations.entries },
      table.uses[row] ?? []
    ),
  }
}

function winners(matched: MatchedStyles): (RuleV1 | null)[] {
  return attribute(matched).winners
}

const anonymous = (styleSheetId: string, startLine: number, startColumn: number): RawLayer => ({
  text: '',
  styleSheetId,
  range: { startLine, startColumn },
})

type Declaration = readonly [name: string, value: string, important?: true]

function declaration([name, value, important]: Declaration): RawDeclaration {
  return important === undefined ? { name, value } : { name, value, important }
}

function match(
  selector: string,
  declarations: readonly Declaration[],
  extra: Partial<RawRule> = {}
): { rule: RawRule } {
  return {
    rule: {
      styleSheetId: 's0',
      origin: 'regular',
      selectorList: { text: selector },
      style: { cssProperties: declarations.map(declaration) },
      ...extra,
    },
  }
}

describe('winners', () => {
  it('takes the later rule among equals and the style attribute over any sheet rule', () => {
    const matched: MatchedStyles = {
      inlineStyle: { cssProperties: [declaration(['color', 'blue'])] },
      matchedCSSRules: [
        match('.a', [
          ['color', 'red'],
          ['padding-left', '1px'],
        ]),
        match('.b', [['padding-left', '2px']], { styleSheetId: 's1' }),
      ],
    }
    expect(winners(matched)).toEqual([
      { inline: true, selector: '' },
      { sheet: 1, selector: '.b' },
      null,
      null,
    ])
  })

  it('lets an important declaration beat later normal ones and reverses the layer order among important ones', () => {
    const matched: MatchedStyles = {
      matchedCSSRules: [
        match(
          '.a',
          [
            ['color', 'red', true],
            ['font-weight', '400', true],
          ],
          { layers: [{ text: 'base' }] }
        ),
        match('.b', [
          ['color', 'blue'],
          ['font-weight', '700', true],
        ]),
      ],
    }
    expect(winners(matched)).toEqual([
      { sheet: 0, selector: '.a', layer: 'base', important: true },
      null,
      null,
      { sheet: 0, selector: '.a', layer: 'base', important: true },
    ])
  })

  it('puts the style attribute above sheet declarations of the same importance only', () => {
    const sheet = [match('.a', [['color', 'red', true]], { layers: [{ text: 'base' }] })]
    const normal: MatchedStyles = {
      inlineStyle: { cssProperties: [declaration(['color', 'blue'])] },
      matchedCSSRules: sheet,
    }
    const important: MatchedStyles = {
      inlineStyle: { cssProperties: [declaration(['color', 'blue', true])] },
      matchedCSSRules: sheet,
    }
    expect(winners(normal)[0]).toEqual({
      sheet: 0,
      selector: '.a',
      layer: 'base',
      important: true,
    })
    expect(winners(important)[0]).toEqual({
      inline: true,
      selector: '',
      important: true,
    })
  })

  it('attributes a shorthand to its longhands and joins nested layer names with dots', () => {
    const shorthand: RawDeclaration = {
      name: 'border',
      value: '0 solid red',
      longhandProperties: [{ name: 'border-top-width' }, { name: 'border-top-style' }],
    }
    const matched: MatchedStyles = {
      matchedCSSRules: [
        {
          rule: {
            styleSheetId: 's1',
            origin: 'regular',
            selectorList: { text: '#x' },
            layers: [{ text: 'a' }, { text: 'b' }],
            style: { cssProperties: [shorthand] },
          },
        },
      ],
    }
    expect(winners(matched)).toEqual([null, null, { sheet: 1, selector: '#x', layer: 'a.b' }, null])
  })

  it('names the layer path outermost first, an anonymous layer by its place in the sheet that declares it', () => {
    const matched: MatchedStyles = {
      matchedCSSRules: [
        match('.a', [['color', 'red']], { layers: [anonymous('s0', 0, 7)] }),
        match('.b', [['padding-left', '1px']], {
          layers: [{ text: 'framework' }, anonymous('s0', 1, 26)],
        }),
        match('.c', [['border-top-width', '1px']], {
          layers: [anonymous('s0', 2, 7), { text: 'inner' }],
        }),
      ],
    }
    expect(winners(matched)).toEqual([
      { sheet: 0, selector: '.a', layer: '<anonymous #1>' },
      { sheet: 0, selector: '.b', layer: 'framework.<anonymous #2>' },
      { sheet: 0, selector: '.c', layer: '<anonymous #3>.inner' },
      null,
    ])
  })

  it('ranks an anonymous layer apart from unlayered rules and from an anonymous layer of another sheet', () => {
    const matched: MatchedStyles = {
      matchedCSSRules: [
        match(
          '.a',
          [
            ['color', 'red', true],
            ['padding-left', '1px'],
            ['font-weight', '400', true],
          ],
          { layers: [anonymous('s0', 0, 7)] }
        ),
        match('.d', [['font-weight', '700', true]], {
          styleSheetId: 's1',
          layers: [anonymous('s1', 0, 7)],
        }),
        match('.e', [
          ['color', 'blue', true],
          ['padding-left', '2px'],
        ]),
      ],
    }
    expect(winners(matched)).toEqual([
      { sheet: 0, selector: '.a', layer: '<anonymous #1>', important: true },
      { sheet: 0, selector: '.e' },
      null,
      { sheet: 0, selector: '.a', layer: '<anonymous #1>', important: true },
    ])
  })

  it("names no author rule where the browser's rules, disabled or unparsed declarations or a sheet the snapshot does not list set the prop", () => {
    const matched: MatchedStyles = {
      matchedCSSRules: [
        match('.a', [['color', 'red']]),
        {
          rule: {
            origin: 'user-agent',
            selectorList: { text: 'div' },
            style: { cssProperties: [declaration(['padding-left', '8px'])] },
          },
        },
        {
          rule: {
            styleSheetId: 's0',
            origin: 'regular',
            selectorList: { text: '.b' },
            style: {
              cssProperties: [
                { name: 'border-top-width', value: '1px', disabled: true },
                { name: 'font-weight', value: 'heavy', parsedOk: false },
              ],
            },
          },
        },
        match('.c', [['color', 'green']], { styleSheetId: 'freeze' }),
      ],
    }
    expect(winners(matched)).toEqual([null, null, null, null])
  })

  it("maps a flow-relative declaration to the side of the element's writing mode and direction, where the later of a twin pair wins", () => {
    const start = match('.ui-ps', [['padding-inline-start', '4px']])
    const left = match('.ui-pl', [['padding-left', '1px']])
    const context = { ...CONTEXT, props: PADDING }
    const sides = (rules: { rule: RawRule }[], flow: Flow): (string | undefined)[] =>
      attribute({ matchedCSSRules: rules }, context, flow).winners.map((rule) => rule?.selector)
    expect(sides([start, left], LTR)).toEqual([undefined, undefined, undefined, '.ui-pl'])
    expect(sides([left, start], LTR)).toEqual([undefined, undefined, undefined, '.ui-ps'])
    expect(sides([start, left], { ...LTR, direction: 'rtl' })).toEqual([
      undefined,
      '.ui-ps',
      undefined,
      '.ui-pl',
    ])
    expect(sides([start, left], { writingMode: 'vertical-rl', direction: 'ltr' })).toEqual([
      '.ui-ps',
      undefined,
      undefined,
      '.ui-pl',
    ])
  })

  it('reads importance from a trailing !important, which the browser leaves unflagged on a custom property', () => {
    const matched: MatchedStyles = {
      matchedCSSRules: [
        match('.a', [['color', 'blue !IMPORTANT']]),
        match('.b', [['color', 'red']]),
      ],
    }
    expect(winners(matched)[0]).toEqual({ sheet: 0, selector: '.a', important: true })
  })
})

describe('physical', () => {
  it('maps flow-relative sides, corners and axes as CSS Writing Modes 4 does', () => {
    const flow = (writingMode: string, direction = 'ltr'): Flow => ({ writingMode, direction })
    const cases: readonly (readonly [string, Flow])[] = [
      ['margin-block-start', flow('horizontal-tb')],
      ['border-block-end-color', flow('vertical-rl')],
      ['border-inline-start-width', flow('vertical-lr', 'rtl')],
      ['padding-inline-end', flow('sideways-lr')],
      ['border-start-start-radius', flow('horizontal-tb', 'rtl')],
      ['border-start-end-radius', flow('vertical-rl')],
      ['border-end-start-radius', flow('sideways-lr')],
      ['overflow-inline', flow('vertical-rl')],
      ['overflow-block', flow('horizontal-tb')],
      ['inset-inline-start', flow('horizontal-tb')],
    ]
    expect(cases.map(([name, writing]) => physical(name, writing))).toEqual([
      'margin-top',
      'border-left-color',
      'border-bottom-width',
      'padding-top',
      'border-top-right-radius',
      'border-bottom-right-radius',
      'border-bottom-right-radius',
      'overflow-y',
      'overflow-y',
      'inset-inline-start',
    ])
  })
})

describe('attributeDocument', () => {
  it('numbers rules by first use and shares rows between groups with the same winners', () => {
    const table = new RuleTable()
    const groups: RuleGroup[] = [
      { nodes: [1, 3], matched: { matchedCSSRules: [match('.a', [['color', 'red']])] } },
      { nodes: [2], matched: {} },
      {
        nodes: [4],
        matched: {
          matchedCSSRules: [
            match('.a', [['color', 'red']]),
            match('.b', [['padding-left', '1px']]),
          ],
        },
      },
      { nodes: [5], matched: { matchedCSSRules: [match('.a', [['color', 'red']])] } },
    ]
    const rowOf = attributeDocument(groups, table, CONTEXT, () => LTR)
    expect(table.rules).toEqual([
      { sheet: 0, selector: '.a' },
      { sheet: 0, selector: '.b' },
    ])
    expect(table.rows).toEqual([
      [0, -1, -1, -1],
      [-1, -1, -1, -1],
      [0, 1, -1, -1],
    ])
    expect([...rowOf]).toEqual([
      [1, 0],
      [3, 0],
      [2, 1],
      [4, 2],
      [5, 0],
    ])
  })

  it('tells the important declarations of a rule apart from its normal ones', () => {
    const table = new RuleTable()
    const groups: RuleGroup[] = [
      {
        nodes: [1],
        matched: {
          matchedCSSRules: [
            match('.a', [
              ['color', 'red', true],
              ['padding-left', '1px'],
            ]),
          ],
        },
      },
    ]
    attributeDocument(groups, table, CONTEXT, () => LTR)
    expect(table.rules).toEqual([
      { sheet: 0, selector: '.a', important: true },
      { sheet: 0, selector: '.a' },
    ])
    expect(table.rows).toEqual([[0, 1, -1, -1]])
  })

  it('expands a shorthand the browser left unexpanded through the probe, and without an answer keeps the winner and loses only the text', () => {
    const matched: MatchedStyles = {
      matchedCSSRules: [
        {
          rule: {
            styleSheetId: 's0',
            origin: 'regular',
            selectorList: { text: '.a' },
            style: {
              cssProperties: [
                { name: 'padding', value: 'var(--ui-pad)', source: true },
                { name: 'padding-top', value: '1px', source: true },
                ...PADDING.map((name) => ({ name, value: name === 'padding-top' ? '1px' : '' })),
              ],
            },
          },
        },
      ],
    }
    const context = { ...CONTEXT, props: PADDING }
    const probed = attribute(matched, { ...context, shorthands: new Map([['padding', PADDING]]) })
    const unprobed = attribute(matched, context)
    const rule = { sheet: 0, selector: '.a' }
    expect(probed.winners).toEqual([rule, rule, rule, rule])
    expect(unprobed.winners).toEqual(probed.winners)
    expect(probed.uses.map(({ prop, value }) => [prop, value])).toEqual([
      ['padding-right', 'var(--ui-pad)'],
      ['padding-bottom', 'var(--ui-pad)'],
      ['padding-left', 'var(--ui-pad)'],
    ])
    expect(unprobed.uses).toEqual([])
  })

  it("records the browser's declaration where no author declaration won, under the selectors that matched", () => {
    const browser = (declarations: readonly RawDeclaration[]): { rule: RawRule } => ({
      rule: {
        origin: 'user-agent',
        selectorList: { text: 'button' },
        style: { cssProperties: declarations },
      },
    })
    const matched: MatchedStyles = {
      matchedCSSRules: [
        browser([
          { name: 'color', value: 'buttontext' },
          { name: 'padding-inline-start', value: '6px' },
          { name: 'border-top-width', value: '2px' },
          { name: 'font-weight', value: '700', important: true },
        ]),
        match('.a', [
          ['color', 'red'],
          ['font-weight', '400', true],
        ]),
      ],
    }
    const { winners: won, uses } = attribute(matched)
    expect(won).toEqual([{ sheet: 0, selector: '.a' }, null, null, null])
    expect(uses).toEqual([
      { prop: 'padding-left', rule: { userAgent: true, selector: 'button' }, value: '6px' },
      { prop: 'border-top-width', rule: { userAgent: true, selector: 'button' }, value: '2px' },
      {
        prop: 'font-weight',
        rule: { userAgent: true, selector: 'button', important: true },
        value: '700',
      },
    ])
  })

  it("lets presentational attributes beat the browser's rules, attributed to no rule", () => {
    const matched: MatchedStyles = {
      attributesStyle: { cssProperties: [{ name: 'color', value: 'red' }] },
      matchedCSSRules: [
        {
          rule: {
            origin: 'user-agent',
            selectorList: { text: 'font' },
            style: { cssProperties: [{ name: 'color', value: 'blue' }] },
          },
        },
      ],
    }
    expect(attribute(matched)).toEqual({ winners: [null, null, null, null], uses: [] })
  })

  it('keeps two rows for groups with the same winners and different chains', () => {
    const table = new RuleTable()
    const reading = match('.a', [['color', 'var(--ui-ink)']])
    const ancestor = (value: string): RawInheritedStyle[] => [
      { matchedCSSRules: [match(':root', [['--ui-ink', value]])] },
    ]
    const groups: RuleGroup[] = [
      { nodes: [1], matched: { matchedCSSRules: [reading], inherited: ancestor('red') } },
      { nodes: [2], matched: { matchedCSSRules: [reading], inherited: ancestor('blue') } },
    ]
    const rowOf = attributeDocument(groups, table, CONTEXT, () => LTR)
    expect(table.rows).toEqual([
      [0, -1, -1, -1],
      [0, -1, -1, -1],
    ])
    expect([...rowOf]).toEqual([
      [1, 0],
      [2, 1],
    ])
  })
})
