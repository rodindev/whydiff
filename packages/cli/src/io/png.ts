import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  PIXEL_ANTIALIASED,
  PIXEL_DIFFERENT,
  type DiffMask,
  type Rect,
  type RgbaImage,
} from '@whydiff/core'
import { PNG } from 'pngjs'

const BYTES_PER_PIXEL = 4
const WHITE = 255
// Unchanged pixels of a diff image keep a tenth of their brightness, as Playwright's diff draws them.
const FADE = 0.1

/** Decodes PNG bytes into the core's RGBA form. */
function decodePng(bytes: Uint8Array): RgbaImage {
  const png = PNG.sync.read(Buffer.from(bytes))
  return { width: png.width, height: png.height, data: png.data }
}

/** Decodes the PNG at `path`. */
export async function readPng(path: string): Promise<RgbaImage> {
  return decodePng(await readFile(path))
}

/** Encodes an RGBA image as PNG bytes. */
function encodePng(image: RgbaImage): Uint8Array {
  const png = new PNG({ width: image.width, height: image.height })
  png.data.set(image.data)
  return PNG.sync.write(png)
}

/** Writes an RGBA image as a PNG, creating the directory. */
export async function writePng(path: string, image: RgbaImage): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, encodePng(image))
}

/** The pixels of `image` inside `rect`, clamped to the image. */
export function cropImage(image: RgbaImage, rect: Rect): RgbaImage {
  const x0 = clamp(Math.floor(rect[0]), 0, image.width)
  const y0 = clamp(Math.floor(rect[1]), 0, image.height)
  const x1 = clamp(Math.ceil(rect[0] + rect[2]), x0, image.width)
  const y1 = clamp(Math.ceil(rect[1] + rect[3]), y0, image.height)
  const width = x1 - x0
  const height = y1 - y0
  const data = new Uint8Array(width * height * BYTES_PER_PIXEL)
  for (let y = 0; y < height; y++) {
    const from = ((y0 + y) * image.width + x0) * BYTES_PER_PIXEL
    data.set(image.data.subarray(from, from + width * BYTES_PER_PIXEL), y * width * BYTES_PER_PIXEL)
  }
  return { width, height, data }
}

/** Differing pixels in red, anti-aliased ones in yellow, the rest faded from the expected image. */
export function paintDiff(expected: RgbaImage, mask: DiffMask): RgbaImage {
  const data = new Uint8Array(mask.width * mask.height * BYTES_PER_PIXEL)
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const at = (y * mask.width + x) * BYTES_PER_PIXEL
      const pixel = mask.classes[y * mask.width + x]
      if (pixel === PIXEL_DIFFERENT) data.set([WHITE, 0, 0, WHITE], at)
      else if (pixel === PIXEL_ANTIALIASED) data.set([WHITE, WHITE, 0, WHITE], at)
      else {
        const faded = fadedGray(expected, x, y)
        data.set([faded, faded, faded, WHITE], at)
      }
    }
  }
  return { width: mask.width, height: mask.height, data }
}

function fadedGray(image: RgbaImage, x: number, y: number): number {
  if (x >= image.width || y >= image.height) return WHITE
  const at = (y * image.width + x) * BYTES_PER_PIXEL
  const [r = 0, g = 0, b = 0, a = 0] = image.data.subarray(at, at + BYTES_PER_PIXEL)
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) * (a / WHITE) + WHITE * (1 - a / WHITE)
  return Math.round(WHITE + (luma - WHITE) * FADE)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
