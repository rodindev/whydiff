import type { StyleLookup } from './derived.js'
import { isInherited, sameInheritedChange } from './inherited.js'

const lookup =
  (values: Record<string, string>): StyleLookup =>
  (prop) =>
    values[prop] ?? null
const sides = (before: Record<string, string>, after: Record<string, string>) => ({
  before: lookup(before),
  after: lookup(after),
})

describe('isInherited', () => {
  it('knows the inherited subset of the whitelist', () => {
    expect(isInherited('font-weight')).toBe(true)
    expect(isInherited('direction')).toBe(true)
    expect(isInherited('padding-top')).toBe(false)
  })
})

describe('sameInheritedChange', () => {
  it('accepts equal value pairs and colours in other syntaxes', () => {
    const node = sides({ color: 'rgb(0, 0, 0)' }, { color: 'rgb(9, 9, 9)' })
    const parent = sides({ color: 'rgba(0, 0, 0, 1)' }, { color: 'rgb(9, 9, 9)' })
    expect(sameInheritedChange('color', node, parent)).toBe(true)
    expect(
      sameInheritedChange(
        'color',
        node,
        sides({ color: 'rgb(0, 0, 0)' }, { color: 'rgb(8, 8, 8)' })
      )
    ).toBe(false)
  })

  it('compares em-scaled lengths by their ratio to font-size and normal by name', () => {
    const node = sides(
      { 'letter-spacing': '0.875px', 'font-size': '14px' },
      { 'letter-spacing': 'normal', 'font-size': '14px' }
    )
    const parent = sides(
      { 'letter-spacing': '1px', 'font-size': '16px' },
      { 'letter-spacing': 'normal', 'font-size': '16px' }
    )
    expect(sameInheritedChange('letter-spacing', node, parent)).toBe(true)
    const line = sides(
      { 'line-height': '21px', 'font-size': '14px' },
      { 'line-height': '28px', 'font-size': '14px' }
    )
    expect(
      sameInheritedChange(
        'line-height',
        line,
        sides(
          { 'line-height': '24px', 'font-size': '16px' },
          { 'line-height': '32px', 'font-size': '16px' }
        )
      )
    ).toBe(true)
    expect(
      sameInheritedChange(
        'line-height',
        line,
        sides(
          { 'line-height': '24px', 'font-size': '16px' },
          { 'line-height': '30px', 'font-size': '16px' }
        )
      )
    ).toBe(false)
  })

  it('does not scale properties that are not em-based', () => {
    const node = sides({ 'font-size': '14px' }, { 'font-size': '12px' })
    expect(
      sameInheritedChange(
        'font-size',
        node,
        sides({ 'font-size': '16px' }, { 'font-size': '14px' })
      )
    ).toBe(false)
  })
})
