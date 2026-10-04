import { PNG } from 'pngjs'
import type { Rect } from '@whydiff/core'

export interface Pixels {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
}

export function decodePng(buffer: Uint8Array): Pixels {
  const png = PNG.sync.read(Buffer.from(buffer))
  return { width: png.width, height: png.height, data: png.data }
}

/** Bounding box of every pixel within 2 of the given hex colour, or null when none is painted. */
export function colorBox(pixels: Pixels, hex: string): Rect | null {
  const wanted = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  let left = Infinity
  let top = Infinity
  let right = -1
  let bottom = -1
  for (let y = 0; y < pixels.height; y++) {
    for (let x = 0; x < pixels.width; x++) {
      const at = (y * pixels.width + x) * 4
      const close = wanted.every((value, i) => Math.abs((pixels.data[at + i] ?? 0) - value) <= 2)
      if (!close) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  return right < 0 ? null : [left, top, right - left + 1, bottom - top + 1]
}
