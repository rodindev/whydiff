import fc from 'fast-check'

import type { RuleSummary } from '../cluster/types.js'
import { headlineOf } from './headline.js'
import type { CauseV1, FactV1, MemberV1, ObservationV1 } from './types.js'

type Element = ObservationV1['element']

const button: Element = { role: 'button', name: 'Save', tag: 'button' }
const card: Element = { class: 'ui-card', tag: 'div' }
const rule = (props: readonly string[]): RuleSummary => ({
  kind: 'rule',
  selector: '.ui-btn',
  sheet: 'app.css',
  sets: [...props],
  changed: [],
  unsets: [],
})
const member = (element: Element, facts: readonly FactV1[], index: number): MemberV1 => ({
  screenshot: `s${String(index)}`,
  locator: `locator('#e${String(index)}')`,
  elements: 1,
  effects: [],
  ...(facts.length === 0
    ? {}
    : { observation: { element, facts: [...facts], text: `observed ${String(index)}` } }),
})
const narrower = (by: number): FactV1 => ({ kind: 'width', from: 100, to: 100 - by })
const wider = (by: number): FactV1 => ({ kind: 'width', from: 100, to: 100 + by })
const totals = { screenshots: 120, pixels: 10_000 }

function headline(
  members: readonly (readonly [Element, readonly FactV1[]])[],
  summary: CauseV1['summary'] = rule(['padding-left'])
): string {
  return headlineOf(
    {
      members: members.map(([element, facts], index) => member(element, facts, index)),
      screenshots: 41,
      pixels: 900,
      summary,
    },
    totals
  )
}

describe('headlineOf', () => {
  it('says what every member shows, with the range, the screenshots and the share of changed pixels', () => {
    expect(
      headline([
        [button, [narrower(12)]],
        [button, [narrower(24)]],
        [button, [narrower(24)]],
      ])
    ).toBe(
      '3 buttons are 12 to 24 px narrower, on 41 of 120 changed screenshots, 9% of changed pixels'
    )
    const shadow: FactV1 = { kind: 'shadow', from: 'rgb(0, 0, 0) 0px 1px 2px 0px', to: 'none' }
    expect(
      headline(
        [
          [card, [shadow]],
          [card, [shadow]],
        ],
        rule(['box-shadow'])
      )
    ).toBe(
      'the shadows of 2 `<div.ui-card>` elements disappear, on 41 of 120 changed screenshots, 9% of changed pixels'
    )
  })

  it('counts the members a fact holds for when it holds for at least half of them, in the direction most of them took', () => {
    expect(
      headline([
        [button, [narrower(4)]],
        [button, [narrower(12)]],
        [button, [narrower(8)]],
        [button, [wider(8)]],
        [card, []],
      ])
    ).toBe(
      '3 of 5 buttons are 4 to 12 px narrower, on 41 of 120 changed screenshots, 9% of changed pixels'
    )
  })

  it('names the properties that changed when no fact holds for half the members', () => {
    expect(
      headline(
        [
          [button, [narrower(4)]],
          [button, [wider(8)]],
          [button, []],
          [button, []],
        ],
        rule(['padding-left', 'padding-right', 'margin-top'])
      )
    ).toBe(
      'the margin and padding properties of 4 buttons changed, on 41 of 120 changed screenshots, 9% of changed pixels'
    )
  })

  it('never says a size or a move for a cause whose properties only repaint', () => {
    const taller: FactV1 = { kind: 'height', from: 32, to: 34 }
    expect(
      headline(
        [
          [button, [taller]],
          [button, [taller]],
          [button, [taller]],
        ],
        rule(['filter'])
      )
    ).toBe(
      'the filter property of 3 buttons changed, on 41 of 120 changed screenshots, 9% of changed pixels'
    )
    expect(headline([[button, [taller]]], rule(['filter']))).toBe(
      'the filter property of 1 button changed, on 41 of 120 changed screenshots, 9% of changed pixels'
    )
  })

  it("says a size only on the axis the cause's properties move", () => {
    const taller: FactV1 = { kind: 'height', from: 37, to: 42 }
    const both = [narrower(16), taller]
    expect(
      headline(
        [
          [button, both],
          [button, both],
          [button, both],
        ],
        rule(['padding-bottom', 'padding-top'])
      )
    ).toBe('3 buttons are 5 px taller, on 41 of 120 changed screenshots, 9% of changed pixels')
    expect(
      headline(
        [
          [button, [taller]],
          [button, [taller]],
        ],
        rule(['margin-left', 'border-right-width'])
      )
    ).toBe(
      'the border-width and margin properties of 2 buttons changed, on 41 of 120 changed screenshots, 9% of changed pixels'
    )
  })

  it('reads a cause of one element as that element observed', () => {
    expect(headline([[button, [narrower(4)]]])).toBe(
      'observed 0, on 41 of 120 changed screenshots, 9% of changed pixels'
    )
  })

  it('puts an element that appears or goes before a fact more members hold', () => {
    const visible: FactV1 = { kind: 'visible' }
    expect(
      headline(
        [
          [button, [visible, narrower(4)]],
          [button, [visible, narrower(4)]],
          [button, [narrower(4)]],
        ],
        rule(['opacity', 'padding-left'])
      )
    ).toBe('2 of 3 buttons become visible, on 41 of 120 changed screenshots, 9% of changed pixels')
  })

  it('names up to three kinds of element, tags sharing one noun, and more as elements', () => {
    const link: Element = { role: 'link', name: 'More', tag: 'a' }
    const box: Element = { class: 'ui-box', tag: 'div' }
    const span: Element = { tag: 'span' }
    const facts = [narrower(4)]
    expect(
      headline([
        [button, facts],
        [button, facts],
        [link, facts],
      ])
    ).toMatch(/^3 buttons and links are /)
    expect(
      headline([
        [card, facts],
        [box, facts],
      ])
    ).toMatch(/^2 `<div.ui-box>` and `<div.ui-card>` elements are /)
    expect(
      headline([
        [button, facts],
        [link, facts],
        [card, facts],
        [span, facts],
      ])
    ).toMatch(/^4 elements are /)
  })

  it('says the same whatever the order of the members, and never states a fact for fewer than half of them', () => {
    const facts = fc.array(
      fc.tuple(fc.constantFrom(button, card), fc.option(fc.integer({ min: -30, max: 30 }))),
      { minLength: 1, maxLength: 12 }
    )
    fc.assert(
      fc.property(facts, fc.nat(), (list, seed) => {
        const members = list.map(([element, by]): readonly [Element, readonly FactV1[]] => [
          element,
          by === null || by === 0 ? [] : [by < 0 ? narrower(-by) : wider(by)],
        ])
        const shuffled = [...members].sort(
          (a, b) => ((members.indexOf(a) * 31 + seed) % 7) - ((members.indexOf(b) * 31 + seed) % 7)
        )
        const text = headline(members)
        if (members.length > 1) expect(headline(shuffled)).toBe(text)
        const held = /^(\d+) of (\d+) /.exec(text)
        if (held !== null) expect(Number(held[1]) * 2).toBeGreaterThanOrEqual(Number(held[2]))
        const said = /are \d+(?: to \d+)? px (narrower|wider)/.exec(text)?.[1]
        if (said !== undefined && held !== null) {
          const holders = members.filter(([, f]) => {
            const fact = f[0]
            return (
              fact !== undefined && (said === 'narrower') === Number(fact.to) < Number(fact.from)
            )
          })
          expect(holders).toHaveLength(Number(held[1]))
        }
      })
    )
  })
})
