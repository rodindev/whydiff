import { WhydiffError } from '../errors.js'

/** Width and height in pixels. */
export interface Size {
  readonly width: number
  readonly height: number
}

/** Decoded image: four bytes per pixel (RGBA), rows top to bottom, no padding. */
export interface RgbaImage extends Size {
  readonly data: Uint8Array
}

const BYTES_PER_PIXEL = 4

export function assertImage(image: RgbaImage, label: string): void {
  const expected = image.width * image.height * BYTES_PER_PIXEL
  if (image.data.length !== expected) {
    throw new WhydiffError(
      'invalid-image',
      `${label} image holds ${String(image.data.length)} bytes for ${String(image.width)}x${String(image.height)} pixels, expected ${String(expected)}. Decode it as RGBA with four bytes per pixel.`
    )
  }
}

export function padToSize(image: RgbaImage, size: Size): RgbaImage {
  if (image.width === size.width && image.height === size.height) return image
  const data = new Uint8Array(size.width * size.height * BYTES_PER_PIXEL)
  const rowBytes = image.width * BYTES_PER_PIXEL
  for (let y = 0; y < image.height; y++) {
    data.set(
      image.data.subarray(y * rowBytes, (y + 1) * rowBytes),
      y * size.width * BYTES_PER_PIXEL
    )
  }
  return { width: size.width, height: size.height, data }
}
