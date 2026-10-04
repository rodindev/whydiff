import { lcs } from './lcs.js'

describe('lcs', () => {
  it('finds the longest common subsequence as index pairs', () => {
    expect(lcs(['a', 'b', 'c', 'd'], ['b', 'd', 'c'])).toEqual([
      [1, 0],
      [3, 1],
    ])
  })

  it('skips the before element on ties', () => {
    expect(lcs(['a', 'b'], ['b', 'a'])).toEqual([[1, 0]])
  })

  it('handles empty inputs', () => {
    expect(lcs([], ['a'])).toEqual([])
    expect(lcs(['a'], [])).toEqual([])
  })

  it('pairs equal runs in order', () => {
    expect(lcs(['x', 'x', 'x'], ['x', 'x'])).toEqual([
      [0, 0],
      [1, 1],
    ])
  })
})
