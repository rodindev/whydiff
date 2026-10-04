import type { NodeV1, RuleV1, SnapshotV1 } from '../snapshot/types.js'
import { buildSnapshot, type TreeSpec } from '../testing/snapshots.js'
import { blockClass, classContext, componentKind } from './component.js'

const BOX = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']
const EDGE = ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width']

/** One element of a styled page: its classes and the selectors whose rules style it, later ones winning. */
interface Styled {
  readonly tag?: string
  readonly cls: readonly string[]
  readonly by?: readonly string[]
}

/** A page whose sheet maps each selector to the longhands its rule sets; `important` rules win with !important. */
function styledPage(
  sheet: Readonly<Record<string, readonly string[]>>,
  elements: readonly Styled[],
  important: readonly string[] = []
): SnapshotV1 {
  const selectors = Object.keys(sheet)
  const props = [...new Set(Object.values(sheet).flat())]
  return buildSnapshot(
    [
      {
        tag: 'body',
        children: elements.map((element, a) => ({
          tag: element.tag ?? 'div',
          cls: element.cls,
          a,
        })),
      },
    ],
    {
      props,
      rules: selectors.map((selector): RuleV1 =>
        important.includes(selector)
          ? { sheet: 0, selector, important: true }
          : { sheet: 0, selector }
      ),
      attributions: elements.map(({ by = [] }) =>
        props.map((prop) =>
          by.reduce(
            (won, selector) =>
              sheet[selector]?.includes(prop) === true ? selectors.indexOf(selector) : won,
            -1
          )
        )
      ),
    }
  )
}

/** The class each classed element of the snapshot is named by, or its tag. */
function names(snapshot: SnapshotV1): string[] {
  const classes = classContext(snapshot)
  return snapshot.nodes
    .filter((node) => (node.cls ?? []).length > 0)
    .map((node) => blockClass(node, classes) ?? node.tag)
}

function only(spec: TreeSpec): { node: NodeV1; snapshot: SnapshotV1 } {
  const snapshot = buildSnapshot([spec])
  const [node] = snapshot.nodes
  if (node === undefined) throw new Error('empty tree')
  return { node, snapshot }
}

const kindOf = (spec: TreeSpec): string => {
  const { node, snapshot } = only(spec)
  return componentKind(node, snapshot)
}

/** The kind of every element under the body of a page. */
function kinds(snapshot: SnapshotV1, won: readonly number[] = []): string[] {
  return snapshot.nodes.slice(1).map((node) => componentKind(node, snapshot, won))
}

describe('componentKind', () => {
  it('prefers the test id stem, then the block of a class that names the component, then the tag with its classes, then the role, then the tag', () => {
    expect(kindOf({ tag: 'div', testId: 'pipeline-row-12', cls: ['ui-row'], role: 'row' })).toBe(
      'pipeline-row'
    )
    expect(kindOf({ tag: 'div', testId: 'cell[4]' })).toBe('cell')
    expect(kindOf({ tag: 'div', cls: ['ui-btn--large', 'ui-btn'], role: 'button' })).toBe('ui-btn')
    expect(kindOf({ tag: 'span', cls: ['ui-card__title'] })).toBe('ui-card')
    expect(kindOf({ tag: 'div', cls: ['px-2', 'mt-4', 'panel--open'], role: 'button' })).toBe(
      'div.mt-4.px-2'
    )
    expect(kindOf({ tag: 'div', cls: ['css-1a2b3c'], role: 'button' })).toBe('button')
    expect(kindOf({ tag: 'div', cls: ['css-1a2b3c'] })).toBe('div')
  })

  it('names an element by the class whose prefix holds the most BEM names on the page, so a library class beats an app block on it; the label keeps the block', () => {
    const snapshot = buildSnapshot([
      { tag: 'div', cls: ['ui-list', 'ui-list--dense'] },
      { tag: 'div', cls: ['ui-list__item'] },
      { tag: 'div', cls: ['ui-btn', 'ui-btn--flat'] },
      { tag: 'div', cls: ['ui-list-title', 'x__name'] },
      { tag: 'div', cls: ['ui-row', 'hero', 'hero--wide'] },
      { tag: 'div', cls: ['ui-list-title', 'brand'] },
    ])
    const [, , , title, row, branded] = snapshot.nodes
    if (title === undefined || row === undefined || branded === undefined) throw new Error('tree')
    expect([title, row, branded].map((node) => componentKind(node, snapshot))).toEqual([
      'ui-list-title',
      'ui-row',
      'ui-list-title',
    ])
    const classes = classContext(snapshot)
    expect([title, row, branded].map((node) => blockClass(node, classes))).toEqual([
      'x__name',
      'hero',
      'brand',
    ])
  })

  it('gives one class combination one kind on every page, whichever of its classes the page shows as a block', () => {
    const field = { tag: 'label', cls: ['ui-label', 'ui-field-label', 'ui-field-label--float'] }
    const link = { tag: 'label', cls: ['ui-label', 'ui-label--link'] }
    const pages = [
      buildSnapshot([{ tag: 'body', children: [field, link] }]),
      buildSnapshot([{ tag: 'body', children: [field] }]),
    ]
    expect(pages.map((page) => kinds(page)[0])).toEqual(['ui-label', 'ui-label'])
  })

  it('prefers the class naming the element that a rule behind the changed longhands styles it through', () => {
    const sheet = { 'div.ui-title': ['color'], '.x__name': ['font-weight'], '.stack': ['display'] }
    const page = styledPage(sheet, [
      { cls: ['ui-title', 'x__name', 'stack'], by: ['div.ui-title', '.x__name', '.stack'] },
    ])
    expect(kinds(page)).toEqual(['x'])
    expect(kinds(page, [0])).toEqual(['ui-title'])
    expect(kinds(page, [1])).toEqual(['x'])
    expect(kinds(page, [2])).toEqual(['x'])
  })

  it('groups an element no class names by the classes setting its box but not a colour, else by any styling it, states and unstyled classes left out', () => {
    const sheet = {
      '.cell-pad': ['padding-top', 'padding-bottom'],
      '.align-end': ['text-align'],
      '.weight-bold': ['font-weight'],
      '.ink-muted': ['color'],
      '.size-sm': ['font-size'],
      '.size-lg': ['font-size'],
      '.tint-a': ['background-color'],
      '.tint-b': ['background-color', 'border-top-color'],
      '.stack': ['display'],
      '.stack.is-on': ['padding-left'],
    }
    const page = styledPage(sheet, [
      { tag: 'td', cls: ['cell-pad'], by: ['.cell-pad'] },
      { tag: 'td', cls: ['cell-pad', 'align-end'], by: ['.cell-pad', '.align-end'] },
      { tag: 'td', cls: ['weight-bold', 'cell-pad', 'hook'], by: ['.cell-pad', '.weight-bold'] },
      { tag: 'td', cls: ['cell-pad', 'tint-a'], by: ['.cell-pad', '.tint-a'] },
      { tag: 'td', cls: ['tint-b', 'cell-pad'], by: ['.cell-pad', '.tint-b'] },
      { tag: 'p', cls: ['size-sm', 'ink-muted', 'hook'], by: ['.size-sm', '.ink-muted'] },
      { tag: 'p', cls: ['size-lg', 'weight-bold'], by: ['.size-lg', '.weight-bold'] },
      { tag: 'p', cls: ['tint-a'], by: ['.tint-a'] },
      { cls: ['stack', 'is-on'], by: ['.stack', '.stack.is-on'] },
      { cls: ['stack'], by: ['.stack'] },
      { tag: 'span', cls: ['hook'] },
    ])
    expect(kinds(page)).toEqual([
      'td.cell-pad',
      'td.cell-pad',
      'td.cell-pad',
      'td.cell-pad',
      'td.cell-pad',
      'p.ink-muted.size-sm',
      'p.size-lg.weight-bold',
      'p.tint-a',
      'div.stack',
      'div.stack',
      'span',
    ])
  })
})

describe('classContext with the rules the capture recorded', () => {
  it('reads a class whose own rule is the class alone and sets one shorthand or less as a utility (utility-first sheets)', () => {
    const sheet = {
      '.stack': ['display'],
      '.pad-4': BOX,
      '.ellipsis': ['overflow-x', 'overflow-y', 'text-overflow', 'white-space'],
      '.ink-muted:hover': ['color'],
    }
    const page = styledPage(sheet, [
      { cls: ['stack', 'pad-4'], by: ['.stack', '.pad-4'] },
      { tag: 'p', cls: ['ellipsis', 'ink-muted'], by: ['.ellipsis', '.ink-muted:hover'] },
      { tag: 'span', cls: ['ellipsis'], by: ['.ellipsis'] },
    ])
    expect(names(page)).toEqual(['div', 'p', 'span'])
  })

  it('names nothing by a class no captured rule styles the element through: markers, hooks, children-only utilities', () => {
    const page = styledPage({ '.stack': ['display'], '.lanes > *': BOX }, [
      { cls: ['stack', 'marker'], by: ['.stack'] },
      { tag: 'section', cls: ['checkout-summary', 'lanes'] },
      { cls: ['tilt'], by: ['.lanes > *'] },
    ])
    expect(names(page)).toEqual(['div', 'section', 'div'])
  })

  it('names a component by a rule that sets more than a utility or styles it in context (component sheets)', () => {
    const sheet = {
      '.ui-card': [...BOX, 'background-color', 'box-shadow'],
      '.stack': ['display'],
      '.ui-panel .ui-link': ['color'],
      'button.ui-action': ['color'],
      '.ui-tab': ['color'],
    }
    const page = styledPage(sheet, [
      { cls: ['ui-card', 'stack'], by: ['.ui-card', '.stack'] },
      { tag: 'a', cls: ['ui-link'], by: ['.ui-panel .ui-link'] },
      { tag: 'button', cls: ['ui-action'], by: ['button.ui-action'] },
      { tag: 'button', cls: ['ui-tab'], by: ['.ui-tab'] },
    ])
    expect(names(page)).toEqual(['ui-card', 'ui-link', 'ui-action', 'button'])
  })

  it('names a class whose rules style its parts, not one whose rules style every child alike', () => {
    const page = styledPage(
      {
        '.ui-banner': ['display', 'padding-left', 'background-color'],
        '.ui-banner i': ['color'],
        '.lanes > :not([hidden]) ~ :not([hidden])': ['padding-top'],
        '.lift:hover .hover\\:ink': ['color'],
      },
      [
        { cls: ['ui-banner'], by: ['.ui-banner'] },
        { tag: 'i', cls: [], by: ['.ui-banner i'] },
        { cls: ['lanes'] },
        { cls: ['lift'] },
        { tag: 'span', cls: ['hover:ink'], by: ['.lift:hover .hover\\:ink'] },
      ]
    )
    expect(names(page)).toEqual(['ui-banner', 'div', 'div', 'span'])
  })

  it('never names by a class styled only next to another one: modifiers and states', () => {
    const page = styledPage({ '.ui-tab': [...BOX, ...EDGE], '.ui-tab.is-on': ['color'] }, [
      { cls: ['ui-tab', 'is-on'], by: ['.ui-tab', '.ui-tab.is-on'] },
    ])
    expect(names(page)).toEqual(['ui-tab'])
  })

  it('reads only the rules that win a longhand, not one that only declares custom properties', () => {
    const sheet = { '.ui-stack': ['display'], '.ui-stack.is-on': ['padding-left'] }
    const elements = [
      { cls: ['ui-stack', 'is-on'], by: ['.ui-stack', '.ui-stack.is-on'] },
      { cls: ['ui-stack'], by: ['.ui-stack'] },
    ]
    const tokens = styledPage({ ...sheet, '.is-on': [] }, elements)
    expect(tokens.rules?.map((rule) => rule.selector)).toContain('.is-on')
    expect(kinds(tokens)).toEqual(kinds(styledPage(sheet, elements)))
    expect(kinds(tokens)).toEqual(['div.ui-stack', 'div.ui-stack'])
  })

  it('reads an !important single-class rule as a utility at any size, so a library utility never beats its component', () => {
    const sheet = {
      '.kit-sheet': [...BOX, ...EDGE],
      '.kit-row': ['display'],
      '.kit-type-title': ['font-size', 'font-weight', 'line-height', 'letter-spacing', 'color'],
    }
    const page = styledPage(
      sheet,
      [
        { cls: ['kit-sheet', 'kit-row'], by: ['.kit-sheet', '.kit-row'] },
        { tag: 'span', cls: ['kit-type-title'], by: ['.kit-type-title'] },
      ],
      ['.kit-row', '.kit-type-title']
    )
    expect(names(page)).toEqual(['kit-sheet', 'span'])
  })

  it('names BEM blocks and elements whatever their rules set, never their modifiers', () => {
    const page = styledPage({ '.ui-meter__bar': ['color'], '.ui-meter--slim': BOX }, [
      { cls: ['ui-meter', 'ui-meter--slim'], by: ['.ui-meter--slim'] },
      { cls: ['ui-meter__bar', 'slim'], by: ['.ui-meter__bar'] },
    ])
    expect(names(page)).toEqual(['ui-meter', 'ui-meter__bar'])
  })

  it('reads hashed names through their rules without the hash (CSS Modules, CSS-in-JS)', () => {
    const sheet = { '.Card_root__a1B2c': [...BOX, ...EDGE], '.css-9z8y7x-Badge': [...BOX, 'color'] }
    const page = styledPage(sheet, [
      { cls: ['Card_root__a1B2c'], by: ['.Card_root__a1B2c'] },
      { tag: 'span', cls: ['sc-bdfBwQ', 'css-9z8y7x-Badge'], by: ['.css-9z8y7x-Badge'] },
    ])
    expect(names(page)).toEqual(['Card_root', 'Badge'])
  })
})

describe('classContext without rules', () => {
  const page = (...elements: TreeSpec[]): SnapshotV1 => buildSnapshot(elements)

  it('reads a namespace that puts two classes neither extends on one element as utilities', () => {
    const snapshot = page(
      { tag: 'div', cls: ['u-row', 'u-row-wrap', 'u-gap-2', 'ui-card'] },
      { tag: 'span', cls: ['u-sticky'] },
      { tag: 'section', cls: ['checkout-summary'] }
    )
    expect(names(snapshot)).toEqual(['ui-card', 'span', 'checkout-summary'])
  })

  it('keeps a namespace that owns a block, though its components share an element', () => {
    const snapshot = page(
      { tag: 'div', cls: ['ui-select', 'ui-input'] },
      { tag: 'div', cls: ['ui-field', 'ui-field--dense'] }
    )
    expect(names(snapshot)).toEqual(['ui-input', 'ui-field'])
  })

  it('counts a class that extends another one on the element as its variant, not as a second class', () => {
    const snapshot = page(
      { tag: 'div', cls: ['ui-col', 'ui-col-12'] },
      { tag: 'div', cls: ['ui-btn', 'ui-btn-primary'] }
    )
    expect(names(snapshot)).toEqual(['ui-col', 'ui-btn'])
  })

  it('ranks BEM blocks and elements before a shorter name the snapshot says nothing about', () => {
    const snapshot = page(
      { tag: 'div', cls: ['ui-meter__bar', 'slim'] },
      { tag: 'div', cls: ['ui-chip', 'ui-chip--small', 'new'] }
    )
    expect(names(snapshot)).toEqual(['ui-meter__bar', 'ui-chip'])
  })

  it('takes a namespace written with `--` for a block when other classes extend it', () => {
    const snapshot = page({ tag: 'div', cls: ['ns--panel', 'ns--panel--open'] })
    expect(names(snapshot)).toEqual(['ns--panel'])
  })

  it('never names by value syntax, a spacing step or a modifier', () => {
    const snapshot = page(
      {
        tag: 'div',
        cls: ['!ui-box', 'wide:ui-box', 'span-[42px]', 'part-1/2', 'step-1.5', '-lift-2'],
      },
      { tag: 'div', cls: ['mt-4', 'px-2', 'mx-auto', 'ma-n1', 'ui-box--wide'] },
      { tag: 'div', cls: ['m-panel', 'p-tile'] }
    )
    expect(names(snapshot)).toEqual(['div', 'div', 'p-tile'])
  })

  it('keeps a BEM element whole and strips a CSS Modules hash', () => {
    const snapshot = page(
      { tag: 'li', cls: ['ui-list__entry'] },
      { tag: 'div', cls: ['Form_field__x9Y8z'] }
    )
    expect(names(snapshot)).toEqual(['ui-list__entry', 'Form_field'])
  })

  it('prefers names without digits, then the shortest, then the first alphabetically', () => {
    const snapshot = page(
      { tag: 'div', cls: ['tier-1', 'lane-2', 'lane'] },
      { tag: 'div', cls: ['lane-2'] },
      { tag: 'div', cls: ['hero-banner', 'ui-card'] },
      { tag: 'div', cls: ['tile', 'pill'] }
    )
    expect(names(snapshot)).toEqual(['lane', 'lane-2', 'ui-card', 'pill'])
  })

  it('is computed once per snapshot', () => {
    const snapshot = page({ tag: 'div', cls: ['ui-card'] })
    expect(classContext(snapshot)).toBe(classContext(snapshot))
  })
})
