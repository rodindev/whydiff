import fc from 'fast-check'

import { normalizeClasses } from './classes.js'

describe('normalizeClasses', () => {
  it('sorts, deduplicates and keeps ordinary names', () => {
    expect(normalizeClasses(['ui-btn', 'u-font-sans', 'ui-btn', 'a'])).toEqual([
      'a',
      'u-font-sans',
      'ui-btn',
    ])
  })

  it('strips build hashes but keeps the readable part', () => {
    expect(
      normalizeClasses([
        'css-1a2b3c',
        'css-9z8y7x-SaveButton',
        'sc-bdfBwQ',
        'Card_title__x1Y2z',
        'data-v-7ba5bd90',
      ])
    ).toEqual(['Card_title', 'SaveButton'])
  })

  it('does not change its answer with the input order', () => {
    expect(normalizeClasses(['b', 'a'])).toEqual(normalizeClasses(['a', 'b']))
  })
})

describe('normalizeClasses: CSS Modules names of any length', () => {
  /** A quadratic pattern for the same names, slow on many `__` before a character outside `[\w-]`: the reference for any name. */
  const QUADRATIC_CSS_MODULES = /^([A-Za-z][\w-]*)__[A-Za-z0-9_-]{5,}$/
  /** The quadratic pattern takes seconds on the name below, the linear one about a millisecond. */
  const LINEAR_MS = 100
  const part = (maxLength: number, ...units: string[]): fc.Arbitrary<string> =>
    fc.string({ unit: fc.constantFrom(...units), maxLength })

  it('strips from any name the hash the quadratic pattern stripped', () => {
    const hashed = fc
      .tuple(
        part(1, 'a', 'Z', '0', '_'),
        part(4, 'a', 'Z', '0', '-', '__'),
        part(10, 'a', 'Z', '0', '_', '-', '__', '!')
      )
      .map(([first, block, hash]) => `${first}${block}__${hash}`)
    const names = fc
      .oneof(hashed, part(24, 'a', 'Z', '0', '_', '-', '__', '!'), fc.string())
      .filter((name) => !/^(?:css-|sc-|data-v-)/.test(name))
    fc.assert(
      fc.property(names, (name) => {
        expect(normalizeClasses([name])).toEqual([QUADRATIC_CSS_MODULES.exec(name)?.[1] ?? name])
      }),
      { numRuns: 2000 }
    )
  })

  it('reads a long name with many `__` in linear time', () => {
    const name = `a${'__a'.repeat(25_000)}!`
    const start = performance.now()
    const kept = normalizeClasses([name])
    expect(performance.now() - start).toBeLessThan(LINEAR_MS)
    expect(kept).toEqual([name])
  })
})
