import { AMBIGUITY_MARGIN_Q, MATCH_THRESHOLD_Q, REGION_MARGIN } from '../constants.js'
import type { ImageV1, Rect } from '../snapshot/types.js'
import { similarity, type Shift } from './similarity.js'
import { isFreeAfter, isFreeBefore, pair, type MatchState } from './state.js'
import type { MatchOptions, Pair } from './types.js'
import { interchangeable, type SideView } from './view.js'

interface Edge {
  readonly before: number
  readonly after: number
  readonly score: number
}

/** Pass 3: scores free nodes around the diff regions and pairs them greedily, best edge first. */
export function assign(state: MatchState, options: MatchOptions): void {
  const halosB = options.regions.map((r) => inflate(toDocument(r, state.before.snapshot.image)))
  const halosA = options.regions.map((r) => inflate(toDocument(r, state.after.snapshot.image)))
  const candidatesB = candidates(state.before, halosB, options.massChange ?? false).filter((n) =>
    isFreeBefore(state, n)
  )
  const candidatesA = candidates(state.after, halosA, options.massChange ?? false).filter((n) =>
    isFreeAfter(state, n)
  )
  const shifts = halosB.map((halo) => haloShift(state, halo))
  const edges: Edge[] = []
  for (const before of candidatesB) {
    const shift =
      shifts[halosB.findIndex((halo) => intersects(halo, state.before.nodes[before]?.box))] ?? NONE
    for (const after of candidatesA) {
      const score = similarity(state, before, after, shift)
      if (score !== null && score >= MATCH_THRESHOLD_Q) edges.push({ before, after, score })
    }
  }
  edges.sort(
    (x, y) =>
      y.score - x.score ||
      Math.min(x.before, x.after) - Math.min(y.before, y.after) ||
      Math.max(x.before, x.after) - Math.max(y.before, y.after) ||
      x.before - y.before
  )
  const taken: { edge: Edge; entry: Pair }[] = []
  for (const edge of edges) {
    if (!isFreeBefore(state, edge.before) || !isFreeAfter(state, edge.after)) continue
    taken.push({
      edge,
      entry: pair(state, edge.before, edge.after, Math.floor(edge.score / 1000), 3),
    })
  }
  for (const { edge, entry } of taken) {
    const rival = edges.find(
      (other) =>
        other !== edge &&
        other.score > edge.score - AMBIGUITY_MARGIN_Q &&
        ((other.before === edge.before && !interchangeable(state.after, other.after, edge.after)) ||
          (other.after === edge.after && !interchangeable(state.before, other.before, edge.before)))
    )
    if (rival !== undefined) {
      const at = state.pairs.indexOf(entry)
      state.pairs[at] = { ...entry, ambiguous: true }
    }
  }
}

const NONE: Shift = { dx: 0, dy: 0 }

/** A diff region in PNG pixels, as a rect in the document space of one snapshot. */
function toDocument(region: Rect, image: ImageV1): Rect {
  return [
    region[0] / image.k + image.origin[0],
    region[1] / image.k + image.origin[1],
    region[2] / image.k,
    region[3] / image.k,
  ]
}

function inflate(rect: Rect): Rect {
  return [
    rect[0] - REGION_MARGIN,
    rect[1] - REGION_MARGIN,
    rect[2] + 2 * REGION_MARGIN,
    rect[3] + 2 * REGION_MARGIN,
  ]
}

function intersects(halo: Rect, box: Rect | undefined): boolean {
  if (box === undefined) return false
  return (
    box[0] <= halo[0] + halo[2] &&
    halo[0] <= box[0] + box[2] &&
    box[1] <= halo[1] + halo[3] &&
    halo[1] <= box[1] + box[3]
  )
}

function candidates(view: SideView, halos: readonly Rect[], all: boolean): number[] {
  return view.nodes
    .filter((node) => all || halos.some((halo) => intersects(halo, node.box)))
    .map((node) => node.i)
}

/** Lower median displacement of the pairs whose before box lies in the halo. */
function haloShift(state: MatchState, halo: Rect): Shift {
  const dx: number[] = []
  const dy: number[] = []
  for (const { before, after } of state.pairs) {
    const b = state.before.nodes[before]
    const a = state.after.nodes[after]
    if (b === undefined || a === undefined || !intersects(halo, b.box)) continue
    dx.push(a.box[0] - b.box[0])
    dy.push(a.box[1] - b.box[1])
  }
  return { dx: lowerMedian(dx), dy: lowerMedian(dy) }
}

function lowerMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((x, y) => x - y)
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0
}
