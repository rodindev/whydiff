import { WhydiffError } from '../errors.js'
import { assertImage, padToSize, type RgbaImage, type Size } from './image.js'
import { classifyPixels } from './pixelmatch.js'

/** Sizes of the two inputs when they did not match; both were padded with transparent black. */
export interface SizeMismatch {
  readonly expected: Size
  readonly actual: Size
}

/** Per-pixel classification of two screenshots, in the padded size. */
export interface DiffMask extends Size {
  /** One PixelClass per pixel, row-major. */
  readonly classes: Uint8Array
  /** Number of pixels classified as different; anti-aliased pixels are not counted. */
  readonly differing: number
  readonly sizeMismatch: SizeMismatch | null
}

/** Options of diffMask. threshold is Playwright's toHaveScreenshot threshold, 0 to 1. */
export interface DiffMaskOptions {
  readonly threshold: number
}

/** Classifies every pixel of actual against expected exactly as Playwright's toHaveScreenshot does. */
export function diffMask(
  expected: RgbaImage,
  actual: RgbaImage,
  options: DiffMaskOptions
): DiffMask {
  assertImage(expected, 'expected')
  assertImage(actual, 'actual')
  assertThreshold(options.threshold)

  const size = {
    width: Math.max(expected.width, actual.width),
    height: Math.max(expected.height, actual.height),
  }
  const sizeMismatch =
    expected.width === actual.width && expected.height === actual.height
      ? null
      : { expected: sizeOf(expected), actual: sizeOf(actual) }
  const padded = { expected: padToSize(expected, size), actual: padToSize(actual, size) }
  const { classes, differing } = classifyPixels(
    padded.expected.data,
    padded.actual.data,
    size.width,
    size.height,
    options.threshold
  )
  return { ...size, classes, differing, sizeMismatch }
}

function assertThreshold(threshold: number): void {
  if (!(threshold >= 0 && threshold <= 1)) {
    throw new WhydiffError(
      'invalid-option',
      `threshold is ${String(threshold)}, expected a number from 0 to 1. Use the value of expect.toHaveScreenshot.threshold.`
    )
  }
}

function sizeOf({ width, height }: Size): Size {
  return { width, height }
}
