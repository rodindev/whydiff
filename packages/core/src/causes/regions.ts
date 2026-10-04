import { MAX_CANDIDATES } from '../constants.js'
import { PIXEL_DIFFERENT, type DiffMask, type Region } from '../pixels/index.js'
import type { ImageV1, Rect } from '../snapshot/types.js'
import type { SideView } from '../match/view.js'
import { boxOf, depthOf, intersects, paints, type Ctx } from './context.js'
import type { Candidate } from './types.js'

/** A region in the document space of one side. */
export function regionRect(region: Region, image: ImageV1): Rect {
  return [
    region.x / image.k + image.origin[0],
    region.y / image.k + image.origin[1],
    region.width / image.k,
    region.height / image.k,
  ]
}

/** A summed-area table of a mask's differing pixels: entry `y * (width + 1) + x` counts those left of x and above y. */
export interface DiffSums {
  readonly width: number
  readonly height: number
  readonly sums: Uint32Array
}

/** Sums the differing pixels of the mask once, so any box counts them in constant time. */
export function diffSums(mask: DiffMask): DiffSums {
  // Read once: under Vitest every read of an imported binding is a getter call.
  const different = PIXEL_DIFFERENT
  const stride = mask.width + 1
  const sums = new Uint32Array(stride * (mask.height + 1))
  for (let y = 0; y < mask.height; y++) {
    let row = 0
    for (let x = 0; x < mask.width; x++) {
      if (mask.classes[y * mask.width + x] === different) row++
      sums[(y + 1) * stride + x + 1] = (sums[y * stride + x + 1] ?? 0) + row
    }
  }
  return { width: mask.width, height: mask.height, sums }
}

/** Differing pixels inside `box` (document space of `image`), over the box area, per mille. */
export function diffShare(diff: DiffSums, box: Rect, image: ImageV1): number {
  const x0 = Math.max(0, Math.floor((box[0] - image.origin[0]) * image.k))
  const y0 = Math.max(0, Math.floor((box[1] - image.origin[1]) * image.k))
  const x1 = Math.min(diff.width, Math.ceil((box[0] + box[2] - image.origin[0]) * image.k))
  const y1 = Math.min(diff.height, Math.ceil((box[1] + box[3] - image.origin[1]) * image.k))
  const area = (x1 - x0) * (y1 - y0)
  if (area <= 0) return 0
  const at = (x: number, y: number): number => diff.sums[y * (diff.width + 1) + x] ?? 0
  // Two negative spans make a positive area over no pixels.
  const count = x0 < x1 && y0 < y1 ? at(x1, y1) - at(x0, y1) - at(x1, y0) + at(x0, y0) : 0
  return Math.floor((1000 * count) / area)
}

interface Scored extends Candidate {
  readonly depth: number
  readonly index: number
}

/** Nodes touching the region on either side, best first. */
export function candidates(ctx: Ctx, region: Region, diff: DiffSums): Candidate[] {
  const scored: Scored[] = []
  const areaBefore = regionRect(region, ctx.before.snapshot.image)
  const areaAfter = regionRect(region, ctx.after.snapshot.image)
  const score = (view: SideView, index: number, area: Rect): number | null =>
    paints(view, index) && intersects(boxOf(view, index), area)
      ? diffShare(diff, boxOf(view, index), view.snapshot.image)
      : null
  for (const delta of ctx.deltas.pairs) {
    const before = score(ctx.before, delta.before, areaBefore)
    const after = score(ctx.after, delta.after, areaAfter)
    if (before === null && after === null) continue
    scored.push({
      before: delta.before,
      after: delta.after,
      share: Math.max(before ?? 0, after ?? 0),
      depth: depthOf(ctx.before, delta.before),
      index: delta.before,
    })
  }
  for (const { node } of ctx.deltas.removed) {
    const share = score(ctx.before, node, areaBefore)
    if (share !== null)
      scored.push({
        before: node,
        after: null,
        share,
        depth: depthOf(ctx.before, node),
        index: node,
      })
  }
  for (const { node } of ctx.deltas.added) {
    const share = score(ctx.after, node, areaAfter)
    if (share !== null)
      scored.push({
        before: null,
        after: node,
        share,
        depth: depthOf(ctx.after, node),
        index: node,
      })
  }
  return scored
    .sort((a, b) => b.share - a.share || b.depth - a.depth || a.index - b.index)
    .slice(0, MAX_CANDIDATES)
    .map(({ before, after, share }) => ({ before, after, share }))
}
