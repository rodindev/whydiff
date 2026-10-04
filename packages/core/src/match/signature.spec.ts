import { buildSnapshot, type TreeSpec } from '../testing/snapshots.js'
import { viewOf } from './view.js'

const fingerprintOf = (root: TreeSpec): string => viewOf(buildSnapshot([root])).fingerprint[0] ?? ''
const card = (cls: readonly string[], text: string): TreeSpec => ({
  tag: 'div',
  cls,
  children: [{ tag: 'p', text }],
})

describe('fingerprints', () => {
  it('ignore class order and build hashes', () => {
    expect(fingerprintOf(card(['card', 'wide'], 'Hello'))).toBe(
      fingerprintOf(card(['wide', 'css-1a2b3c', 'card'], 'Hello'))
    )
  })

  it('change with a nested text', () => {
    expect(fingerprintOf(card(['card'], 'Hello'))).not.toBe(fingerprintOf(card(['card'], 'Hola')))
  })

  it('change with the own text, a class and the order of the children', () => {
    const base = fingerprintOf(card(['card'], 'Hello'))
    expect(fingerprintOf({ ...card(['card'], 'Hello'), text: 'Title' })).not.toBe(base)
    expect(fingerprintOf(card(['card', 'wide'], 'Hello'))).not.toBe(base)
    const twoKids = (first: string, second: string): TreeSpec => ({
      tag: 'div',
      children: [
        { tag: 'p', text: first },
        { tag: 'p', text: second },
      ],
    })
    expect(fingerprintOf(twoKids('a', 'b'))).not.toBe(fingerprintOf(twoKids('b', 'a')))
  })
})
