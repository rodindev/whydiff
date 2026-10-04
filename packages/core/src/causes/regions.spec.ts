import fc from 'fast-check'

import { PIXEL_ANTIALIASED, PIXEL_DIFFERENT, PIXEL_SAME, type DiffMask } from '../pixels/index.js'
import type { ImageV1, Rect } from '../snapshot/types.js'
import { diffShare, diffSums } from './regions.js'

const masks = fc
  .tuple(fc.integer({ min: 1, max: 24 }), fc.integer({ min: 1, max: 24 }))
  .chain(([width, height]) =>
    fc
      .array(fc.constantFrom(PIXEL_SAME, PIXEL_DIFFERENT, PIXEL_ANTIALIASED), {
        minLength: width * height,
        maxLength: width * height,
      })
      .map((classes): DiffMask => ({
        width,
        height,
        classes: Uint8Array.from(classes),
        differing: classes.filter((c) => c === PIXEL_DIFFERENT).length,
        sizeMismatch: null,
      }))
  )
const coordinate = fc.double({ min: -40, max: 40, noNaN: true })
const boxes = fc.tuple(coordinate, coordinate, coordinate, coordinate)
const images = fc
  .tuple(fc.constantFrom(-1, 0, 0.5, 1, 1.5, 2), coordinate, coordinate)
  .map(([k, x, y]): ImageV1 => ({
    width: 24,
    height: 24,
    k,
    layoutFactor: 1,
    origin: [x, y],
    fullPage: false,
  }))

/** The share counted pixel by pixel. */
function scannedShare(mask: DiffMask, box: Rect, image: ImageV1): number {
  const x0 = Math.max(0, Math.floor((box[0] - image.origin[0]) * image.k))
  const y0 = Math.max(0, Math.floor((box[1] - image.origin[1]) * image.k))
  const x1 = Math.min(mask.width, Math.ceil((box[0] + box[2] - image.origin[0]) * image.k))
  const y1 = Math.min(mask.height, Math.ceil((box[1] + box[3] - image.origin[1]) * image.k))
  const area = (x1 - x0) * (y1 - y0)
  if (area <= 0) return 0
  let count = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) if (mask.classes[y * mask.width + x] === PIXEL_DIFFERENT) count++
  }
  return Math.floor((1000 * count) / area)
}

describe('diffShare', () => {
  it('gives the share a pixel-by-pixel scan of the box gives', () => {
    fc.assert(
      fc.property(masks, boxes, images, (mask, box, image) => {
        expect(diffShare(diffSums(mask), box, image)).toBe(scannedShare(mask, box, image))
      }),
      { numRuns: 1000 }
    )
  })
})
