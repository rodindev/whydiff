import { GEOM_EQ_TOL } from '../constants.js'
import type { ImageV1, Point, Rect } from '../snapshot/types.js'
import type { GeometryDelta } from './types.js'

export function geometryDelta(
  before: Rect,
  after: Rect,
  parentBefore: Rect | null,
  parentAfter: Rect | null
): GeometryDelta {
  const abs: Point = [after[0] - before[0], after[1] - before[1]]
  const rel: Point =
    parentBefore === null || parentAfter === null
      ? abs
      : [abs[0] - (parentAfter[0] - parentBefore[0]), abs[1] - (parentAfter[1] - parentBefore[1])]
  return { abs, rel, size: [after[2] - before[2], after[3] - before[3]] }
}

export function isZero(point: Point): boolean {
  return Math.abs(point[0]) <= GEOM_EQ_TOL && Math.abs(point[1]) <= GEOM_EQ_TOL
}

/** Whether `box` (document CSS px) intersects any region given in PNG pixels of `image`. */
export function touchesRegion(box: Rect, regions: readonly Rect[], image: ImageV1): boolean {
  return regions.some((region) => {
    const x = region[0] / image.k + image.origin[0]
    const y = region[1] / image.k + image.origin[1]
    const w = region[2] / image.k
    const h = region[3] / image.k
    return box[0] < x + w && x < box[0] + box[2] && box[1] < y + h && y < box[1] + box[3]
  })
}

/** The axis along which a size delta is larger: 0 for width, 1 for height. */
export function dominantAxis(size: Point): 0 | 1 {
  return Math.abs(size[1]) > Math.abs(size[0]) ? 1 : 0
}

/** Start and end of a box along an axis. */
export function span(box: Rect, axis: 0 | 1): readonly [number, number] {
  const start = box[axis]
  return [start, start + extent(box, axis)]
}

/** Width or height of a box. */
export function extent(box: Rect, axis: 0 | 1): number {
  return axis === 0 ? box[2] : box[3]
}
