import {
  DESCENDANT_VOTES_MIN,
  LCS_MAX_CELLS,
  WRAPPER_BOX_TOL,
  WRAPPER_MAX_DEPTH,
} from '../constants.js'
import { lcs } from './lcs.js'
import { isFreeAfter, isFreeBefore, pair, type MatchState } from './state.js'
import type { SideView } from './view.js'

const STRICT = 950
const LOOSE = 850
const POSITIONAL = 800

/** Pass 2: pairs the document roots, then aligns the child lists of every pair top-down, recursing into new pairs. */
export function propagate(state: MatchState): void {
  const queue = state.pairs.map((p) => p.before).sort((x, y) => x - y)
  alignGap(state, -1, roots(state.before), roots(state.after), queue)
  for (const before of queue) {
    const after = state.afterOf[before] ?? -1
    if (after >= 0) alignChildren(state, before, after, queue)
  }
}

function alignChildren(state: MatchState, before: number, after: number, queue: number[]): void {
  const childrenB = state.before.children[before] ?? []
  const childrenA = state.after.children[after] ?? []
  splitAt(state, childrenB, childrenA, (gapB, gapA) => {
    alignGap(state, before, gapB, gapA, queue)
  })
}

/** Runs `align` on each run of free nodes between the separators: a longest increasing run of the pairs in `listB`. */
function splitAt(
  state: MatchState,
  listB: readonly number[],
  listA: readonly number[],
  align: (gapB: number[], gapA: number[]) => void
): void {
  const positionA = new Map(listA.map((child, index) => [child, index]))
  const separators = new Set(
    increasingRun(listB.map((child) => positionA.get(state.afterOf[child] ?? -1) ?? -1))
  )
  const freeA = (from: number, to: number): number[] =>
    listA.slice(from, to + 1).filter((child) => isFreeAfter(state, child))
  let gap: number[] = []
  let lastA = -1
  listB.forEach((child, index) => {
    if (isFreeBefore(state, child)) {
      gap.push(child)
      return
    }
    if (!separators.has(index)) return
    const position = positionA.get(state.afterOf[child] ?? -1) ?? -1
    align(gap, freeA(lastA + 1, position - 1))
    lastA = position
    gap = []
  })
  align(gap, freeA(lastA + 1, listA.length - 1))
}

/** Indices of a longest strictly increasing run among the non-negative values, earliest run on ties. */
function increasingRun(values: readonly number[]): number[] {
  const length: number[] = values.map(() => 0)
  const previous: number[] = values.map(() => -1)
  let best = -1
  values.forEach((value, i) => {
    if (value < 0) return
    length[i] = 1
    for (let j = 0; j < i; j++) {
      const earlier = values[j] ?? -1
      if (earlier >= 0 && earlier < value && (length[j] ?? 0) + 1 > (length[i] ?? 0)) {
        length[i] = (length[j] ?? 0) + 1
        previous[i] = j
      }
    }
    if ((length[i] ?? 0) > (best < 0 ? 0 : (length[best] ?? 0))) best = i
  })
  const run: number[] = []
  for (let i = best; i >= 0; i = previous[i] ?? -1) run.push(i)
  return run.reverse()
}

function alignGap(
  state: MatchState,
  parent: number,
  gapB: readonly number[],
  gapA: readonly number[],
  queue: number[]
): void {
  if (gapB.length === 0 || gapA.length === 0) return
  if (gapB.length * gapA.length > LCS_MAX_CELLS) {
    const [midB, midA] = trimEnds(state, gapB, gapA, queue)
    positional(state, midB, midA, queue, state.before.loose, state.after.loose)
    if (parent >= 0) state.lowConfidence.push(parent)
    return
  }
  for (const [before, after] of descendantAnchors(state, gapB, gapA)) {
    take(state, before, after, sameStrict(state, before, after) ? STRICT : LOOSE, queue)
  }
  splitAt(state, gapB, gapA, (subB, subA) => {
    tiers(state, subB, subA, queue)
  })
  const innerB = gapB.filter((n) => isFreeBefore(state, n)).map((n) => descendant(state.before, n))
  const innerA = gapA.filter((n) => isFreeAfter(state, n)).map((n) => descendant(state.after, n))
  const replaced = innerB.some((n, i) => n !== gapB[i]) || innerA.some((n, i) => n !== gapA[i])
  if (replaced) {
    tiers(
      state,
      innerB.filter((n) => isFreeBefore(state, n)),
      innerA.filter((n) => isFreeAfter(state, n)),
      queue
    )
  }
}

/** Before children whose matched descendants all point into one after child of the gap that nobody else points into. */
function descendantAnchors(
  state: MatchState,
  gapB: readonly number[],
  gapA: readonly number[]
): [number, number][] {
  const containerOf = new Map<number, number>()
  for (const child of gapA) {
    for (const node of descendants(state.after, child)) containerOf.set(node, child)
  }
  const votesOf = gapB.map((child) =>
    descendants(state.before, child)
      .map((node) => containerOf.get(state.afterOf[node] ?? -1) ?? -1)
      .filter((container) => container >= 0)
  )
  const voterOf = new Map<number, number>()
  gapB.forEach((child, index) => {
    for (const container of votesOf[index] ?? []) {
      const voter = voterOf.get(container)
      voterOf.set(container, voter === undefined || voter === child ? child : -1)
    }
  })
  return gapB.flatMap((child, index): [number, number][] => {
    const votes = votesOf[index] ?? []
    const target = votes[0] ?? -1
    const unanimous = votes.length >= DESCENDANT_VOTES_MIN && votes.every((v) => v === target)
    const paired = unanimous && voterOf.get(target) === child && sameLoose(state, child, target)
    return paired ? [[child, target]] : []
  })
}

/** Every node below `index`, in document order. */
function descendants(view: SideView, index: number): number[] {
  const out: number[] = []
  const visit = (node: number): void => {
    for (const child of view.children[node] ?? []) {
      out.push(child)
      visit(child)
    }
  }
  visit(index)
  return out
}

/** Pairs equal subtree fingerprints by LCS, then runs the signature tiers between them. */
function tiers(
  state: MatchState,
  listB: readonly number[],
  listA: readonly number[],
  queue: number[]
): void {
  const clones = lcs(
    listB.map((n) => state.before.fingerprint[n]),
    listA.map((n) => state.after.fingerprint[n])
  )
  const end: [number, number] = [listB.length, listA.length]
  let fromB = 0
  let fromA = 0
  for (const [i, j] of [...clones, end]) {
    signatureTiers(state, listB.slice(fromB, i), listA.slice(fromA, j), queue)
    if (i < listB.length) take(state, listB[i] ?? -1, listA[j] ?? -1, STRICT, queue)
    fromB = i + 1
    fromA = j + 1
  }
}

function signatureTiers(
  state: MatchState,
  listB: readonly number[],
  listA: readonly number[],
  queue: number[]
): void {
  const [midB, midA] = trimEnds(state, listB, listA, queue)
  const strictPairs = lcs(
    midB.map((n) => state.before.strict[n]),
    midA.map((n) => state.after.strict[n])
  )
  let fromB = 0
  let fromA = 0
  const end: [number, number] = [midB.length, midA.length]
  for (const [i, j] of [...strictPairs, end]) {
    const subB = midB.slice(fromB, i)
    const subA = midA.slice(fromA, j)
    const loosePairs = lcs(
      subB.map((n) => state.before.loose[n]),
      subA.map((n) => state.after.loose[n])
    )
    let subFromB = 0
    let subFromA = 0
    const subEnd: [number, number] = [subB.length, subA.length]
    for (const [x, y] of [...loosePairs, subEnd]) {
      positional(
        state,
        subB.slice(subFromB, x),
        subA.slice(subFromA, y),
        queue,
        state.before.nodes.map((n) => n.tag),
        state.after.nodes.map((n) => n.tag)
      )
      if (x < subB.length) take(state, subB[x] ?? -1, subA[y] ?? -1, LOOSE, queue)
      subFromB = x + 1
      subFromA = y + 1
    }
    if (i < midB.length) take(state, midB[i] ?? -1, midA[j] ?? -1, STRICT, queue)
    fromB = i + 1
    fromA = j + 1
  }
}

/** Pairs equal strict signatures at both ends; returns the untouched middles. */
function trimEnds(
  state: MatchState,
  listB: readonly number[],
  listA: readonly number[],
  queue: number[]
): [number[], number[]] {
  let lo = 0
  while (
    lo < listB.length &&
    lo < listA.length &&
    sameStrict(state, listB[lo] ?? -1, listA[lo] ?? -1)
  ) {
    take(state, listB[lo] ?? -1, listA[lo] ?? -1, STRICT, queue)
    lo++
  }
  let hiB = listB.length - 1
  let hiA = listA.length - 1
  while (hiB >= lo && hiA >= lo && sameStrict(state, listB[hiB] ?? -1, listA[hiA] ?? -1)) {
    take(state, listB[hiB] ?? -1, listA[hiA] ?? -1, STRICT, queue)
    hiB--
    hiA--
  }
  return [listB.slice(lo, hiB + 1), listA.slice(lo, hiA + 1)]
}

/** Pairs by position when both lists are equally long and agree element by element on `keys`. */
function positional(
  state: MatchState,
  listB: readonly number[],
  listA: readonly number[],
  queue: number[],
  keysB: readonly string[],
  keysA: readonly string[]
): void {
  if (listB.length === 0 || listB.length !== listA.length) return
  if (!listB.every((n, i) => keysB[n] === keysA[listA[i] ?? -1])) return
  listB.forEach((n, i) => {
    take(state, n, listA[i] ?? -1, POSITIONAL, queue)
  })
}

function roots(view: SideView): number[] {
  return view.nodes.filter((node) => node.p === -1).map((node) => node.i)
}

function sameStrict(state: MatchState, before: number, after: number): boolean {
  return state.before.strict[before] === state.after.strict[after]
}

function sameLoose(state: MatchState, before: number, after: number): boolean {
  return state.before.loose[before] === state.after.loose[after]
}

function take(
  state: MatchState,
  before: number,
  after: number,
  confidence: number,
  queue: number[]
): void {
  if (before < 0 || after < 0 || !isFreeBefore(state, before) || !isFreeAfter(state, after)) return
  pair(state, before, after, confidence, 2)
  queue.push(before)
}

/** The node a wrapper stands for: the end of its single-child chain, at most WRAPPER_MAX_DEPTH deep. */
export function descendant(view: SideView, index: number): number {
  let current = index
  for (let depth = 0; depth < WRAPPER_MAX_DEPTH; depth++) {
    const children = view.children[current] ?? []
    const painted = children.filter((c) => {
      const box = view.nodes[c]?.box
      return box !== undefined && box[2] > 0 && box[3] > 0
    })
    let next = -1
    if (children.length === 1) next = children[0] ?? -1
    else if (painted.length === 1 && sameBox(view, current, painted[0] ?? -1))
      next = painted[0] ?? -1
    if (next < 0) break
    current = next
  }
  return current
}

function sameBox(view: SideView, x: number, y: number): boolean {
  const a = view.nodes[x]?.box
  const b = view.nodes[y]?.box
  return (
    a !== undefined &&
    b !== undefined &&
    a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= WRAPPER_BOX_TOL)
  )
}
