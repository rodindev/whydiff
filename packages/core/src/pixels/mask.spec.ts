import fc from 'fast-check'
import pixelmatch from 'pixelmatch'

import { WhydiffError } from '../errors.js'
import type { RgbaImage } from './image.js'
import { diffMask } from './mask.js'
import { PIXEL_ANTIALIASED, PIXEL_DIFFERENT, PIXEL_SAME } from './pixelmatch.js'

const solid = (width: number, height: number, rgba: readonly number[]): RgbaImage => {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i++) data[i] = rgba[i % 4] ?? 0
  return { width, height, data }
}

const WHITE = [255, 255, 255, 255]
const BLACK = [0, 0, 0, 255]

describe('diffMask', () => {
  it('reports no differing pixels for identical images', () => {
    const mask = diffMask(solid(3, 2, WHITE), solid(3, 2, WHITE), { threshold: 0.2 })
    expect(mask.differing).toBe(0)
    expect([...mask.classes]).toEqual([0, 0, 0, 0, 0, 0])
    expect(mask.sizeMismatch).toBeNull()
  })

  it('classifies one changed pixel at its index', () => {
    const actual = solid(3, 2, WHITE)
    actual.data.set(BLACK, 4 * 4)
    const mask = diffMask(solid(3, 2, WHITE), actual, { threshold: 0.2 })
    expect(mask.differing).toBe(1)
    expect(mask.classes[4]).toBe(PIXEL_DIFFERENT)
  })

  it('pads the smaller image with transparent black, which compares as white', () => {
    const mask = diffMask(solid(2, 1, BLACK), solid(2, 2, BLACK), { threshold: 0.2 })
    expect(mask).toMatchObject({ width: 2, height: 2, differing: 2 })
    expect(mask.sizeMismatch).toEqual({
      expected: { width: 2, height: 1 },
      actual: { width: 2, height: 2 },
    })
  })

  it('rejects an image whose buffer does not match its size', () => {
    const broken = { width: 2, height: 2, data: new Uint8Array(3) }
    expect(() => diffMask(broken, solid(2, 2, WHITE), { threshold: 0.2 })).toThrow(WhydiffError)
    expect(() => diffMask(broken, solid(2, 2, WHITE), { threshold: 0.2 })).toThrow(
      expect.objectContaining({ code: 'invalid-image' })
    )
  })

  it('rejects a threshold outside 0 to 1', () => {
    const image = solid(1, 1, WHITE)
    for (const threshold of [-0.1, 1.5, Number.NaN]) {
      expect(() => diffMask(image, image, { threshold })).toThrow(
        expect.objectContaining({ code: 'invalid-option' })
      )
    }
  })

  it('matches pixelmatch 5.3.0 pixel for pixel on random images', () => {
    fc.assert(
      fc.property(imagePair(), fc.double({ min: 0, max: 1, noNaN: true }), (pair, threshold) => {
        const mask = diffMask(pair.expected, pair.actual, { threshold })
        const oracle = classifyWithOracle(pair.expected, pair.actual, threshold)
        expect(mask.differing).toBe(oracle.differing)
        expect([...mask.classes]).toEqual([...oracle.classes])
      })
    )
  })
})

interface ImagePair {
  readonly expected: RgbaImage
  readonly actual: RgbaImage
}

function imagePair(): fc.Arbitrary<ImagePair> {
  return fc
    .record({ width: fc.integer({ min: 1, max: 12 }), height: fc.integer({ min: 1, max: 12 }) })
    .chain(({ width, height }) => {
      const bytes = width * height * 4
      const pixels = fc.uint8Array({ minLength: bytes, maxLength: bytes })
      const edits = fc.array(
        fc.tuple(
          fc.nat({ max: width * height - 1 }),
          fc.uint8Array({ minLength: 4, maxLength: 4 })
        ),
        { maxLength: 6 }
      )
      return fc.tuple(pixels, edits).map(([data, changes]) => {
        const actual = data.slice()
        for (const [index, rgba] of changes) actual.set(rgba, index * 4)
        return { expected: { width, height, data }, actual: { width, height, data: actual } }
      })
    })
}

function classifyWithOracle(
  expected: RgbaImage,
  actual: RgbaImage,
  threshold: number
): { classes: number[]; differing: number } {
  const output = new Uint8Array(expected.data.length)
  const differing = pixelmatch(
    expected.data,
    actual.data,
    output,
    expected.width,
    expected.height,
    { threshold }
  )
  const classes: number[] = []
  for (let pos = 0; pos < output.length; pos += 4) {
    const red = output[pos] === 255 && output[pos + 1] === 0 && output[pos + 2] === 0
    const yellow = output[pos] === 255 && output[pos + 1] === 255 && output[pos + 2] === 0
    classes.push(red ? PIXEL_DIFFERENT : yellow ? PIXEL_ANTIALIASED : PIXEL_SAME)
  }
  return { classes, differing }
}
