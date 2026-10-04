import { Parser } from 'commonmark'
import fc from 'fast-check'

import { code, quoted, safe } from './format.js'

/** The inline nodes CommonMark reads from one line, as `type:literal`. */
function inlines(line: string): string[] {
  const paragraph = new Parser().parse(line).firstChild
  const out: string[] = []
  for (let node = paragraph?.firstChild ?? null; node !== null; node = node.next) {
    out.push(`${node.type}:${node.literal ?? ''}`)
  }
  return out
}

describe('code', () => {
  it('fences past the longest backtick run and pads where a fence or a space would be lost', () => {
    expect(code("locator('div.\\!ui-p-0')")).toBe("`locator('div.\\!ui-p-0')`")
    expect(code('a `b` c')).toBe('``a `b` c``')
    expect(code('`a')).toBe('`` `a ``')
    expect(code(' a ')).toBe('`  a  `')
  })

  it('reads back as the same text in a CommonMark code span, whatever it holds', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => !/[\n\r]/.test(s)),
        (text) => {
          expect(inlines(`at ${code(text)} here`)).toEqual([
            'text:at ',
            `code:${text}`,
            'text: here',
          ])
        }
      )
    )
  })
})

describe('safe and quoted', () => {
  it('leave text without markup as it is and put the rest in a code span', () => {
    expect(safe('s1 >> renders | 12px #fff (a, b)')).toBe('s1 >> renders | 12px #fff (a, b)')
    expect(safe('tests/__main__/a.spec.ts')).toBe('`tests/__main__/a.spec.ts`')
    expect(safe('sign_up > form_filled')).toBe('sign_up > form_filled')
    expect(quoted('Save')).toBe('"Save"')
    expect(quoted('Email *')).toBe('`"Email *"`')
    expect(quoted('a "b"')).toBe('`"a \\"b\\""`')
  })

  it('never let CommonMark read markup in what they return', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom(...'ab1 _*`<>[]()!&;#~\\-.:'.split('')) }),
        (text) => {
          const types = inlines(`x ${safe(text)} y`).map((node) => node.slice(0, node.indexOf(':')))
          expect(types.every((type) => type === 'text' || type === 'code')).toBe(true)
        }
      )
    )
  })
})
