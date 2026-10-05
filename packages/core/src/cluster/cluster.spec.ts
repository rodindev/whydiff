import fc from 'fast-check'

import type { RuleV1 } from '../snapshot/types.js'
import { validateSnapshot } from '../snapshot/validate.js'
import {
  button,
  customProperties,
  hoverRebuild,
  page,
  ruleFamilies,
  ruleLayerMix,
  ruleMove,
  ruleScreen,
  ruleTwoLayers,
  SCREEN_PROPS,
  screenOf,
  styleRow,
  type Attributed,
} from '../testing/screens.js'
import type { TreeSpec } from '../testing/snapshots.js'
import { clusterCauses } from './cluster.js'
import type { ScreenCauses } from './types.js'

describe('clusterCauses', () => {
  const padded = (name: string, text: string, to: string): ScreenCauses =>
    screenOf(name, page([button(10, {}, text)]), page([button(10, { 'padding-left': to }, text)]), [
      [10, 10, 80, 30],
    ])
  const summaryOf = (screens: ScreenCauses[]) => clusterCauses(screens).clusters[0]?.summary

  it('groups identical changes at level 1, similar ones at level 2, and leaves singletons alone', () => {
    const { clusters, rulesVersion } = clusterCauses([
      padded('s1', 'Save it', '8px'),
      padded('s2', 'Cancel it', '8px'),
      padded('s3', 'Reset it', '12px'),
      screenOf(
        's4',
        page([button(10, {}, 'Lonely one')]),
        page([button(10, { color: 'rgb(9, 9, 9)' }, 'Lonely one')]),
        [[10, 10, 80, 30]]
      ),
    ])
    expect(rulesVersion).toBe('k1')
    expect(clusters.map((c) => [c.alias, c.level, c.kind, c.members.map((m) => m.screen)])).toEqual(
      [
        ['c01', 1, 'ui-btn', ['s1', 's2']],
        ['c02', 1, 'ui-btn', ['s4']],
        ['c03', 1, 'ui-btn', ['s3']],
      ]
    )
    expect(clusters[0]?.summary).toEqual({
      kind: 'style',
      changes: [{ prop: 'padding-left', from: '0', to: '8px' }],
    })
  })

  it('falls back to the parameter level when exact values differ but the shape repeats', () => {
    const { clusters } = clusterCauses([
      padded('s1', 'Save it', '8px'),
      padded('s2', 'Cancel it', '12px'),
      padded('s3', 'Reset it', '12px'),
      padded('s4', 'Other one', '16px'),
    ])
    expect(clusters.map((c) => [c.level, c.key, c.members.length])).toEqual([
      [3, 'k1|ui-btn|style|padding-left', 2],
      [1, 'k1|ui-btn|style|padding-left=0>12px', 2],
    ])
  })

  it('keeps ids stable when screens are added and renumbers only aliases', () => {
    const first = clusterCauses([padded('s1', 'Save it', '8px'), padded('s2', 'Cancel it', '8px')])
    const second = clusterCauses([
      padded('s1', 'Save it', '8px'),
      padded('s2', 'Cancel it', '8px'),
      padded('s3', 'A', '20px'),
      padded('s4', 'B', '20px'),
      padded('s5', 'C', '20px'),
    ])
    const padded8 = (clusters: typeof first.clusters) =>
      clusters.find((c) => c.key.endsWith('0>8px'))
    expect(padded8(second.clusters)?.id).toBe(padded8(first.clusters)?.id)
    expect(padded8(first.clusters)?.alias).toBe('c01')
    expect(padded8(second.clusters)?.alias).toBe('c02')
  })

  it('does not change with the order of screens', () => {
    const screens = [
      padded('s1', 'Save it', '8px'),
      padded('s2', 'Cancel it', '8px'),
      padded('s3', 'Reset it', '12px'),
    ]
    fc.assert(
      fc.property(fc.shuffledSubarray(screens, { minLength: 3 }), (shuffled) => {
        expect(clusterCauses(shuffled)).toEqual(clusterCauses(screens))
      })
    )
  })

  it('pins a whole run as a golden', async () => {
    const run = clusterCauses([
      padded('s1', 'Save it', '8px'),
      padded('s2', 'Cancel it', '8px'),
      padded('s3', 'Reset it', '12px'),
      screenOf(
        's4',
        page([button(10, {}, 'Lonely one')]),
        page([button(10, { color: 'rgb(9, 9, 9)' }, 'Lonely one')]),
        [[10, 10, 80, 30]]
      ),
    ])
    await expect(`${JSON.stringify(run, null, 2)}\n`).toMatchFileSnapshot(
      '../../fixtures/cluster/run/clusters.json'
    )
  })

  it('keeps elements no class names apart by the classes styling their box, and their text variants together', () => {
    const side = (row: number[]): Attributed => ({
      sheets: [{ href: 'http://app.test/app.css', hash: 'app1' }],
      rules: [
        { sheet: 0, selector: '.chip' },
        { sheet: 0, selector: '.head' },
        { sheet: 0, selector: '.ink-x' },
      ],
      attributions: [styleRow().map(() => -1), row],
    })
    const retexted = (name: string, cls: string[], row: number[]): ScreenCauses => {
      const box: TreeSpec['box'] = [10, 10, 80, 30]
      return screenOf(
        name,
        page([{ tag: 'div', cls, text: 'Before', box, style: styleRow(), a: 1 }]),
        page([{ tag: 'div', cls, text: 'After', box, style: styleRow(), a: 1 }]),
        [[10, 10, 80, 30]],
        { before: side(row), after: side(row) }
      )
    }
    const { clusters } = clusterCauses([
      retexted('s1', ['chip'], [-1, 0, -1, -1]),
      retexted('s2', ['head'], [1, -1, -1, -1]),
      retexted('s3', ['chip', 'ink-x'], [-1, 0, 2, -1]),
    ])
    expect(clusters.map((c) => [c.key, c.members.map((m) => m.screen)])).toEqual([
      ['k1|div.chip|content:text', ['s1', 's3']],
      ['k1|div.head|content:text', ['s2']],
    ])
  })

  it('groups a change on a library component across its elements, though an app also names some', () => {
    const library: TreeSpec[] = [
      { tag: 'ul', cls: ['ui-list', 'ui-list--dense'], box: [0, 200, 100, 20], style: styleRow() },
      { tag: 'li', cls: ['ui-list__item'], box: [0, 220, 100, 20], style: styleRow() },
    ]
    const recolored = (name: string, cls: string[]): ScreenCauses => {
      const title = (color: string): TreeSpec => ({
        tag: 'div',
        cls,
        text: 'Title',
        box: [10, 10, 80, 30],
        style: styleRow({ color }),
      })
      return screenOf(
        name,
        page([...library, title('rgb(0, 0, 0)')]),
        page([...library, title('rgb(9, 9, 9)')]),
        [[10, 10, 80, 30]]
      )
    }
    const { clusters } = clusterCauses([
      recolored('s1', ['ui-list-title']),
      recolored('s2', ['ui-list-title', 'x__name']),
      recolored('s3', ['ui-list-title', 'brand']),
    ])
    expect(clusters.map((c) => [c.key, c.members.map((m) => m.screen)])).toEqual([
      ['k1|ui-list-title|style|color=rgb(0, 0, 0)>rgb(9, 9, 9)', ['s1', 's2', 's3']],
    ])
  })

  it('groups causes by the rule that wins at level 0, across component kinds and values', () => {
    const { clusters } = clusterCauses(ruleFamilies())
    expect(clusters.map((c) => [c.level, c.kind, c.key, c.members.map((m) => m.screen)])).toEqual([
      [0, 'rule', 'k1|rule|reset.css|*|', ['s1', 's2', 's3']],
      [0, 'rule', 'k1|rule|framework.css|.ui-col-12, .ui-col-6, .ui-col|', ['s4', 's5']],
    ])
    expect(clusters[0]?.summary).toEqual({
      kind: 'rule',
      selector: '*',
      sheet: 'reset.css',
      sets: ['color', 'font-weight', 'padding-left'],
      changed: [],
      unsets: [],
      values: [
        { prop: 'color', from: 'rgb(0, 0, 255)', to: 'rgb(0, 0, 0)' },
        { prop: 'font-weight', from: '700', to: '400' },
        { prop: 'padding-left', from: '8px', to: '0px' },
      ],
    })
    expect(clusters[1]?.summary).toEqual({
      kind: 'rule',
      selector: '.ui-col-12, .ui-col-6, .ui-col',
      sheet: 'framework.css',
      layer: 'framework.components',
      sets: ['padding-left'],
      changed: [],
      unsets: [],
      values: [],
      over: { selector: '.ui-col', sheet: 'app.css' },
    })
  })

  it('files removed declarations under the rule that set them, across a rebuilt sheet and a layer move', () => {
    const { clusters } = clusterCauses(ruleMove())
    expect(clusters.map((c) => [c.level, c.key, c.members.map((m) => m.screen)])).toEqual([
      [0, 'k1|rule|framework-*.css|.ui-col|', ['s1', 's2', 's3', 's4']],
    ])
    expect(clusters[0]?.summary).toEqual({
      kind: 'rule',
      selector: '.ui-col',
      sheet: 'framework-*.css',
      layer: 'framework.components',
      sets: ['font-weight'],
      changed: ['color'],
      unsets: ['padding-left'],
      values: [
        { prop: 'color', from: 'rgb(0, 0, 255)', to: 'rgb(255, 0, 0)' },
        { prop: 'font-weight', from: '400', to: '700' },
      ],
      layerTo: 'framework.components',
    })
  })

  it('keeps one cause for a rule that now sets a longhand on some screens and no longer sets it on another, across a rebuild of two sheets that read the same', () => {
    const { clusters } = clusterCauses(hoverRebuild())
    expect(clusters.map((c) => [c.level, c.key, c.members.map((m) => m.screen)])).toEqual([
      [0, 'k1|rule|index-*.css|.ui-btn:hover|', ['s1', 's2', 's3']],
    ])
    expect(clusters[0]?.summary).toEqual({
      kind: 'rule',
      selector: '.ui-btn:hover',
      sheet: 'index-*.css',
      sets: ['color'],
      changed: [],
      unsets: ['color'],
      values: [],
      mixed: [{ prop: 'color', sets: 2, changed: 0, unsets: 1 }],
    })
  })

  it('names the rule lost to from the members that set a longhand, beside members that unset one', () => {
    const only = (column: number, rule: number): number[] =>
      styleRow().map((_, i) => (i === column ? rule : -1))
    const sheets = [
      { href: 'http://app.test/app.css', hash: 'app1' },
      { href: 'http://app.test/framework.css', hash: 'fw1' },
    ]
    const side = (rules: Attributed['rules'], attributions: number[][]): Attributed => ({
      sheets,
      rules,
      attributions,
    })
    const before = side(
      [
        { sheet: 0, selector: '.ui-btn' },
        { sheet: 1, selector: '.ui-btn' },
      ],
      [only(-1, -1), only(1, 0), only(2, 1)]
    )
    const after = side(
      [{ sheet: 1, selector: '.ui-btn' }],
      [only(-1, -1), only(1, 0), only(-1, -1)]
    )
    const { clusters } = clusterCauses([
      screenOf(
        's1',
        page([button(10, { 'padding-left': '4px' }, 'Save it', { a: 1 })]),
        page([button(10, { 'padding-left': '8px' }, 'Save it', { a: 1 })]),
        [[10, 10, 80, 30]],
        { before, after }
      ),
      screenOf(
        's2',
        page([button(10, { color: 'rgb(0, 0, 255)' }, 'Cancel it', { a: 2 })]),
        page([button(10, {}, 'Cancel it', { a: 2 })]),
        [[10, 10, 80, 30]],
        { before, after }
      ),
    ])
    expect(clusters.map((c) => [c.key, c.summary])).toEqual([
      [
        'k1|rule|framework.css|.ui-btn|',
        {
          kind: 'rule',
          selector: '.ui-btn',
          sheet: 'framework.css',
          sets: ['padding-left'],
          changed: [],
          unsets: ['color'],
          values: [
            { prop: 'color', from: 'rgb(0, 0, 255)', to: 'rgb(0, 0, 0)' },
            { prop: 'padding-left', from: '4px', to: '8px' },
          ],
          over: { selector: '.ui-btn', sheet: 'app.css' },
        },
      ],
    ])
  })

  it('files removed declarations alone under the rule that set them, named and moved as the after side has it', () => {
    const [s1, s2] = ruleMove()
    if (s1 === undefined || s2 === undefined) throw new Error('ruleMove has four screens')
    expect(clusterCauses([s1, s2]).clusters.map((c) => [c.level, c.key, c.summary])).toEqual([
      [
        0,
        'k1|rule|framework-*.css|.ui-col|',
        {
          kind: 'rule',
          selector: '.ui-col',
          sheet: 'framework-*.css',
          layer: 'framework.components',
          sets: [],
          changed: [],
          unsets: ['padding-left'],
          values: [],
          layerTo: 'framework.components',
        },
      ],
    ])
  })

  it('files a change that came through custom properties under the rule that changed them, once per rule across screens', () => {
    const screens = customProperties()
    for (const screen of screens) {
      expect(validateSnapshot(screen.before)).toEqual(screen.before)
      expect(validateSnapshot(screen.after)).toEqual(screen.after)
    }
    const rules = clusterCauses(screens).clusters.flatMap((c) =>
      c.summary.kind === 'rule' ? [c.summary] : []
    )
    const named = (selector: string) => rules.find((rule) => rule.selector === selector)
    expect(rules.map((rule) => rule.selector).sort()).toEqual(
      [
        '*, ::before, ::after',
        ':root',
        ':root, :host',
        '.ui-card',
        '.ui-reset .ui-btn',
        '@property --ui-border-style',
        '',
      ].sort()
    )
    expect(named(':root, :host')).toMatchObject({
      changed: ['--ui-space'],
      vars: [
        {
          name: '--ui-space',
          from: '4px',
          to: '5px',
          readBy: ['padding-bottom', 'padding-left', 'padding-right', 'padding-top', 'row-gap'],
        },
      ],
    })
    expect(named('.ui-card')).toMatchObject({
      sets: ['box-shadow'],
      over: { selector: '.ui-elevated', sheet: 'app.css' },
      via: [
        {
          name: '--ui-shadow',
          rule: { selector: '.ui-elevated', sheet: 'app.css' },
          readBy: ['box-shadow'],
        },
      ],
    })
    expect(named(':root')).toMatchObject({
      unsets: ['--ui-gap'],
      vars: [{ name: '--ui-gap', from: '4px', readBy: ['column-gap'], missing: 'fallback' }],
    })
    expect(named('*, ::before, ::after')?.vars).toEqual([
      { name: '--ui-glow', to: '0 1px 2px #0003', readBy: ['box-shadow'], missing: 'invalid' },
      { name: '--ui-ring', to: '0 0 #0000', readBy: ['box-shadow'], missing: 'invalid' },
    ])
    expect(named('')).toMatchObject({
      sheet: 'style attribute of an ancestor',
      changed: ['--ui-surface'],
      vars: [{ name: '--ui-surface', from: '#353535', to: '#ffffff' }],
    })
    expect(named('@property --ui-border-style')).toMatchObject({
      unsets: ['--ui-border-style'],
      vars: [{ name: '--ui-border-style', from: 'solid', missing: 'invalid' }],
    })
    expect(named('.ui-reset .ui-btn')).toMatchObject({
      sets: ['border-bottom-width', 'border-left-width', 'border-right-width', 'border-top-width'],
      over: { selector: 'button', sheet: 'user agent stylesheet', userAgent: true },
      defaults: ['bottom', 'left', 'right', 'top'].map((side) => ({
        prop: `border-${side}-width`,
        value: '2px',
      })),
    })
    expect(rules.map((rule) => rule.selector)).not.toContain('.ui-panel')
  })

  it('keeps a longhand on the rule that wins it where a side lists no declarations', () => {
    const screens = customProperties().map((screen) => ({
      ...screen,
      deltas: {
        ...screen.deltas,
        pairs: screen.deltas.pairs.map((pair) => ({
          ...pair,
          style: pair.style.map(({ prop, from, to, derived, rule }) => ({
            prop,
            from,
            to,
            ...(derived === undefined ? {} : { derived }),
            ...(rule === undefined ? {} : { rule }),
          })),
        })),
      },
    }))
    const rules = clusterCauses(screens).clusters.flatMap((c) =>
      c.summary.kind === 'rule' ? [c.summary] : []
    )
    expect(rules.find((rule) => rule.selector === '.ui-panel')?.changed).toEqual([
      'padding-bottom',
      'padding-left',
      'padding-right',
      'padding-top',
      'row-gap',
    ])
    expect(rules.some((rule) => (rule.vars ?? []).length > 0)).toBe(false)
  })

  it('files custom properties the same whatever the order of the screens', () => {
    const screens = customProperties()
    expect(clusterCauses([...screens].reverse())).toEqual(clusterCauses(screens))
  })

  it('names the same rule whatever the order of the screens', () => {
    const screens = ruleLayerMix()
    fc.assert(
      fc.property(fc.shuffledSubarray(screens, { minLength: 3 }), (shuffled) => {
        expect(clusterCauses(shuffled)).toEqual(clusterCauses(screens))
      })
    )
  })

  it('keeps apart a selector the sheet holds in a layer and unlayered, so the unlayered rule wins over the layered one', () => {
    const { clusters } = clusterCauses(ruleTwoLayers())
    expect(clusters.map((c) => [c.level, c.key, c.members.map((m) => m.screen)])).toEqual([
      [0, 'k1|rule|app.css|body||unlayered', ['s1', 's2']],
    ])
    expect(clusters[0]?.summary).toEqual({
      kind: 'rule',
      selector: 'body',
      sheet: 'app.css',
      sets: ['color'],
      changed: [],
      unsets: [],
      values: [{ prop: 'color', from: 'rgb(0, 0, 0)', to: 'rgb(9, 9, 9)' }],
      over: { selector: 'body', sheet: 'app.css', layer: 'base' },
    })
  })

  it('names the rule as an after side has it, the first layer by name, and no move members disagree on', () => {
    const { clusters } = clusterCauses(ruleLayerMix())
    expect(clusters.map((c) => [c.level, c.key, c.members.map((m) => m.screen)])).toEqual([
      [0, 'k1|rule|framework-*.css|.ui-col|', ['s1', 's2', 's3']],
    ])
    expect(clusters[0]?.summary).toEqual({
      kind: 'rule',
      selector: '.ui-col',
      sheet: 'framework-*.css',
      layer: 'framework.base',
      sets: [],
      changed: ['color', 'padding-left'],
      unsets: ['font-weight'],
      values: [
        { prop: 'color', from: 'rgb(0, 0, 255)', to: 'rgb(255, 0, 0)' },
        { prop: 'font-weight', from: '700', to: '400' },
        { prop: 'padding-left', from: '12px', to: '4px' },
      ],
    })
  })

  it('reports a move only when every member saw the rule on both sides in the same two layers', () => {
    const [moved, same, gone] = ruleLayerMix()
    if (moved === undefined || same === undefined || gone === undefined) {
      throw new Error('ruleLayerMix has three screens')
    }
    expect(summaryOf([moved, same])).not.toHaveProperty('layerTo')
    expect(summaryOf([moved, gone])).not.toHaveProperty('layerTo')
    const side = (layer?: string): Attributed => ({
      sheets: [{ href: 'http://app.test/framework.css', hash: 'fw1' }],
      rules: [{ sheet: 0, selector: '.ui-col', ...(layer === undefined ? {} : { layer }) }],
      attributions: [styleRow().map(() => -1), styleRow().map((_, i) => (i === 1 ? 0 : -1))],
    })
    const out = ruleScreen(side('framework.components'), side())
    expect(
      summaryOf([
        out('s1', 'div', 'ui-col', 'Col', 1, { 'padding-left': '12px' }, { 'padding-left': '4px' }),
        out('s2', 'div', 'ui-col', 'Col two', 1, { 'padding-left': '16px' }, {}),
      ])
    ).toEqual({
      kind: 'rule',
      selector: '.ui-col',
      sheet: 'framework.css',
      sets: [],
      changed: ['padding-left'],
      unsets: [],
      values: [],
      layerFrom: 'framework.components',
    })
  })

  it('names the rule lost to only when every member lost to it in the same layer', () => {
    const sheets = [
      { href: 'http://app.test/app.css', hash: 'app1' },
      { href: 'http://app.test/framework.css', hash: 'fw1' },
    ]
    const padding = styleRow().map((_, i) => (i === 1 ? 0 : -1))
    const side = (sheet: number, layer?: string): Attributed => ({
      sheets,
      rules: [{ sheet, selector: '.ui-btn', ...(layer === undefined ? {} : { layer }) }],
      attributions: [styleRow().map(() => -1), padding],
    })
    const screen = (name: string, layer?: string) =>
      ruleScreen(side(0, layer), side(1))(
        name,
        'button',
        'ui-btn',
        `Save ${name}`,
        1,
        { 'padding-left': '4px' },
        { 'padding-left': '8px' }
      )
    expect(summaryOf([screen('s1'), screen('s2')])).toHaveProperty('over', {
      selector: '.ui-btn',
      sheet: 'app.css',
    })
    expect(summaryOf([screen('s1'), screen('s2', 'base')])).not.toHaveProperty('over')
  })

  it('reads the same rule on both sides as a changed declaration and names a lone rule in a cluster of its own', () => {
    const side: Attributed = {
      sheets: [{ href: 'http://app.test/app.css', hash: 'app1' }],
      rules: [{ sheet: 0, selector: '.ui-btn' }],
      attributions: [styleRow().map(() => -1), styleRow().map((_, i) => (i === 1 ? 0 : -1))],
    }
    const attributed = (name: string, text: string, to: string): ScreenCauses =>
      screenOf(
        name,
        page([button(10, {}, text, { a: 1 })]),
        page([button(10, { 'padding-left': to }, text, { a: 1 })]),
        [[10, 10, 80, 30]],
        { before: side, after: side }
      )
    const { clusters } = clusterCauses([
      attributed('s1', 'Save it', '8px'),
      attributed('s2', 'Cancel it', '12px'),
      padded('s3', 'Reset it', '12px'),
      padded('s4', 'Other one', '12px'),
    ])
    expect(clusters.map((c) => [c.level, c.key, c.members.map((m) => m.screen)])).toEqual([
      [0, 'k1|rule|app.css|.ui-btn|', ['s1', 's2']],
      [1, 'k1|ui-btn|style|padding-left=0>12px', ['s3', 's4']],
    ])
    expect(clusters[0]?.summary).toEqual({
      kind: 'rule',
      selector: '.ui-btn',
      sheet: 'app.css',
      sets: [],
      changed: ['padding-left'],
      unsets: [],
      values: [],
    })
    const display: Attributed = {
      ...side,
      attributions: [styleRow().map(() => -1), styleRow().map((_, i) => (i === 0 ? 0 : -1))],
    }
    const lone = clusterCauses([
      attributed('s1', 'Save it', '8px'),
      screenOf(
        's2',
        page([button(10, {}, 'Cancel it', { a: 1 })]),
        page([button(10, { 'padding-left': '8px' }, 'Cancel it', { a: 1 })]),
        [[10, 10, 80, 30]],
        { before: display, after: display }
      ),
    ])
    expect(lone.clusters.map((c) => [c.level, c.key, c.members.map((m) => m.screen)])).toEqual([
      [1, 'k1|button.ui-btn|style|padding-left=0>8px', ['s2']],
      [0, 'k1|rule|app.css|.ui-btn|', ['s1']],
    ])
    expect(lone.clusters[1]?.id).toBe(clusters[0]?.id)
  })

  it('reads letter-spacing in em that followed a new font-size as no change of its rule', () => {
    const props = ['display', 'font-size', 'letter-spacing']
    const side = (font: RuleV1): Attributed => ({
      sheets: [{ href: 'http://app.test/app.css', hash: 'app1' }],
      rules: [font, { sheet: 0, selector: '.ui-caps' }],
      attributions: [props.map(() => -1), [-1, 0, 1]],
    })
    const label = (name: string, text: string): ScreenCauses => {
      const root: Pick<TreeSpec, 'box' | 'style'> = {
        box: [0, 0, 1000, 800],
        style: ['block', '16px', 'normal'],
      }
      const tree = (size: string, spacing: string): TreeSpec[] => [
        {
          tag: 'html',
          ...root,
          children: [
            {
              tag: 'body',
              ...root,
              children: [
                {
                  tag: 'p',
                  cls: ['ui-label', 'ui-caps'],
                  text,
                  box: [10, 10, 80, 30],
                  style: ['block', size, spacing],
                  a: 1,
                },
              ],
            },
          ],
        },
      ]
      return screenOf(name, tree('14px', '1.4px'), tree('28px', '2.8px'), [[10, 10, 80, 30]], {
        props,
        before: side({ sheet: 0, selector: '.ui-label' }),
        after: side({ inline: true, selector: '' }),
      })
    }
    const { clusters } = clusterCauses([label('s1', 'Team'), label('s2', 'Pricing')])
    expect(clusters.map((c) => [c.key, c.summary])).toEqual([
      [
        'k1|rule|inline||',
        {
          kind: 'rule',
          selector: '',
          sheet: 'style attribute',
          sets: ['font-size'],
          changed: [],
          unsets: [],
          values: [{ prop: 'font-size', from: '14px', to: '28px' }],
          over: { selector: '.ui-label', sheet: 'app.css' },
        },
      ],
    ])
  })

  describe('a node under every rule its changes belong to', () => {
    const sheets = [
      { href: 'http://app.test/app.css', hash: 'app1' },
      { href: 'http://app.test/reset.css', hash: 'reset1' },
    ]
    const rules = [
      { sheet: 1, selector: '*' },
      { sheet: 0, selector: '.ui-btn' },
      { sheet: 0, selector: '.ui-tone' },
    ]
    const before: Attributed = { sheets, rules, attributions: [styleRow().map(() => -1)] }
    const after: Attributed = {
      sheets,
      rules,
      attributions: [styleRow().map(() => -1), [-1, 0, 1, -1], [-1, 0, 2, -1], [-1, 0, -1, -1]],
    }
    const changed = { 'padding-left': '8px', color: 'rgb(9, 9, 9)' }
    const screen = ruleScreen(before, after)

    it('is a member of the cluster of each rule, its pixels shared between them', () => {
      const { clusters } = clusterCauses([
        screen('s1', 'button', 'ui-btn', 'Save it', 1, {}, changed),
        screen('s2', 'button', 'ui-btn', 'Cancel it', 1, {}, changed),
      ])
      expect(
        clusters.map((c) => [c.key, c.summary, c.members.map((m) => [m.screen, m.pixels])])
      ).toEqual([
        [
          'k1|rule|app.css|.ui-btn|',
          {
            kind: 'rule',
            selector: '.ui-btn',
            sheet: 'app.css',
            sets: ['color'],
            changed: [],
            unsets: [],
            values: [{ prop: 'color', from: 'rgb(0, 0, 0)', to: 'rgb(9, 9, 9)' }],
          },
          [
            ['s1', 1200],
            ['s2', 1200],
          ],
        ],
        [
          'k1|rule|reset.css|*|',
          {
            kind: 'rule',
            selector: '*',
            sheet: 'reset.css',
            sets: ['padding-left'],
            changed: [],
            unsets: [],
            values: [{ prop: 'padding-left', from: '0px', to: '8px' }],
          },
          [
            ['s1', 1200],
            ['s2', 1200],
          ],
        ],
      ])
    })

    it('names a rule that does not repeat in a cluster of its own, beside the rule that does', () => {
      const { clusters } = clusterCauses([
        screen('s1', 'button', 'ui-btn', 'Save it', 2, {}, changed),
        screen('s2', 'button', 'ui-btn', 'Cancel it', 3, {}, { 'padding-left': '8px' }),
        screenOf(
          's3',
          page([button(10, {}, 'Reset it')]),
          page([button(10, { color: 'rgb(9, 9, 9)' }, 'Reset it')]),
          [[10, 10, 80, 30]],
          { before, after }
        ),
      ])
      expect(
        clusters.map((c) => [c.level, c.key, c.members.map((m) => [m.screen, m.pixels])])
      ).toEqual([
        [
          0,
          'k1|rule|reset.css|*|',
          [
            ['s1', 1200],
            ['s2', 2400],
          ],
        ],
        [1, 'k1|button|style|color=rgb(0, 0, 0)>rgb(9, 9, 9)', [['s3', 2400]]],
        [0, 'k1|rule|app.css|.ui-tone|', [['s1', 1200]]],
      ])
    })

    const RULE_CHOICES = [-1, 0, 1, 2]
    const element = fc.record({
      props: fc.subarray(['padding-left', 'color', 'font-weight'], { minLength: 1 }),
      from: fc.tuple(...SCREEN_PROPS.map(() => fc.constantFrom(...RULE_CHOICES))),
      to: fc.tuple(...SCREEN_PROPS.map(() => fc.constantFrom(...RULE_CHOICES))),
      width: fc.integer({ min: 3, max: 90 }),
      height: fc.integer({ min: 3, max: 31 }),
    })
    type Element = typeof element extends fc.Arbitrary<infer T> ? T : never
    const VALUES: Record<string, string> = {
      'padding-left': '8px',
      color: 'rgb(9, 9, 9)',
      'font-weight': '700',
    }
    const screenFrom = (name: string, elements: readonly Element[]): ScreenCauses => {
      const tree = (changed: boolean): TreeSpec[] =>
        page(
          elements.map((e, i) => ({
            tag: 'button',
            cls: ['ui-btn'],
            text: `Item ${name} ${String(i)}`,
            box: [10 + 100 * i, 10, e.width, e.height],
            style: styleRow(
              changed ? Object.fromEntries(e.props.map((p) => [p, VALUES[p] ?? ''])) : {}
            ),
            a: i + 1,
          }))
        )
      const side = (pick: (e: Element) => readonly number[]): Attributed => ({
        sheets,
        rules,
        attributions: [styleRow().map(() => -1), ...elements.map((e) => [...pick(e)])],
      })
      return screenOf(
        name,
        tree(false),
        tree(true),
        elements.map((e, i) => [10 + 100 * i, 10, e.width, e.height]),
        { before: side((e) => e.from), after: side((e) => e.to) }
      )
    }
    let pool: ScreenCauses[] = []
    beforeAll(() => {
      pool = fc
        .sample(fc.array(element, { minLength: 1, maxLength: 3 }), { numRuns: 16, seed: 3 })
        .map((elements, i) => screenFrom(`p${String(i)}`, elements))
    })
    const run = fc.array(fc.nat({ max: 15 }), { minLength: 1, maxLength: 6 }).chain((picks) =>
      fc.tuple(
        fc.constant(picks),
        fc.shuffledSubarray([...picks.keys()], { minLength: picks.length }),
        fc.array(fc.shuffledSubarray([0, 1, 2], { minLength: 3 }), {
          minLength: picks.length,
          maxLength: picks.length,
        })
      )
    )
    const screensOf = (picks: readonly number[]): ScreenCauses[] =>
      picks.flatMap((pick, i) => {
        const screen = pool[pick]
        return screen === undefined ? [] : [{ ...screen, screen: `s${String(i + 1)}` }]
      })
    const occurrence = (screen: string, cause: number): string => `${screen}#${String(cause)}`
    const expectWithinAPixel = (screens: readonly ScreenCauses[]): Map<string, number[]> => {
      const exact = new Map<string, number>()
      for (const s of screens) {
        for (const r of s.explanation.regions) {
          for (const id of r.causes) {
            const key = occurrence(s.screen, id)
            exact.set(key, (exact.get(key) ?? 0) + r.region.pixels / r.causes.length)
          }
        }
      }
      const shares = new Map<string, number[]>()
      const { clusters } = clusterCauses(screens)
      for (const cluster of [...clusters].sort((a, b) => (a.key < b.key ? -1 : 1))) {
        for (const m of cluster.members) {
          const key = occurrence(m.screen, m.cause)
          shares.set(key, [...(shares.get(key) ?? []), m.pixels])
        }
      }
      expect([...shares.keys()].sort()).toEqual([...exact.keys()].sort())
      for (const [key, list] of shares) {
        const pixels = list.reduce((a, b) => a + b)
        expect(Math.abs(pixels - (exact.get(key) ?? Number.NaN))).toBeLessThan(1)
      }
      return shares
    }

    it('shares the pixels of each member among its clusters in integers that add up, the larger shares first by key', () => {
      let shared = 0
      fc.assert(
        fc.property(run, ([picks]) => {
          const shares = expectWithinAPixel(screensOf(picks))
          for (const list of shares.values()) {
            expect(list).toEqual([...list].sort((a, b) => b - a))
            expect(Math.max(...list) - Math.min(...list)).toBeLessThanOrEqual(1)
            if (list.length > 1) shared++
          }
        })
      )
      expect(shared).toBeGreaterThan(0)
    })

    it('adds the pixels of the clusters up to the pixels of the regions with a cause, whatever the regions', () => {
      const regions = fc.array(
        fc.array(fc.tuple(fc.nat({ max: 10_000 }), fc.nat({ max: 7 })), { maxLength: 5 }),
        { minLength: 6, maxLength: 6 }
      )
      fc.assert(
        fc.property(run, regions, ([picks], specs) => {
          const screens = screensOf(picks).map((s, i): ScreenCauses => {
            const ids = s.explanation.causes.map((c) => c.id)
            const drawn = (specs[i] ?? []).map(([pixels, mask]) => ({
              region: { x: 0, y: 0, width: 1, height: 1, pixels },
              causes: ids.filter((_, bit) => ((mask >> bit) & 1) === 1),
              candidates: [],
            }))
            return { ...s, explanation: { ...s.explanation, regions: drawn } }
          })
          const explained = screens
            .flatMap((s) => s.explanation.regions)
            .filter((r) => r.causes.length > 0)
            .reduce((sum, r) => sum + r.region.pixels, 0)
          const { clusters } = clusterCauses(screens)
          expect(clusters.reduce((sum, c) => sum + c.pixels, 0)).toBe(explained)
          expectWithinAPixel(screens)
        })
      )
    })

    it('lists every changed longhand that points at a rule in a cluster the member belongs to', () => {
      fc.assert(
        fc.property(run, ([picks]) => {
          const screens = screensOf(picks)
          const listed = new Map<string, Set<string>>()
          for (const cluster of clusterCauses(screens).clusters) {
            const { summary } = cluster
            const props =
              summary.kind === 'rule'
                ? [...summary.sets, ...summary.changed, ...summary.unsets]
                : 'changes' in summary
                  ? summary.changes.map((c) => c.prop)
                  : []
            for (const m of cluster.members) {
              const key = occurrence(m.screen, m.cause)
              listed.set(key, new Set([...(listed.get(key) ?? []), ...props]))
            }
          }
          for (const s of screens) {
            for (const cause of s.explanation.causes) {
              const { node } = cause
              if (!('before' in node) || !listed.has(occurrence(s.screen, cause.id))) continue
              const pair = s.deltas.pairs.find((p) => p.before === node.before)
              const ruled = (pair?.style ?? []).filter(
                (c) =>
                  c.derived === undefined &&
                  ((c.rule?.from ?? null) !== null || (c.rule?.to ?? null) !== null)
              )
              for (const c of ruled) {
                expect(listed.get(occurrence(s.screen, cause.id))).toContain(c.prop)
              }
            }
          }
        })
      )
    })

    it('puts a member under the same rule causes whether the run is clustered whole or in shards united by id', () => {
      const ruled = (screens: readonly ScreenCauses[]): Map<string, string[]> => {
        const out = new Map<string, string[]>()
        for (const c of clusterCauses(screens).clusters.filter((c) => c.level === 0)) {
          for (const m of c.members) {
            const key = occurrence(m.screen, m.cause)
            out.set(key, [...(out.get(key) ?? []), c.id].sort())
          }
        }
        return out
      }
      fc.assert(
        fc.property(run, fc.integer({ min: 2, max: 3 }), ([picks], shards) => {
          const screens = screensOf(picks)
          const united = new Map(
            Array.from({ length: shards }, (_, i) =>
              screens.filter((_, j) => j % shards === i)
            ).flatMap((part) => [...ruled(part)])
          )
          expect(united).toEqual(ruled(screens))
        })
      )
    })

    it('does not change with the order of screens or of the causes on a screen', () => {
      fc.assert(
        fc.property(run, ([picks, order, causeOrders]) => {
          const screens = screensOf(picks)
          const shuffled = order.flatMap((index) => {
            const s = screens[index]
            if (s === undefined) return []
            const causes = (causeOrders[index] ?? [])
              .map((i) => s.explanation.causes[i])
              .filter((c) => c !== undefined)
            return [{ ...s, explanation: { ...s.explanation, causes } }]
          })
          expect(clusterCauses(shuffled)).toEqual(clusterCauses(screens))
        })
      )
    })
  })

  it('pins a run with rule clusters as a golden', async () => {
    await expect(`${JSON.stringify(clusterCauses(ruleFamilies()), null, 2)}\n`).toMatchFileSnapshot(
      '../../fixtures/cluster/rules/clusters.json'
    )
  })

  it('pins a rule that moved across builds as a golden', async () => {
    await expect(`${JSON.stringify(clusterCauses(ruleMove()), null, 2)}\n`).toMatchFileSnapshot(
      '../../fixtures/cluster/rule-move/clusters.json'
    )
  })

  it('orders clusters by the pixels they explain before the screens they span', () => {
    const wide = (name: string) =>
      screenOf(
        name,
        page([{ tag: 'div', cls: ['hero'], box: [0, 100, 400, 200], style: styleRow() }]),
        page([
          {
            tag: 'div',
            cls: ['hero'],
            box: [0, 100, 400, 200],
            style: styleRow({ color: 'rgb(9, 9, 9)' }),
          },
        ]),
        [[0, 100, 400, 200]]
      )
    const { clusters } = clusterCauses([
      padded('s1', 'Save it', '8px'),
      padded('s2', 'Cancel it', '8px'),
      padded('s3', 'Reset it', '8px'),
      wide('s4'),
    ])
    expect(clusters.map((c) => [c.alias, c.kind, c.screens, c.pixels])).toEqual([
      ['c01', 'hero', 1, 80000],
      ['c02', 'ui-btn', 3, 7200],
    ])
  })

  it('shares a region between the causes that touch it', () => {
    const { clusters } = clusterCauses([
      screenOf(
        's1',
        page([button(10, {}, 'Save it'), { ...button(10, {}, 'Again'), box: [10, 10, 80, 30] }]),
        page([
          button(10, { 'padding-left': '8px' }, 'Save it'),
          { ...button(10, { color: 'rgb(9, 9, 9)' }, 'Again'), box: [10, 10, 80, 30] },
        ]),
        [[10, 10, 80, 30]]
      ),
    ])
    expect(clusters.map((c) => c.pixels)).toEqual([1200, 1200])
  })

  it('rounds the shares of a screen once, the left-over pixels to the lower cause ids', () => {
    const trio = (
      name: string,
      regions: readonly (readonly [number, number[]])[]
    ): ScreenCauses => {
      const screen = screenOf(
        name,
        page([button(10, {}, 'Save it'), button(200, {}, 'Again'), button(400, {}, 'More')]),
        page([
          button(10, { 'padding-left': '8px' }, 'Save it'),
          button(200, { color: 'rgb(9, 9, 9)' }, 'Again'),
          button(400, { 'font-weight': '700' }, 'More'),
        ]),
        [
          [10, 10, 80, 30],
          [200, 10, 80, 30],
          [400, 10, 80, 30],
        ]
      )
      const drawn = regions.map(([pixels, causes]) => ({
        region: { x: 0, y: 0, width: 1, height: 1, pixels },
        causes,
        candidates: [],
      }))
      return { ...screen, explanation: { ...screen.explanation, regions: drawn } }
    }
    const { clusters } = clusterCauses([
      trio('s1', [[100, [0, 1, 2]]]),
      trio('s2', [
        [1, [1, 2]],
        [1, [1, 2]],
      ]),
    ])
    expect(
      Object.fromEntries(
        clusters.flatMap((c) => c.members.map((m) => [`${m.screen}#${String(m.cause)}`, m.pixels]))
      )
    ).toEqual({ 's1#0': 34, 's1#1': 33, 's1#2': 33, 's2#1': 1, 's2#2': 1 })
  })

  it('keeps the platform font pair in a font-metrics key', () => {
    const { clusters } = clusterCauses([
      screenOf(
        's1',
        page([
          {
            tag: 'p',
            cls: ['note'],
            text: 'Same text',
            font: 'Inter-Regular',
            box: [0, 0, 100, 20],
            style: styleRow(),
          },
        ]),
        page([
          {
            tag: 'p',
            cls: ['note'],
            text: 'Same text',
            font: 'NotoSans-Regular',
            box: [0, 0, 112, 20],
            style: styleRow(),
          },
        ]),
        [[0, 0, 112, 20]]
      ),
    ])
    expect(clusters[0]?.key).toBe('k1|note|content:font-metrics|Inter-Regular>NotoSans-Regular')
    expect(clusters[0]?.summary).toEqual({
      kind: 'content',
      detail: 'font-metrics',
      from: 'Inter-Regular',
      to: 'NotoSans-Regular',
    })
  })

  it('clusters only causes that touch a diff region', () => {
    const { clusters } = clusterCauses([
      screenOf(
        's1',
        page([button(10), button(200, {}, 'Far')]),
        page([
          button(10, { 'padding-left': '8px' }),
          button(200, { 'padding-left': '8px' }, 'Far'),
        ]),
        [[10, 10, 80, 30]]
      ),
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.members).toHaveLength(1)
  })
})
