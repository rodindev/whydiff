import { MATCH_WEIGHTS } from '../constants.js'
import { buildSnapshot } from '../testing/snapshots.js'
import { similarity, textSimilarity } from './similarity.js'
import { createState } from './state.js'
import { viewOf } from './view.js'

const NONE = { dx: 0, dy: 0 }

describe('textSimilarity', () => {
  it.each([
    ['Save', 'Save', 1000],
    ['Save', 'Saved', 800],
    ['', '', 1000],
    ['abc', 'xyz', 0],
  ])('scores %s against %s as %i', (a, b, expected) => {
    expect(textSimilarity(a, b)).toBe(expected)
  })
})

describe('similarity', () => {
  it('returns null when neither tag nor role is shared', () => {
    const state = createState(
      viewOf(buildSnapshot([{ tag: 'div' }])),
      viewOf(buildSnapshot([{ tag: 'span' }]))
    )
    expect(similarity(state, 0, 0, NONE)).toBeNull()
  })

  it('scores an identical node as a full match and ignores features absent on both sides', () => {
    const snapshot = buildSnapshot([
      { tag: 'button', role: 'button', name: 'Save', cls: ['a'], box: [10, 10, 80, 30] },
    ])
    const state = createState(viewOf(snapshot), viewOf(snapshot))
    expect(similarity(state, 0, 0, NONE)).toBe(1_000_000)
  })

  it('weighs stable features three times as much as weak ones', () => {
    const before = buildSnapshot([{ tag: 'div', box: [0, 0, 100, 100] }])
    const after = buildSnapshot([{ tag: 'div', box: [500, 500, 100, 100] }])
    const state = createState(viewOf(before), viewOf(after))
    const present =
      MATCH_WEIGHTS.tag +
      MATCH_WEIGHTS.iou +
      MATCH_WEIGHTS.sizeRatio +
      MATCH_WEIGHTS.shape +
      MATCH_WEIGHTS.siblingIndex +
      MATCH_WEIGHTS.frame
    const scored =
      MATCH_WEIGHTS.tag +
      MATCH_WEIGHTS.sizeRatio +
      MATCH_WEIGHTS.shape +
      MATCH_WEIGHTS.siblingIndex +
      MATCH_WEIGHTS.frame
    expect(similarity(state, 0, 0, NONE)).toBe(Math.floor((1_000_000 * scored) / present))
  })

  it('compares boxes after the halo shift', () => {
    const before = buildSnapshot([{ tag: 'div', box: [0, 0, 100, 100] }])
    const after = buildSnapshot([{ tag: 'div', box: [0, 40, 100, 100] }])
    const state = createState(viewOf(before), viewOf(after))
    expect(similarity(state, 0, 0, { dx: 0, dy: 40 })).toBe(1_000_000)
    expect(similarity(state, 0, 0, NONE)).toBeLessThan(1_000_000)
  })
})
