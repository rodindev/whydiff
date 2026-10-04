import fc from 'fast-check'

import type { DiffMask } from './mask.js'
import { PIXEL_DIFFERENT } from './pixelmatch.js'
import { diffRegions } from './regions.js'

function maskOf(
  width: number,
  height: number,
  differing: readonly (readonly [number, number])[]
): DiffMask {
  const classes = new Uint8Array(width * height)
  for (const [x, y] of differing) classes[y * width + x] = PIXEL_DIFFERENT
  return { width, height, classes, differing: differing.length, sizeMismatch: null }
}

describe('diffRegions', () => {
  it('returns no regions for a clean mask', () => {
    expect(diffRegions(maskOf(10, 10, []))).toEqual({ regions: [], massChange: false })
  })

  it('wraps a single pixel in a 1x1 region', () => {
    expect(diffRegions(maskOf(10, 10, [[3, 4]])).regions).toEqual([
      { x: 3, y: 4, width: 1, height: 1, pixels: 1 },
    ])
  })

  it('joins pixels in diagonally adjacent cells', () => {
    const { regions } = diffRegions(
      maskOf(32, 32, [
        [7, 7],
        [8, 8],
      ])
    )
    expect(regions).toEqual([{ x: 7, y: 7, width: 2, height: 2, pixels: 2 }])
  })

  it('keeps pixels in non-adjacent cells apart and sorts by top then left', () => {
    const { regions } = diffRegions(
      maskOf(64, 64, [
        [40, 2],
        [1, 30],
        [1, 1],
      ])
    )
    expect(regions.map((r) => [r.x, r.y])).toEqual([
      [1, 1],
      [40, 2],
      [1, 30],
    ])
  })

  it('flags a mass change above the region count limit', () => {
    const points: [number, number][] = []
    for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) points.push([x * 16, y * 16])
    const { regions, massChange } = diffRegions(maskOf(240, 240, points))
    expect(regions).toHaveLength(225)
    expect(massChange).toBe(true)
  })

  it('flags a mass change above the pixel ratio limit', () => {
    const points: [number, number][] = []
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) points.push([x, y])
    const { regions, massChange } = diffRegions(maskOf(4, 4, points))
    expect(regions).toHaveLength(1)
    expect(massChange).toBe(true)
  })

  it('covers every differing pixel exactly once', () => {
    fc.assert(
      fc.property(randomMask(), (mask) => {
        const { regions } = diffRegions(mask)
        const covered = regions.reduce((sum, region) => sum + region.pixels, 0)
        expect(covered).toBe(mask.differing)
        for (let y = 0; y < mask.height; y++) {
          for (let x = 0; x < mask.width; x++) {
            if (mask.classes[y * mask.width + x] !== PIXEL_DIFFERENT) continue
            const inside = regions.some(
              (r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height
            )
            expect(inside).toBe(true)
          }
        }
        expect(diffRegions(mask)).toEqual(diffRegions(mask))
      })
    )
  })
})

function randomMask(): fc.Arbitrary<DiffMask> {
  return fc
    .record({ width: fc.integer({ min: 1, max: 40 }), height: fc.integer({ min: 1, max: 40 }) })
    .chain(({ width, height }) =>
      fc
        .uniqueArray(fc.tuple(fc.nat({ max: width - 1 }), fc.nat({ max: height - 1 })), {
          maxLength: 60,
          comparator: (a, b) => a[0] === b[0] && a[1] === b[1],
        })
        .map((points) => maskOf(width, height, points))
    )
}
