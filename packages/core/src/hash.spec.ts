import { fnv1a64 } from './hash.js'

describe('fnv1a64', () => {
  it('pins known hashes so cluster ids never drift', () => {
    expect(fnv1a64('')).toBe('33niihzj4ux45')
    expect(fnv1a64('a')).toBe('2o0ongoiv4rrg')
    expect(fnv1a64('k1|ui-btn|style|color=rgb(0, 0, 0)>rgb(9, 9, 9)')).toBe('1h66kd17rzgge')
    expect(fnv1a64('hello')).not.toBe(fnv1a64('hellp'))
  })
})
