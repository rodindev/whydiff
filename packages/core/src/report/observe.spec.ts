import { computeDeltas } from '../deltas/deltas.js'
import { matchSnapshots } from '../match/match.js'
import type { Rect } from '../snapshot/types.js'
import { buildSnapshot, type TreeSpec } from '../testing/snapshots.js'
import { observationText, observe } from './observe.js'

const SIDES = ['top', 'right', 'bottom', 'left']
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left']
const DEFAULTS: Readonly<Record<string, string>> = {
  opacity: '1',
  visibility: 'visible',
  'font-size': '16px',
  'font-weight': '400',
  'letter-spacing': 'normal',
  'line-height': 'normal',
  'text-transform': 'none',
  color: 'rgb(0, 0, 0)',
  'background-color': 'rgba(0, 0, 0, 0)',
  'box-shadow': 'none',
  'z-index': 'auto',
  ...Object.fromEntries(
    SIDES.flatMap((side) => [
      [`border-${side}-width`, '0px'],
      [`border-${side}-style`, 'none'],
      [`border-${side}-color`, 'rgb(0, 0, 0)'],
      [`padding-${side}`, '0px'],
    ])
  ),
  ...Object.fromEntries(CORNERS.map((corner) => [`border-${corner}-radius`, '0px'])),
}
const PROPS = Object.keys(DEFAULTS)
const PAGE: Rect = [0, 0, 1000, 800]
const BOX: Rect = [10, 10, 120, 36]

/** The element under test; `style` overrides the defaults. */
interface Spec extends Omit<TreeSpec, 'tag' | 'style' | 'children'> {
  readonly tag?: string
  readonly style?: Record<string, string>
}

const row = (style: Record<string, string> = {}): string[] =>
  PROPS.map((prop) => style[prop] ?? DEFAULTS[prop] ?? '')

const page = (children: Spec[]): TreeSpec[] => [
  {
    tag: 'html',
    box: PAGE,
    style: row(),
    children: [
      {
        tag: 'body',
        box: PAGE,
        style: row(),
        children: children.map(({ style, ...spec }) => ({
          tag: 'div',
          box: BOX,
          ...spec,
          style: row(style),
        })),
      },
    ],
  },
]

function screen(before: Spec[], after: Spec[]) {
  const a = buildSnapshot(page(before), { props: PROPS })
  const b = buildSnapshot(page(after), { props: PROPS })
  const matching = matchSnapshots(a, b, { regions: [PAGE], massChange: false })
  return { before: a, after: b, deltas: computeDeltas(a, b, matching, { regions: [PAGE] }) }
}

/** The observation of one element across the two sides; it is node 2 under html and body. */
const observed = (before: Spec, after: Spec = before) =>
  observe(screen([before], [after]), { before: 2, after: 2 })

const text = (before: Spec, after: Spec = before): string | undefined =>
  observed(before, after)?.text

const styled = (from: Record<string, string>, to: Record<string, string>): string | undefined =>
  text({ style: from }, { style: to })

const button: Spec = { tag: 'button', role: 'button', name: 'Send', text: 'Send' }

describe('observationText', () => {
  it('says the facts of an observation as it does, and any of them alone in the same words', () => {
    const seen = observed(
      { ...button, style: { color: 'rgb(0, 0, 0)', 'font-weight': '400' } },
      {
        ...button,
        box: [10, 10, 130, 36],
        style: { color: 'rgb(9, 9, 9)', 'font-weight': '700' },
      }
    )
    if (seen === undefined) throw new Error('the button changed')
    expect(observationText(seen.element, seen.facts)).toBe(seen.text)
    expect(seen.facts.map((fact) => observationText(seen.element, [fact]))).toEqual([
      'the "Send" button is 10 px wider (was 120, now 130)',
      'the "Send" button\'s label is bolder',
      'the "Send" button\'s label is lighter (was #000000, now #090909)',
    ])
  })
})

describe('observe: naming', () => {
  const narrower = (spec: Spec): string | undefined =>
    text(spec, { ...spec, box: [10, 10, 117, 36] })

  it('names an element by its role and accessible name', () => {
    expect(observed(button, { ...button, box: [10, 10, 117, 36] })).toEqual({
      element: { role: 'button', name: 'Send', tag: 'button' },
      facts: [{ kind: 'width', from: 120, to: 117 }],
      text: 'the "Send" button is 3 px narrower (was 120, now 117)',
    })
    expect(narrower({ tag: 'input', role: 'textbox', name: 'Notes' })).toBe(
      'the "Notes" text field is 3 px narrower (was 120, now 117)'
    )
  })

  it('names it by its role and own text without an accessible name, by its role alone without either', () => {
    expect(narrower({ tag: 'button', role: 'button', text: 'Save' })).toBe(
      'the "Save" button is 3 px narrower (was 120, now 117)'
    )
    expect(narrower({ tag: 'button', role: 'button' })).toBe(
      'a button is 3 px narrower (was 120, now 117)'
    )
    expect(narrower({ tag: 'img', role: 'img' })).toBe(
      'an image is 3 px narrower (was 120, now 117)'
    )
  })

  it('takes the role HTML gives the tag when the snapshot carries none', () => {
    expect(narrower({ tag: 'button', text: 'Save' })).toBe(
      'the "Save" button is 3 px narrower (was 120, now 117)'
    )
    expect(narrower({ tag: 'img' })).toBe('an image is 3 px narrower (was 120, now 117)')
    expect(narrower({ tag: 'h2', text: 'Billing' })).toBe(
      'the "Billing" heading is 3 px narrower (was 120, now 117)'
    )
  })

  it('names a role without a name by the class its kind is read from, an empty name being none', () => {
    const close: Spec = { tag: 'button', role: 'button', name: '', cls: ['ui-close'] }
    expect(observed(close, { ...close, box: [10, 10, 117, 36] })).toEqual({
      element: { role: 'button', class: 'ui-close', tag: 'button' },
      facts: [{ kind: 'width', from: 120, to: 117 }],
      text: 'a `<button.ui-close>` is 3 px narrower (was 120, now 117)',
    })
  })

  it('names an element whose name and text a reader cannot see, an icon glyph or blank, as one without a name', () => {
    for (const glyph of ['\ue901', ' \u200b ', '\ue901\ue902']) {
      const icon: Spec = {
        tag: 'button',
        role: 'button',
        name: glyph,
        text: glyph,
        cls: ['ui-icon-btn'],
      }
      expect(observed(icon, { ...icon, box: [10, 10, 117, 36] })).toEqual({
        element: { role: 'button', class: 'ui-icon-btn', tag: 'button' },
        facts: [{ kind: 'width', from: 120, to: 117 }],
        text: 'a `<button.ui-icon-btn>` is 3 px narrower (was 120, now 117)',
      })
    }
    expect(narrower({ tag: 'span', text: '\ue901\ue902\ue903' })).toBe(
      'a `<span>` is 3 px narrower (was 120, now 117)'
    )
    expect(narrower({ tag: 'button', role: 'button', name: '\ue901 Close' })).toBe(
      'the "\ue901 Close" button is 3 px narrower (was 120, now 117)'
    )
  })

  it('takes one or two characters of own text for a name only next to a role', () => {
    expect(narrower({ tag: 'span', text: 'S' })).toBe(
      'a `<span>` is 3 px narrower (was 120, now 117)'
    )
    expect(narrower({ tag: 'div', text: '34', cls: ['ui-day'] })).toBe(
      'a `<div.ui-day>` is 3 px narrower (was 120, now 117)'
    )
    expect(narrower({ tag: 'span', text: 'Sun' })).toBe(
      'the "Sun" text is 3 px narrower (was 120, now 117)'
    )
    expect(narrower({ tag: 'button', role: 'button', text: 'S' })).toBe(
      'the "S" button is 3 px narrower (was 120, now 117)'
    )
  })

  it('puts a name that holds Markdown in a code span, quotes and escapes as written', () => {
    expect(narrower({ tag: 'button', role: 'button', name: 'Email *' })).toBe(
      'the `"Email *"` button is 3 px narrower (was 120, now 117)'
    )
    expect(narrower({ tag: 'span', text: 'a\\b `c`' })).toBe(
      'the ``"a\\\\b `c`"`` text is 3 px narrower (was 120, now 117)'
    )
  })

  it('names it by a short own text when its role is not in the table', () => {
    expect(narrower({ tag: 'span', text: 'Item one' })).toBe(
      'the "Item one" text is 3 px narrower (was 120, now 117)'
    )
    expect(narrower({ tag: 'nav', role: 'navigation', name: 'Pages', text: 'Item one' })).toBe(
      'the "Item one" element is 3 px narrower (was 120, now 117)'
    )
  })

  it('names it by its tag when the own text is long or absent', () => {
    expect(narrower({ tag: 'p', text: 'x'.repeat(41) })).toBe(
      'a `<p>` is 3 px narrower (was 120, now 117)'
    )
    expect(narrower({ tag: 'section', text: 'x'.repeat(41) })).toBe(
      'a `<section>` is 3 px narrower (was 120, now 117)'
    )
    expect(narrower({ tag: 'section', cls: ['mt-4', 'css-1a2b3c', 'ui-card--wide'] })).toBe(
      'a `<section>` is 3 px narrower (was 120, now 117)'
    )
    expect(narrower({ tag: 'p', cls: ['u-clip', 'u-ink-2'] })).toBe(
      'a `<p>` is 3 px narrower (was 120, now 117)'
    )
  })

  it.each([
    ['ul', 'a `<ul>`'],
    ['ol', 'an `<ol>`'],
    ['hr', 'an `<hr>`'],
    ['svg', 'an `<svg>`'],
    ['u', 'a `<u>`'],
    ['ui-panel', 'a `<ui-panel>`'],
    ['tbody', 'a `<tbody>`'],
    ['article', 'an `<article>`'],
  ])('says the article as the tag is said, letter by letter or as a word: %s', (tag, name) => {
    expect(narrower({ tag })).toBe(`${name} is 3 px narrower (was 120, now 117)`)
  })

  it('names it by the class its component kind is read from, written as DevTools writes an element', () => {
    const card: Spec = { tag: 'div', cls: ['u-mt-2', 'u-px-4', 'ui-card--wide', 'ui-card'] }
    expect(observed(card, { ...card, box: [10, 10, 117, 36] })).toEqual({
      element: { class: 'ui-card', tag: 'div' },
      facts: [{ kind: 'width', from: 120, to: 117 }],
      text: 'a `<div.ui-card>` is 3 px narrower (was 120, now 117)',
    })
    expect(narrower({ tag: 'article', testId: 'order-12', cls: ['ui-card'] })).toBe(
      'an `<article.ui-card>` is 3 px narrower (was 120, now 117)'
    )
    expect(narrower({ tag: 'td', role: 'cell', cls: ['ui-cell'] })).toBe(
      'a `<td.ui-cell>` is 3 px narrower (was 120, now 117)'
    )
    expect(narrower({ tag: 'span', text: 'Item one', cls: ['ui-badge'] })).toBe(
      'the "Item one" text is 3 px narrower (was 120, now 117)'
    )
    expect(narrower({ tag: 'button', role: 'button', cls: ['ui-btn'] })).toBe(
      'a `<button.ui-btn>` is 3 px narrower (was 120, now 117)'
    )
    expect(
      text(
        { cls: ['ui-card'], style: { 'box-shadow': 'none' } },
        { cls: ['ui-card'], style: { 'box-shadow': 'rgb(0, 0, 0) 0px 2px 4px 0px' } }
      )
    ).toBe("a `<div.ui-card>`'s shadow appears")
  })

  it('puts a first fact about a part of the element in the possessive, and the text of a text', () => {
    expect(styled({ 'box-shadow': 'none' }, { 'box-shadow': 'rgb(0, 0, 0) 0px 2px 4px 0px' })).toBe(
      "a `<div>`'s shadow appears"
    )
    expect(text({ tag: 'span', text: 'Item one' }, { tag: 'span', text: 'Item two' })).toBe(
      'the "Item one" text changed (was "Item one", now "Item two")'
    )
  })
})

describe('observe: facts', () => {
  it('says an added element appears and a removed one is gone', () => {
    const both = screen([button], [])
    expect(observe(both, { removed: 2 })?.text).toBe('the "Send" button is gone')
    const added = screen([], [button])
    expect(observe(added, { added: 2 })).toEqual({
      element: { role: 'button', name: 'Send', tag: 'button' },
      facts: [{ kind: 'appears' }],
      text: 'the "Send" button appears',
    })
  })

  it.each([
    [{ opacity: '0' }, { opacity: '1' }, 'a `<div>` becomes visible'],
    [{}, { visibility: 'hidden' }, 'a `<div>` becomes invisible'],
    [{ opacity: '0.5' }, { opacity: '1' }, undefined],
  ])('says when it becomes visible or invisible: %j -> %j', (from, to, expected) => {
    expect(styled(from, to)).toBe(expected)
  })

  it('gives sizes in whole CSS px and the difference of the rounded values', () => {
    expect(text({ box: [10, 10, 80.6, 48] }, { box: [10, 10, 70.3, 48] })).toBe(
      'a `<div>` is 11 px narrower (was 81, now 70)'
    )
    expect(text({ box: [10, 10, 1500, 36] }, { box: [10, 10, 1250, 48] })).toBe(
      'a `<div>` is 250 px narrower (was 1,500, now 1,250) and 12 px taller (was 36, now 48)'
    )
    expect(text({ box: [10, 10, 120, 36] }, { box: [10, 10, 120.9, 36] })).toBeUndefined()
  })

  it('says where it moved only when its size stayed', () => {
    expect(text({ box: [10, 22, 120, 36] }, { box: [6, 10, 120, 36] })).toBe(
      'a `<div>` moved 4 px left and 12 px up'
    )
    expect(text({ box: [10, 10, 120, 36] }, { box: [10, 22, 120, 48] })).toBe(
      'a `<div>` is 12 px taller (was 36, now 48)'
    )
  })

  it('says a move after what changed on the element itself', () => {
    expect(
      text(
        { tag: 'span', text: 'Item one', box: [10, 22, 120, 36] },
        { tag: 'span', text: 'Item two', box: [6, 22, 120, 36] }
      )
    ).toBe('the "Item one" text changed (was "Item one", now "Item two") and moved 4 px left')
  })

  it('quotes a changed text while both sides are short', () => {
    expect(text(button, { ...button, text: 'Send now' })).toBe(
      'the "Send" button\'s label changed (was "Send", now "Send now")'
    )
    expect(text({ text: 'x'.repeat(41) }, { text: 'y'.repeat(41) })).toBe(
      "a `<div>`'s text changed"
    )
  })

  it.each([
    [
      { 'font-size': '14px' },
      { 'font-size': '16px' },
      "a `<div>`'s text is larger (was 14 px, now 16 px)",
    ],
    [{ 'font-weight': '500' }, { 'font-weight': '700' }, "a `<div>`'s text is bolder"],
    [{ 'font-weight': 'bold' }, { 'font-weight': '400' }, "a `<div>`'s text is less bold"],
    [{ 'letter-spacing': '2px' }, {}, "a `<div>`'s text is spaced tighter"],
    [{}, { 'letter-spacing': '0.5px' }, "a `<div>`'s text is spaced wider"],
    [{ 'line-height': '20px' }, { 'line-height': '24px' }, "a `<div>`'s lines are taller"],
    [{}, { 'line-height': '24px' }, undefined],
    [{}, { 'text-transform': 'uppercase' }, "a `<div>`'s text is now uppercase"],
    [{ 'text-transform': 'uppercase' }, {}, "a `<div>`'s text is no longer uppercase"],
    [{}, { 'text-transform': 'capitalize' }, undefined],
  ])('reads the type of its text: %j -> %j', (from, to, expected) => {
    expect(styled(from, to)).toBe(expected)
  })

  it('calls an element named by its words text when the line starts with its text, else an element', () => {
    const col = (padding: string): Spec => ({
      text: 'Col',
      style: { 'padding-left': padding, color: 'rgb(0, 0, 0)' },
    })
    expect(observed(col('0px'), col('8px'))?.text).toBe(
      'the "Col" element\'s inner spacing grew by 8 px'
    )
    expect(observed(col('0px'), { ...col('0px'), style: { color: 'rgb(51, 51, 51)' } })?.text).toBe(
      'the "Col" text is lighter (was #000000, now #333333)'
    )
  })

  it('says its text uses another font', () => {
    expect(
      text({ text: 'Item one', font: 'Fixture Sans' }, { text: 'Item one', font: 'Fixture Serif' })
    ).toBe('the "Item one" text uses another font (was Fixture Sans, now Fixture Serif)')
  })

  it('calls the text of a button or a link its label', () => {
    expect(text(button, { ...button, style: { 'font-weight': '700' } })).toBe(
      'the "Send" button\'s label is bolder'
    )
    const link: Spec = { tag: 'a', role: 'link', name: 'More' }
    expect(text(link, { ...link, style: { 'letter-spacing': '1px' } })).toBe(
      'the "More" link\'s label is spaced wider'
    )
  })

  it.each([
    ['rgb(0, 0, 0)', 'rgb(0, 0, 1)', "a `<div>`'s text is lighter (was #000000, now #000001)"],
    ['rgb(0, 0, 1)', 'rgb(0, 0, 0)', "a `<div>`'s text is darker (was #000001, now #000000)"],
    [
      'rgb(0, 7, 162)',
      'rgb(0, 55, 12)',
      "a `<div>`'s text changed colour (was #0007a2, now #00370c)",
    ],
    [
      'rgb(0, 0, 0)',
      'rgba(0, 0, 0, 0.5)',
      "a `<div>`'s text changed colour (was #000000, now #00000080)",
    ],
  ])('compares text colours by relative luminance: %s -> %s', (from, to, expected) => {
    expect(styled({ color: from }, { color: to })).toBe(expected)
  })

  it.each([
    [
      'rgb(255, 255, 255)',
      'rgba(0, 0, 0, 0)',
      "a `<div>`'s background changed (was #ffffff, now transparent)",
    ],
    [
      'rgb(255, 255, 255)',
      'rgb(240, 240, 240)',
      "a `<div>`'s background is darker (was #ffffff, now #f0f0f0)",
    ],
    ['rgba(255, 255, 255, 0)', 'rgba(0, 0, 0, 0)', undefined],
  ])('reads a background change: %s -> %s', (from, to, expected) => {
    expect(styled({ 'background-color': from }, { 'background-color': to })).toBe(expected)
  })

  const border = (width: string, style: string, color: string): Record<string, string> =>
    Object.fromEntries(
      SIDES.flatMap((side) => [
        [`border-${side}-width`, width],
        [`border-${side}-style`, style],
        [`border-${side}-color`, color],
      ])
    )

  it.each([
    [border('0px', 'none', 'rgb(0, 0, 0)'), border('1px', 'solid', 'rgb(0, 0, 0)'), 'appears'],
    [border('1px', 'solid', 'rgba(0, 0, 0, 0)'), border('1px', 'solid', 'rgb(0, 0, 0)'), 'appears'],
    [border('1px', 'solid', 'rgb(0, 0, 0)'), border('0px', 'solid', 'rgb(0, 0, 0)'), 'disappears'],
    [
      border('1px', 'solid', 'rgb(0, 0, 0)'),
      border('1px', 'solid', 'rgb(9, 9, 9)'),
      'changes colour',
    ],
  ])('says its border %s', (from, to, expected) => {
    expect(styled(from, to)).toBe(`a \`<div>\`'s border ${expected}`)
  })

  it('says nothing about a border that paints on neither side', () => {
    expect(
      styled(border('0px', 'solid', 'rgb(0, 0, 0)'), border('0px', 'solid', 'rgb(9, 9, 9)'))
    ).toBeUndefined()
  })

  const corners = (radius: string): Record<string, string> =>
    Object.fromEntries(CORNERS.map((corner) => [`border-${corner}-radius`, radius]))

  it.each([
    [corners('4px'), corners('8px'), "a `<div>`'s corners are rounder"],
    [corners('8px 4px'), corners('2px'), "a `<div>`'s corners are sharper"],
    [corners('4px'), corners('50%'), undefined],
  ])('compares the largest corner radius: %j -> %j', (from, to, expected) => {
    expect(styled(from, to)).toBe(expected)
  })

  it.each([
    ['none', 'rgb(0, 0, 0) 0px 2px 4px 0px', 'appears'],
    ['rgb(0, 0, 0) 0px 2px 4px 0px', 'rgb(0, 0, 0) 0px 0px 0px 0px', 'disappears'],
    ['rgb(0, 0, 0) 0px 2px 4px 0px', 'rgb(0, 0, 0) 0px 4px 8px 0px', 'changes'],
  ])('says its shadow %s', (from, to, expected) => {
    expect(styled({ 'box-shadow': from }, { 'box-shadow': to })).toBe(
      `a \`<div>\`'s shadow ${expected}`
    )
  })

  it('adds the paddings up, and says so only when the size stayed', () => {
    const padded = { 'padding-left': '8px', 'padding-right': '8px' }
    expect(styled(padded, { 'padding-left': '2px', 'padding-right': '2px' })).toBe(
      "a `<div>`'s inner spacing shrank by 12 px"
    )
    expect(styled({}, { 'padding-top': '4px' })).toBe("a `<div>`'s inner spacing grew by 4 px")
    expect(
      text({ style: padded }, { box: [10, 10, 108, 36], style: { 'padding-left': '2px' } })
    ).toBe('a `<div>` is 12 px narrower (was 120, now 108)')
  })
})

describe('observe: the line', () => {
  it('keeps the first three facts in the table order and lets a repeated lead go', () => {
    const after: Spec = {
      ...button,
      box: [10, 10, 117, 36],
      style: {
        'background-color': 'rgb(9, 9, 9)',
        'letter-spacing': '-0.5px',
        'font-weight': '300',
        opacity: '0',
      },
    }
    const observation = observed(button, after)
    expect(observation?.facts.map((f) => f.kind)).toEqual(['invisible', 'width', 'font-weight'])
    expect(observation?.text).toBe(
      'the "Send" button becomes invisible, is 3 px narrower (was 120, now 117) and its label is less bold'
    )
    const label = observed(
      { ...button, style: { 'letter-spacing': '2px' } },
      { ...after, style: { 'font-weight': '300' } }
    )
    expect(label?.text).toBe(
      'the "Send" button is 3 px narrower (was 120, now 117), its label is less bold and spaced tighter'
    )
    expect(
      styled(
        { color: 'rgb(0, 0, 0)', 'font-size': '14px' },
        { color: 'rgb(51, 51, 51)', 'font-size': '16px' }
      )
    ).toBe(
      "a `<div>`'s text is larger (was 14 px, now 16 px) and lighter (was #000000, now #333333)"
    )
  })

  it('observes nothing under every threshold or for a paint order change alone', () => {
    expect(text({ box: [10, 10, 120, 36] }, { box: [10.5, 10.5, 120.5, 36] })).toBeUndefined()
    expect(styled({}, { 'z-index': '2' })).toBeUndefined()
    expect(styled({ 'letter-spacing': 'normal' }, { 'letter-spacing': '0px' })).toBeUndefined()
  })
})
