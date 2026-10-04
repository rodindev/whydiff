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
