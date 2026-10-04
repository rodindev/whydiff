import type { RuleV1 } from '@whydiff/core'

import { VAR_DEPTH_LIMIT } from '../constants.js'
import type {
  MatchedStyles,
  RawInheritedStyle,
  RawPropertyRule,
  RawRule,
  RawStyle,
} from '../raw.js'
import { chains, type Chain } from '../testing/chains.js'
import { rawSheet } from '../testing/columns.js'
import { layerNamer } from './layers.js'
import { attributeDocument, RuleTable, type RuleContext } from './rules.js'
import { namesRead } from './vars.js'

const CONTEXT: RuleContext = {
  props: ['color', 'padding-left'],
  sheetIndex: new Map([['s0', 0]]),
  layerName: layerNamer([rawSheet('s0', '')]),
  shorthands: new Map(),
}
const ROOT: RuleV1 = { sheet: 0, selector: ':root' }
const CARD: RuleV1 = { sheet: 0, selector: '.ui-card' }

function style(declarations: Readonly<Record<string, string>>): RawStyle {
  return {
    cssProperties: Object.entries(declarations).map(([name, value]) => ({
      name,
      value,
      source: true,
    })),
  }
}

function rule(
  selector: string,
  declarations: Readonly<Record<string, string>>,
  extra: Partial<RawRule> = {}
): { rule: RawRule } {
  return {
    rule: {
      styleSheetId: 's0',
      origin: 'regular',
      selectorList: { text: selector },
      style: style(declarations),
      ...extra,
    },
  }
}

function property(name: string, inherits: boolean, initial?: string): RawPropertyRule {
  const descriptors: Record<string, string> = { syntax: "'*'", inherits: String(inherits) }
  if (initial !== undefined) descriptors['initial-value'] = initial
  return { styleSheetId: 's0', propertyName: { text: name }, style: style(descriptors) }
}

/** The written-out declarations of the element whose own rules are `own`, ancestors from the parent up. */
function uses(
  own: Readonly<Record<string, string>>,
  inherited: readonly RawInheritedStyle[] = [],
  extra: Partial<MatchedStyles> = {}
): Chain[] {
  const table = new RuleTable()
  const matched: MatchedStyles = {
    matchedCSSRules: [rule('.ui-card', own)],
    inherited,
    ...extra,
  }
  const row = attributeDocument([{ nodes: [0], matched }], table, CONTEXT, () => ({
    writingMode: 'horizontal-tb',
    direction: 'ltr',
  })).get(0)
  return chains(
    { rules: table.rules, declarations: table.declarations.entries },
    table.uses[row ?? -1] ?? []
  )
}

const level = (...rules: { rule: RawRule }[]): RawInheritedStyle => ({ matchedCSSRules: rules })

describe('namesRead', () => {
  it('lists the custom properties of var() calls in order of first appearance, each once', () => {
    expect(namesRead('var(--b, var(--a)) calc(VAR( --b ) * 2) var(--c,1px)')).toEqual([
      '--b',
      '--a',
      '--c',
    ])
  })
})

describe('custom property chains', () => {
  it('resolves a name from the element, an ancestor rule or an ancestor style attribute', () => {
    const ancestors = [
      level(rule(':root', { '--ui-ink': 'red' })),
      { inlineStyle: style({ '--ui-gap': '2px' }), matchedCSSRules: [] },
    ]
    expect(
      uses({ '--ui-pad': '1px', 'padding-left': 'var(--ui-pad)', color: 'var(--ui-ink)' }, [
        level(rule(':root', { '--ui-ink': 'red', '--ui-pad': '9px' })),
      ])
    ).toEqual([
      { prop: 'color', rule: CARD, value: 'var(--ui-ink)', reads: [inheritedInk()] },
      {
        prop: 'padding-left',
        rule: CARD,
        value: 'var(--ui-pad)',
        reads: [{ prop: '--ui-pad', rule: CARD, value: '1px' }],
      },
    ])
    expect(uses({ color: 'var(--ui-gap)' }, ancestors)[0]?.reads).toEqual([
      { prop: '--ui-gap', rule: { inline: true, selector: '' }, value: '2px', inherited: true },
    ])
  })

  it('resolves a nested name from the level that declared the name reading it, where substitution happens', () => {
    const ancestors = [
      level(rule('.ui-dark', { '--ui-space': '8px' })),
      level(rule(':root', { '--ui-space': '4px', '--ui-pad': 'calc(var(--ui-space) * 2)' })),
    ]
    expect(uses({ 'padding-left': 'var(--ui-pad) var(--ui-space)' }, ancestors)[0]?.reads).toEqual([
      {
        prop: '--ui-pad',
        rule: ROOT,
        value: 'calc(var(--ui-space) * 2)',
        inherited: true,
        reads: [{ prop: '--ui-space', rule: ROOT, value: '4px', inherited: true }],
      },
      {
        prop: '--ui-space',
        rule: { sheet: 0, selector: '.ui-dark' },
        value: '8px',
        inherited: true,
      },
    ])
  })

  it('stops a registered property that does not inherit at the element, at its initial value when it has one', () => {
    const ancestors = [level(rule(':root', { '--ui-tint': 'red', '--ui-ring': 'blue' }))]
    const registered = {
      cssPropertyRules: [property('--ui-tint', false), property('--ui-ring', false, 'green')],
    }
    expect(
      uses({ color: 'var(--ui-tint) var(--ui-ring)' }, ancestors, registered)[0]?.reads
    ).toEqual([
      { prop: '--ui-tint', rule: { sheet: 0, selector: '@property --ui-tint' } },
      {
        prop: '--ui-ring',
        rule: { sheet: 0, selector: '@property --ui-ring' },
        value: 'green',
        initial: true,
      },
    ])
  })

  it('takes the initial value of a script registration, which has no rule', () => {
    const registered = {
      cssPropertyRegistrations: [
        { propertyName: '--ui-line', initialValue: { text: '2px' }, inherits: true },
      ],
    }
    expect(uses({ color: 'var(--ui-line)' }, [], registered)[0]?.reads).toEqual([
      { prop: '--ui-line', value: '2px', initial: true },
    ])
  })

  it('walks up for inherit, for unset on an inheriting property, and takes the initial value for initial', () => {
    const ancestors = [level(rule(':root', { '--ui-ink': 'red', '--ui-tint': 'blue' }))]
    const registered = { cssPropertyRules: [property('--ui-tint', false, 'green')] }
    const reads = (declarations: Record<string, string>): readonly Chain[] | undefined =>
      uses({ ...declarations, color: 'var(--ui-ink) var(--ui-tint)' }, ancestors, registered)[0]
        ?.reads
    const tint = (value: string, initial?: true): Chain =>
      initial === undefined
        ? { prop: '--ui-tint', rule: ROOT, value, inherited: true }
        : { prop: '--ui-tint', rule: { sheet: 0, selector: '@property --ui-tint' }, value, initial }
    expect(reads({ '--ui-ink': 'inherit', '--ui-tint': 'inherit' })).toEqual([
      inheritedInk(),
      tint('blue'),
    ])
    expect(reads({ '--ui-ink': 'unset', '--ui-tint': 'unset' })).toEqual([
      inheritedInk(),
      tint('green', true),
    ])
    expect(reads({ '--ui-ink': 'initial', '--ui-tint': 'revert' })).toEqual([
      { prop: '--ui-ink' },
      tint('green', true),
    ])
  })

  it('leaves out a name already on the path, and a name nothing declares has no rule or value', () => {
    expect(
      uses({ '--ui-a': 'var(--ui-b)', '--ui-b': 'var(--ui-a)', color: 'var(--ui-a, var(--ui-x))' })
    ).toEqual([
      {
        prop: 'color',
        rule: CARD,
        value: 'var(--ui-a, var(--ui-x))',
        reads: [
          {
            prop: '--ui-a',
            rule: CARD,
            value: 'var(--ui-b)',
            reads: [{ prop: '--ui-b', rule: CARD, value: 'var(--ui-a)' }],
          },
          { prop: '--ui-x' },
        ],
      },
    ])
  })

  it('lets an important token in a lower layer beat a later normal one, read from the value as the browser sends it', () => {
    const ancestors = [
      level(
        rule(':root', { '--ui-edge': '2px !important' }, { layers: [{ text: 'theme' }] }),
        rule(':root', { '--ui-edge': '9px' })
      ),
    ]
    expect(uses({ color: 'var(--ui-edge)' }, ancestors)[0]?.reads).toEqual([
      {
        prop: '--ui-edge',
        rule: { ...ROOT, layer: 'theme', important: true },
        value: '2px',
        inherited: true,
      },
    ])
  })

  it('stops following a chain at the depth limit', () => {
    const own = Object.fromEntries(
      Array.from({ length: VAR_DEPTH_LIMIT + 4 }, (_, i) => [
        `--ui-v${String(i)}`,
        `var(--ui-v${String(i + 1)})`,
      ])
    )
    let chain = uses({ ...own, color: 'var(--ui-v0)' })[0]
    let depth = 0
    while (chain?.reads !== undefined) {
      chain = chain.reads[0]
      depth++
    }
    expect(depth).toBe(VAR_DEPTH_LIMIT)
  })

  it('writes every entry once, after the entries it reads, and shares it between longhands', () => {
    const table = new RuleTable()
    const matched: MatchedStyles = {
      matchedCSSRules: [
        rule('.ui-card', { color: 'var(--ui-ink)', 'padding-left': 'var(--ui-ink)' }),
      ],
      inherited: [level(rule(':root', { '--ui-ink': 'var(--ui-base)', '--ui-base': 'red' }))],
    }
    attributeDocument([{ nodes: [0], matched }], table, CONTEXT, () => ({
      writingMode: 'horizontal-tb',
      direction: 'ltr',
    }))
    expect(table.declarations.entries.map((entry) => [entry.prop, entry.reads])).toEqual([
      ['--ui-base', undefined],
      ['--ui-ink', [0]],
      ['color', [1]],
      ['padding-left', [1]],
    ])
    expect(table.uses).toEqual([[2, 3]])
  })
})

function inheritedInk(): Chain {
  return { prop: '--ui-ink', rule: ROOT, value: 'red', inherited: true }
}
