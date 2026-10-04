import { explainChanges } from '../causes/causes.js'
import { computeDeltas } from '../deltas/deltas.js'
import { matchSnapshots } from '../match/match.js'
import { diffRegions, PIXEL_DIFFERENT, PIXEL_SAME, type DiffMask } from '../pixels/index.js'
import type { ScreenInput } from '../report/types.js'
import type { DeclarationV1, Rect, RuleV1, SheetV1 } from '../snapshot/types.js'
import { buildSnapshot, type TreeOptions, type TreeSpec } from './snapshots.js'

export const SCREEN_PROPS: readonly string[] = ['display', 'padding-left', 'color', 'font-weight']
const DEFAULTS: Readonly<Record<string, string>> = {
  display: 'block',
  'padding-left': '0px',
  color: 'rgb(0, 0, 0)',
  'font-weight': '400',
}

export const styleRow = (overrides: Record<string, string> = {}): string[] =>
  SCREEN_PROPS.map((p) => overrides[p] ?? DEFAULTS[p] ?? '')

export const page = (children: TreeSpec[]): TreeSpec[] => [
  {
    tag: 'html',
    box: [0, 0, 1000, 800],
    style: styleRow(),
    children: [{ tag: 'body', box: [0, 0, 1000, 800], style: styleRow(), children }],
  },
]

export const button = (
  x: number,
  overrides: Record<string, string> = {},
  text = 'Save',
  extra: Partial<TreeSpec> = {}
): TreeSpec => ({
  tag: 'button',
  cls: ['ui-btn', 'u-mt-2'],
  text,
  box: [x, 10, 80, 30],
  style: styleRow(overrides),
  ...extra,
})

/** A 1000x800 mask whose differing pixels are the given rectangles. */
function maskOf(rects: readonly Rect[]): DiffMask {
  const width = 1000
  const height = 800
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

/** Sheets, rules and attribution rows of one side, with the declarations each row uses; specs point at rows through `a`. */
export interface Attributed {
  readonly sheets: readonly SheetV1[]
  readonly rules: readonly RuleV1[]
  readonly attributions: readonly (readonly number[])[]
  readonly declarations?: readonly DeclarationV1[]
  readonly uses?: readonly (readonly number[])[]
}

export interface ScreenOptions {
  readonly title?: string
  /** Style columns of both sides; `SCREEN_PROPS` by default. */
  readonly props?: readonly string[]
  readonly file?: string
  readonly line?: number
  readonly project?: string
  /** One side's rule rows, image origin and scale. */
  readonly before?: Omit<TreeOptions, 'props'>
  readonly after?: Omit<TreeOptions, 'props'>
}

/** Runs the whole pipeline over two trees and a hand-drawn diff, as the report builder expects it. */
export function screenOf(
  name: string,
  before: TreeSpec[],
  after: TreeSpec[],
  diff: readonly Rect[],
  options: ScreenOptions = {}
): ScreenInput {
  const props = options.props ?? SCREEN_PROPS
  const a = buildSnapshot(before, { props, ...options.before })
  const b = buildSnapshot(after, { props, ...options.after })
  const mask = maskOf(diff)
  const { regions, massChange } = diffRegions(mask)
  const rects: Rect[] = regions.map((r) => [r.x, r.y, r.width, r.height])
  const matching = matchSnapshots(a, b, { regions: rects, massChange })
  const deltas = computeDeltas(a, b, matching, { regions: rects })
  return {
    screen: name,
    title: options.title ?? `${name} >> renders`,
    ...(options.file === undefined ? {} : { file: options.file }),
    ...(options.line === undefined ? {} : { line: options.line }),
    ...(options.project === undefined ? {} : { project: options.project }),
    before: a,
    after: b,
    matching,
    deltas,
    explanation: explainChanges(a, b, matching, deltas, { regions, mask }),
    regions,
    differing: mask.differing,
    massChange,
    sizeMismatch: null,
  }
}

const sheet = (name: string, hash: string): SheetV1 => ({ href: `http://app.test/${name}`, hash })
const row = (prop: string, rule: number): number[] =>
  SCREEN_PROPS.map((p) => (p === prop ? rule : -1))
const none = SCREEN_PROPS.map(() => -1)

/** One element per screen whose style goes from `from` to `to`, attributed through row `a` of each side. */
export const ruleScreen =
  (before: Attributed, after: Attributed) =>
  (
    name: string,
    tag: string,
    cls: string,
    text: string,
    a: number,
    from: Record<string, string>,
    to: Record<string, string>
  ): ScreenInput => {
    const element = (overrides: Record<string, string>): TreeSpec => ({
      tag,
      cls: [cls],
      text,
      box: [10, 10, 80, 30],
      style: styleRow(overrides),
      a,
    })
    return screenOf(name, page([element(from)]), page([element(to)]), [[10, 10, 80, 30]], {
      before,
      after,
    })
  }

/** Two rule families over five screens: a reset rule now sets one property each on a button, a link and a card, and a layered rule for .ui-col and two more column selectors now sets padding-left with other values per element. */
export function ruleFamilies(): ScreenInput[] {
  const before: Attributed = {
    sheets: [sheet('app.css', 'app1'), sheet('reset.css', 'reset1'), sheet('framework.css', 'fw1')],
    rules: [
      { sheet: 0, selector: '.ui-btn' },
      { sheet: 0, selector: '.ui-link' },
      { sheet: 0, selector: '.ui-card' },
      { sheet: 0, selector: '.ui-col' },
    ],
    attributions: [
      none,
      row('padding-left', 0),
      row('color', 1),
      row('font-weight', 2),
      row('padding-left', 3),
    ],
  }
  const after: Attributed = {
    sheets: [sheet('app.css', 'app1'), sheet('reset.css', 'reset2'), sheet('framework.css', 'fw2')],
    rules: [
      { sheet: 1, selector: '*' },
      { sheet: 2, selector: '.ui-col-12, .ui-col-6, .ui-col', layer: 'framework.components' },
    ],
    attributions: [
      none,
      row('padding-left', 0),
      row('color', 0),
      row('font-weight', 0),
      row('padding-left', 1),
    ],
  }
  const screen = ruleScreen(before, after)
  return [
    screen('s1', 'button', 'ui-btn', 'Save', 1, { 'padding-left': '8px' }, {}),
    screen('s2', 'a', 'ui-link', 'More', 2, { color: 'rgb(0, 0, 255)' }, {}),
    screen('s3', 'div', 'ui-card', 'Card', 3, { 'font-weight': '700' }, {}),
    screen('s4', 'div', 'ui-col', 'Col', 4, { 'padding-left': '12px' }, { 'padding-left': '4px' }),
    screen(
      's5',
      'div',
      'ui-col',
      'Col two',
      4,
      { 'padding-left': '16px' },
      { 'padding-left': '6px' }
    ),
  ]
}

/** One .ui-col rule across a rebuilt sheet with another content hash, moved into a layer: it no longer sets padding-left on two columns, changed its colour on a third and now sets font-weight on a fourth. */
export function ruleMove(): ScreenInput[] {
  const before: Attributed = {
    sheets: [sheet('assets/framework-Bx81kQ2c.css', 'fw1')],
    rules: [{ sheet: 0, selector: '.ui-col' }],
    attributions: [none, row('padding-left', 0), row('color', 0), none],
  }
  const after: Attributed = {
    sheets: [sheet('assets/framework-D4a0LmZe.css', 'fw2')],
    rules: [{ sheet: 0, selector: '.ui-col', layer: 'framework.components' }],
    attributions: [none, none, row('color', 0), row('font-weight', 0)],
  }
  const screen = ruleScreen(before, after)
  return [
    screen('s1', 'div', 'ui-col', 'Col', 1, { 'padding-left': '12px' }, {}),
    screen('s2', 'div', 'ui-col', 'Col two', 1, { 'padding-left': '16px' }, {}),
    screen(
      's3',
      'div',
      'ui-col',
      'Col three',
      2,
      { color: 'rgb(0, 0, 255)' },
      { color: 'rgb(255, 0, 0)' }
    ),
    screen('s4', 'div', 'ui-col', 'Col four', 3, {}, { 'font-weight': '700' }),
  ]
}

/** A hover rule in the first of two sheets that read `index-*.css` without their hash, across a rebuild that renames both: it now sets the colour of the button under the pointer on two screens and no longer sets it on a third, whose button the pointer left. */
export function hoverRebuild(): ScreenInput[] {
  const side = (hashes: readonly string[], attributions: number[][]): Attributed => ({
    sheets: hashes.map((hash) => sheet(`assets/index-${hash}.css`, hash)),
    rules: [{ sheet: 0, selector: '.ui-btn:hover' }],
    attributions,
  })
  const screen = ruleScreen(
    side(['DIlXbKeZ', 'Bx81kQ2c'], [none, none, row('color', 0)]),
    side(['D79WzvNx', 'Cq3mT0aZ'], [none, row('color', 0), none])
  )
  const hovered = { color: 'rgb(0, 0, 255)' }
  return [
    screen('s1', 'button', 'ui-btn', 'Save', 1, {}, hovered),
    screen('s2', 'button', 'ui-btn', 'Send', 1, {}, hovered),
    screen('s3', 'button', 'ui-btn', 'Reset', 2, hovered, {}),
  ]
}

/** What Markdown would misread, on two screens: titles with a tag and underscores, a row whose locator escapes a class, a button whose name holds an asterisk, and a rule of a dependency's sheet that moved into a layer and no longer sets the row's padding. */
export function markdownTraps(): ScreenInput[] {
  const side = (hash: string, attributions: number[][], layer?: string): Attributed => ({
    sheets: [sheet(`assets/vendor-ui-${hash}.css`, hash)],
    rules: [{ sheet: 0, selector: '.ui-row', ...(layer === undefined ? {} : { layer }) }],
    attributions,
  })
  const tree = (padding: string, color: string, a: number): TreeSpec[] =>
    page([
      {
        tag: 'div',
        cls: ['!ui-p-0'],
        box: [0, 0, 400, 100],
        style: styleRow(),
        children: [
          {
            tag: 'div',
            cls: ['ui-row'],
            box: [0, 0, 400, 40],
            style: styleRow({ 'padding-left': padding }),
            a,
          },
          {
            tag: 'button',
            role: 'button',
            name: 'Total *',
            cls: ['ui-btn'],
            box: [0, 50, 80, 30],
            style: styleRow({ color }),
          },
        ],
      },
    ])
  const screen = (name: string, title: string): ScreenInput =>
    screenOf(
      name,
      tree('12px', 'rgb(0, 0, 0)', 1),
      tree('0px', 'rgb(9, 9, 9)', 1),
      [
        [0, 0, 400, 40],
        [0, 50, 80, 30],
      ],
      {
        title,
        before: side('Bx81kQ2c', [none, row('padding-left', 0)]),
        after: side('D4a0LmZe', [none, none], 'ui.components'),
      }
    )
  return [screen('s1', 'cart <ui-badge> > __totals__'), screen('s2', 'checkout > __totals__')]
}

/** A sheet that holds `body` both in layer base and unlayered on both sides, as a globals.css with `@layer base { body }` next to a plain `body` rule does: the unlayered rule now sets the colour the layered one set, on two screens. */
export function ruleTwoLayers(): ScreenInput[] {
  const side = (color: number): Attributed => ({
    sheets: [sheet('app.css', 'app1')],
    rules: [
      { sheet: 0, selector: 'body', layer: 'base' },
      { sheet: 0, selector: 'body' },
    ],
    attributions: [none, [-1, 1, color, -1]],
  })
  const tree = (color: string, text: string): TreeSpec[] => [
    {
      tag: 'html',
      box: [0, 0, 1000, 800],
      style: styleRow(),
      children: [
        {
          tag: 'body',
          box: [0, 0, 1000, 800],
          style: styleRow({ color, 'padding-left': '8px' }),
          a: 1,
          children: [
            { tag: 'p', cls: ['ui-note'], text, box: [10, 10, 80, 30], style: styleRow({ color }) },
          ],
        },
      ],
    },
  ]
  return ['s1', 's2'].map((name) =>
    screenOf(
      name,
      tree('rgb(0, 0, 0)', `Note ${name}`),
      tree('rgb(9, 9, 9)', `Note ${name}`),
      [[10, 10, 80, 30]],
      {
        before: side(0),
        after: side(1),
      }
    )
  )
}

/** One .ui-col rule seen three ways: moved into layer framework.components on s1, in layer framework.base on both sides of s2, and gone from the after side of s3. */
export function ruleLayerMix(): ScreenInput[] {
  const sheets = [sheet('assets/framework-Bx81kQ2c.css', 'fw1')]
  const col = (prop: string, layer?: string): Attributed => ({
    sheets,
    rules: [{ sheet: 0, selector: '.ui-col', ...(layer === undefined ? {} : { layer }) }],
    attributions: [none, row(prop, 0)],
  })
  const gone: Attributed = { sheets, rules: [], attributions: [none, none] }
  return [
    ruleScreen(col('padding-left'), col('padding-left', 'framework.components'))(
      's1',
      'div',
      'ui-col',
      'Col',
      1,
      { 'padding-left': '12px' },
      { 'padding-left': '4px' }
    ),
    ruleScreen(col('color', 'framework.base'), col('color', 'framework.base'))(
      's2',
      'div',
      'ui-col',
      'Col two',
      1,
      { color: 'rgb(0, 0, 255)' },
      { color: 'rgb(255, 0, 0)' }
    ),
    ruleScreen(col('font-weight'), gone)(
      's3',
      'div',
      'ui-col',
      'Col three',
      1,
      { 'font-weight': '700' },
      {}
    ),
  ]
}

/** A text field app.css hid with `.ui-field { opacity: 0 }`, a rule the after side no longer has, while reset.css now sets its four paddings and a button's, on two screens. */
export function fieldReset(): ScreenInput[] {
  const props = [
    'display',
    'opacity',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
  ]
  const style = (display: string, opacity: string, padding: string): string[] => [
    display,
    opacity,
    padding,
    padding,
    padding,
    padding,
  ]
  const paddings = (rule: number): number[] => [-1, -1, rule, rule, rule, rule]
  const before: Attributed = {
    sheets: [sheet('app.css', 'app1'), sheet('reset.css', 'reset1')],
    rules: [{ sheet: 0, selector: '.ui-field' }],
    attributions: [[-1, 0, -1, -1, -1, -1], props.map(() => -1)],
  }
  const after: Attributed = {
    sheets: [sheet('app.css', 'app2'), sheet('reset.css', 'reset2')],
    rules: [{ sheet: 1, selector: '*' }],
    attributions: [paddings(0), paddings(0)],
  }
  const form = (name: string, field: string[], button: string[]): TreeSpec[] => [
    {
      tag: 'html',
      box: [0, 0, 1000, 800],
      style: style('block', '1', '0px'),
      children: [
        {
          tag: 'body',
          box: [0, 0, 1000, 800],
          style: style('block', '1', '0px'),
          children: [
            {
              tag: 'textarea',
              role: 'textbox',
              name: `Notes ${name}`,
              cls: ['ui-field'],
              box: [16, 16, 320, 96],
              style: field,
              a: 0,
            },
            {
              tag: 'button',
              cls: ['ui-btn'],
              text: `Send ${name}`,
              box: [16, 128, 80, 30],
              style: button,
              a: 1,
            },
          ],
        },
      ],
    },
  ]
  return ['s1', 's2'].map((name) =>
    screenOf(
      name,
      form(name, style('inline-block', '0', '2px'), style('inline-block', '1', '6px')),
      form(name, style('inline-block', '1', '0px'), style('inline-block', '1', '0px')),
      [
        [16, 16, 320, 96],
        [16, 128, 80, 30],
      ],
      { props, before, after }
    )
  )
}

/** A textarea whose colour changed, with a region in its resize corner, and an input with a region inside its content box that no change explains. */
export function formControls(): ScreenInput[] {
  const form = (color: string): TreeSpec[] =>
    page([
      {
        tag: 'textarea',
        role: 'textbox',
        name: 'Notes',
        cls: ['ui-field'],
        box: [16, 44, 320, 96],
        style: styleRow({ color }),
      },
      {
        tag: 'input',
        role: 'textbox',
        name: 'Title',
        cls: ['ui-field'],
        box: [16, 160, 320, 30],
        style: styleRow({ 'padding-left': '8px' }),
      },
    ])
  return [
    screenOf(
      's1',
      form('rgb(0, 0, 0)'),
      form('rgb(9, 9, 9)'),
      [
        [20, 48, 76, 12],
        [326, 130, 7, 7],
        [28, 170, 62, 9],
      ],
      { file: 'tests/forms.spec.ts', project: 'chromium' }
    ),
  ]
}

const SIDE_NAMES = ['top', 'right', 'bottom', 'left']
const TOKEN_PROPS: readonly string[] = [
  'display',
  ...SIDE_NAMES.map((side) => `padding-${side}`),
  'row-gap',
  'column-gap',
  'box-shadow',
  'background-color',
  ...['color', 'style', 'width'].flatMap((part) =>
    SIDE_NAMES.map((side) => `border-${side}-${part}`)
  ),
]
const TOKEN_DEFAULTS: Readonly<Record<string, string>> = {
  display: 'block',
  'row-gap': 'normal',
  'column-gap': 'normal',
  'box-shadow': 'none',
  'background-color': 'rgba(0, 0, 0, 0)',
}
const SHADOW = 'rgba(0, 0, 0, 0.2) 0px 1px 2px 0px'

/** One entry per property of `TOKEN_PROPS`: a key names a property or, with `*` for the side, its four sides. */
function perProp<T>(set: Readonly<Record<string, T>>, fallback: (prop: string) => T): T[] {
  return TOKEN_PROPS.map((prop) => {
    const sides = prop.replace(/-(?:top|right|bottom|left)(?=-|$)/, '-*')
    return set[prop] ?? set[sides] ?? fallback(prop)
  })
}

function tokenStyle(set: Readonly<Record<string, string>>): string[] {
  return perProp(set, (prop) => {
    if (prop.startsWith('padding') || prop.endsWith('-width')) return '0px'
    if (prop.endsWith('-color')) return 'rgb(0, 0, 0)'
    if (prop.endsWith('-style')) return 'none'
    return TOKEN_DEFAULTS[prop] ?? ''
  })
}

/** A consumer of custom properties: one entry per longhand, all with the same rule, text and reads. */
const consumers =
  (rule: number, value: string, reads: number[]) =>
  (prop: string): DeclarationV1 => ({ prop, rule, value, reads })

/** The six ways a custom property reaches a longhand, and the browser's declaration a rule now wins over, each on one element of two screens: a theme token changed, a rule that now sets a longhand through another rule's token, a token gone whose reader falls back, tokens now set whose reader was invalid, a token of an ancestor's style attribute, a registration gone, and `border-width: initial` over the browser's 2px. */
export function customProperties(): ScreenInput[] {
  const solid = { 'border-*-style': 'solid', 'border-*-width': '1px' }
  const elements: readonly {
    tag: string
    cls: string
    from: Record<string, string>
    to: Record<string, string>
    /** How much wider and taller the after side's box is. */
    grows?: number
  }[] = [
    {
      tag: 'div',
      cls: 'ui-panel',
      from: { 'padding-*': '4px', 'row-gap': '4px' },
      to: { 'padding-*': '5px', 'row-gap': '5px' },
    },
    {
      tag: 'div',
      cls: 'ui-card',
      from: { 'box-shadow': SHADOW },
      to: { 'box-shadow': `${SHADOW}, rgb(0, 0, 0) 0px 0px 0px 1px` },
    },
    { tag: 'div', cls: 'ui-row', from: { 'column-gap': '4px' }, to: { 'column-gap': '6px' } },
    {
      tag: 'div',
      cls: 'ui-ring',
      from: {},
      to: { 'box-shadow': `rgba(0, 0, 0, 0) 0px 0px 0px 0px, ${SHADOW}` },
    },
    {
      tag: 'div',
      cls: 'ui-surface',
      from: {
        ...solid,
        'background-color': 'rgb(53, 53, 53)',
        'border-*-color': 'rgb(53, 53, 53)',
      },
      to: {
        ...solid,
        'background-color': 'rgb(255, 255, 255)',
        'border-*-color': 'rgb(255, 255, 255)',
      },
    },
    { tag: 'div', cls: 'ui-frame', from: solid, to: {} },
    {
      tag: 'button',
      cls: 'ui-btn',
      from: { 'border-*-style': 'solid', 'border-*-width': '2px' },
      to: { 'border-*-style': 'solid', 'border-*-width': '3px' },
      grows: 2,
    },
  ]
  const row = (set: Record<string, number>): number[] => perProp(set, () => -1)
  const sides = (part: string): string[] => SIDE_NAMES.map((side) => `border-${side}-${part}`)
  const spacing = [...SIDE_NAMES.map((side) => `padding-${side}`), 'row-gap']
  const uses = [[], [1, 2, 3, 4, 5], [7], [9], [12], [14, 15, 16, 17, 18], [20, 21, 22, 23]]
  const before: Attributed = {
    sheets: [sheet('app.css', 'app1')],
    rules: [
      { sheet: 0, selector: ':root, :host', layer: 'theme' },
      { sheet: 0, selector: '.ui-panel' },
      { sheet: 0, selector: '.ui-elevated' },
      { sheet: 0, selector: ':root', layer: 'theme' },
      { sheet: 0, selector: '.ui-row' },
      { sheet: 0, selector: '.ui-ring' },
      { inline: true, selector: '' },
      { sheet: 0, selector: '.ui-surface' },
      { sheet: 0, selector: '@property --ui-border-style' },
      { sheet: 0, selector: '.ui-frame' },
      { userAgent: true, selector: 'button' },
    ],
    attributions: [
      row({}),
      row({ 'padding-*': 1, 'row-gap': 1 }),
      row({ 'box-shadow': 2 }),
      row({ 'column-gap': 4 }),
      row({ 'box-shadow': 5 }),
      row({ 'background-color': 7, 'border-*-color': 7 }),
      row({ 'border-*-style': 9 }),
      row({}),
    ],
    declarations: [
      { prop: '--ui-space', rule: 0, value: '4px', inherited: true },
      ...spacing.map(consumers(1, 'var(--ui-space)', [0])),
      { prop: '--ui-shadow', rule: 2, value: '0 1px 2px #0003' },
      consumers(2, 'var(--ui-shadow)', [6])('box-shadow'),
      { prop: '--ui-gap', rule: 3, value: '4px', inherited: true },
      consumers(4, 'var(--ui-gap, 6px)', [8])('column-gap'),
      { prop: '--ui-ring' },
      { prop: '--ui-glow' },
      consumers(5, 'var(--ui-ring), var(--ui-glow)', [10, 11])('box-shadow'),
      { prop: '--ui-surface', rule: 6, value: '#353535', inherited: true },
      ...['background-color', ...sides('color')].map(consumers(7, 'var(--ui-surface)', [13])),
      { prop: '--ui-border-style', rule: 8, value: 'solid', initial: true },
      ...sides('style').map(consumers(9, 'var(--ui-border-style)', [19])),
      ...sides('width').map((prop): DeclarationV1 => ({ prop, rule: 10, value: '2px' })),
    ],
    uses: [...uses, [24, 25, 26, 27]],
  }
  const after: Attributed = {
    sheets: [sheet('app.css', 'app2')],
    rules: [
      { sheet: 0, selector: ':root, :host', layer: 'theme' },
      { sheet: 0, selector: '.ui-panel' },
      { sheet: 0, selector: '.ui-elevated' },
      { sheet: 0, selector: '.ui-card' },
      { sheet: 0, selector: '.ui-row' },
      { sheet: 0, selector: '.ui-ring' },
      { sheet: 0, selector: '*, ::before, ::after', layer: 'base' },
      { inline: true, selector: '' },
      { sheet: 0, selector: '.ui-surface' },
      { sheet: 0, selector: '.ui-frame' },
      { sheet: 0, selector: '.ui-reset .ui-btn' },
    ],
    attributions: [
      row({}),
      row({ 'padding-*': 1, 'row-gap': 1 }),
      row({ 'box-shadow': 3 }),
      row({ 'column-gap': 4 }),
      row({ 'box-shadow': 5 }),
      row({ 'background-color': 8, 'border-*-color': 8 }),
      row({ 'border-*-style': 9 }),
      row({ 'border-*-width': 10 }),
    ],
    declarations: [
      { prop: '--ui-space', rule: 0, value: '5px', inherited: true },
      ...spacing.map(consumers(1, 'var(--ui-space)', [0])),
      { prop: '--ui-shadow', rule: 2, value: '0 1px 2px #0003' },
      consumers(3, 'var(--ui-shadow), 0 0 0 1px #000', [6])('box-shadow'),
      { prop: '--ui-gap' },
      consumers(4, 'var(--ui-gap, 6px)', [8])('column-gap'),
      { prop: '--ui-ring', rule: 6, value: '0 0 #0000' },
      { prop: '--ui-glow', rule: 6, value: '0 1px 2px #0003' },
      consumers(5, 'var(--ui-ring), var(--ui-glow)', [10, 11])('box-shadow'),
      { prop: '--ui-surface', rule: 7, value: '#ffffff', inherited: true },
      ...['background-color', ...sides('color')].map(consumers(8, 'var(--ui-surface)', [13])),
      { prop: '--ui-border-style' },
      ...sides('style').map(consumers(9, 'var(--ui-border-style)', [19])),
    ],
    uses: [...uses, []],
  }
  const tree = (name: string, side: 'from' | 'to'): TreeSpec[] => [
    {
      tag: 'html',
      box: [0, 0, 1000, 800],
      style: tokenStyle({}),
      a: 0,
      children: [
        {
          tag: 'body',
          box: [0, 0, 1000, 800],
          style: tokenStyle({}),
          a: 0,
          children: elements.map((element, index) => {
            const grows = side === 'to' ? (element.grows ?? 0) : 0
            return {
              tag: element.tag,
              cls: [element.cls],
              text: `${element.cls.slice('ui-'.length)} ${name}`,
              box: [10, 10 + index * 50, 200 + grows, 40 + grows],
              style: tokenStyle(element[side]),
              a: index + 1,
            }
          }),
        },
      ],
    },
  ]
  return ['s1', 's2'].map((name) =>
    screenOf(
      name,
      tree(name, 'from'),
      tree(name, 'to'),
      elements.map((element, index): Rect => [10, 10 + index * 50, 200 + (element.grows ?? 0), 42]),
      { props: TOKEN_PROPS, before, after }
    )
  )
}
