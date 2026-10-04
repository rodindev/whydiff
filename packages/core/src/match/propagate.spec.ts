import { buildSnapshot, type TreeSpec } from '../testing/snapshots.js'
import { anchor } from './keys.js'
import { propagate } from './propagate.js'
import { createState, type MatchState } from './state.js'
import type { Pair } from './types.js'
import { viewOf } from './view.js'

const page = (children: readonly TreeSpec[]): TreeSpec[] => [
  {
    tag: 'html',
    box: [0, 0, 1000, 800],
    children: [{ tag: 'body', box: [0, 0, 1000, 800], children }],
  },
]
const cell = (text: string): TreeSpec => ({ tag: 'td', text })
const record = (cls: readonly string[], ...cells: readonly string[]): TreeSpec => ({
  tag: 'tr',
  cls,
  children: cells.map(cell),
})
const entry = (title: string, version: string): TreeSpec => ({
  tag: 'li',
  children: [
    { tag: 'h3', text: title },
    { tag: 'span', text: version },
  ],
})
const table = (rows: readonly TreeSpec[]): TreeSpec[] => page([{ tag: 'table', children: rows }])

function run(before: TreeSpec[], after: TreeSpec[]): MatchState {
  const state = createState(viewOf(buildSnapshot(before)), viewOf(buildSnapshot(after)))
  anchor(state)
  propagate(state)
  return state
}
const pairOf = (state: MatchState, before: number): Pair | undefined =>
  state.pairs.find((p) => p.before === before)

describe('pass 2: descendant anchors', () => {
  const lookAlikes = (cls: readonly string[]): TreeSpec[] =>
    table([
      record(['row'], 'Carol', '$300.00'),
      record(cls, 'Alice', '$120.00'),
      record(['row'], 'Dave', '$450.00'),
    ])

  it('follows the anchored cells to the look-alike sibling that holds them', () => {
    const state = run(table([record(['row'], 'Alice', '$120.00')]), lookAlikes(['row']))
    expect(pairOf(state, 3)).toEqual({ before: 3, after: 6, confidence: 950, pass: 2 })
    expect(state.beforeOf[3]).toBe(-1)
    expect(state.beforeOf[9]).toBe(-1)
  })

  it('pairs at the loose tier when only tag and role agree, never across tags', () => {
    const loose = run(table([record(['row'], 'Alice', '$120.00')]), lookAlikes(['row', 'odd']))
    expect(pairOf(loose, 3)).toEqual({ before: 3, after: 6, confidence: 850, pass: 2 })
    const retagged = run(
      page([{ tag: 'section', children: [{ tag: 'h2', text: 'Shipping' }] }]),
      page([{ tag: 'div', children: [{ tag: 'h2', text: 'Shipping' }] }])
    )
    expect(pairOf(retagged, 2)).toBeUndefined()
    expect(pairOf(retagged, 3)).toMatchObject({ after: 3, pass: 1 })
  })

  it('leaves conflicting votes to the tiers instead of a majority', () => {
    const state = run(
      table([record(['row'], 'Alice', 'Bob', 'Eve'), record(['row'], 'Carol', 'Dave')]),
      table([record(['row'], 'Eve', 'Dave'), record(['row'], 'Alice', 'Bob')])
    )
    expect(pairOf(state, 3)).toEqual({ before: 3, after: 3, confidence: 950, pass: 2 })
    expect(pairOf(state, 7)).toEqual({ before: 7, after: 6, confidence: 950, pass: 2 })
  })

  it('splits the gap around the pairs and aligns the rest between them', () => {
    const state = run(
      table([
        record(['row'], 'Alice', '$120.00'),
        record(['row'], 'Bob', '$250.00'),
        record(['row'], 'Carol', '$300.00'),
      ]),
      table([
        record(['row'], 'Alice', '$120.00'),
        record(['row'], 'Erin', '$510.00'),
        record(['row'], 'Carol', '$300.00'),
      ])
    )
    expect(state.afterOf.slice(3)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11])
  })
})

describe('pass 2: clones', () => {
  const list = (entries: readonly TreeSpec[]): TreeSpec[] =>
    page([{ tag: 'ul', children: entries }])
  const before = list([entry('Release', 'v2'), entry('Hotfix', 'v1')])

  it('keeps the original on the original when the clone differs below', () => {
    const state = run(
      before,
      list([entry('Release', 'v3'), entry('Release', 'v2'), entry('Hotfix', 'v1')])
    )
    expect(state.afterOf.slice(3)).toEqual([6, 7, 8, 9, 10, 11])
    expect(state.beforeOf.slice(3, 6)).toEqual([-1, -1, -1])
  })

  it('pairs an exact clone by position', () => {
    const state = run(
      before,
      list([entry('Release', 'v2'), entry('Release', 'v2'), entry('Hotfix', 'v1')])
    )
    expect(state.afterOf.slice(3)).toEqual([3, 4, 5, 9, 10, 11])
    expect(state.beforeOf.slice(6, 9)).toEqual([-1, -1, -1])
  })
})
