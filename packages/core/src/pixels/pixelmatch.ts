/*!
 * Port of pixelmatch 5.3.0 (https://github.com/mapbox/pixelmatch), ISC License, Copyright (c) 2019, Mapbox.
 * Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee
 * is hereby granted, provided that the above copyright notice and this permission notice appear in all
 * copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
 * SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS.
 *
 * Playwright vendors this exact version for toHaveScreenshot; the math must stay identical so that
 * whydiff's pixel verdict matches Playwright's. Instead of a diff image this port emits one class per pixel.
 */

/** 0 pixels match, 1 they differ, 2 the difference is anti-aliasing and is not counted. */
export type PixelClass = 0 | 1 | 2

/** Class of a pixel that matches within the threshold. */
export const PIXEL_SAME = 0
/** Class of a pixel that differs and is counted. */
export const PIXEL_DIFFERENT = 1
/** Class of a pixel whose difference is anti-aliasing; not counted. */
export const PIXEL_ANTIALIASED = 2

export interface Classification {
  readonly classes: Uint8Array
  readonly differing: number
}

// Maximum possible value of the YIQ difference metric.
const MAX_YIQ_DELTA = 35215

export function classifyPixels(
  expected: Uint8Array,
  actual: Uint8Array,
  width: number,
  height: number,
  threshold: number
): Classification {
  const classes = new Uint8Array(width * height)
  if (identical(expected, actual)) return { classes, differing: 0 }

  const maxDelta = MAX_YIQ_DELTA * threshold * threshold
  let differing = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      const pos = index * 4
      if (Math.abs(colorDelta(expected, actual, pos, pos)) <= maxDelta) continue
      if (
        antialiased(expected, x, y, width, height, actual) ||
        antialiased(actual, x, y, width, height, expected)
      ) {
        classes[index] = PIXEL_ANTIALIASED
      } else {
        classes[index] = PIXEL_DIFFERENT
        differing++
      }
    }
  }
  return { classes, differing }
}

function identical(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// "Anti-aliased Pixel and Intensity Slope Detector", V. Vysniauskas, 2009.
function antialiased(
  img: Uint8Array,
  x1: number,
  y1: number,
  width: number,
  height: number,
  other: Uint8Array
): boolean {
  const x0 = Math.max(x1 - 1, 0)
  const y0 = Math.max(y1 - 1, 0)
  const x2 = Math.min(x1 + 1, width - 1)
  const y2 = Math.min(y1 + 1, height - 1)
  const pos = (y1 * width + x1) * 4
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0
  let min = 0
  let max = 0
  let minX = 0
  let minY = 0
  let maxX = 0
  let maxY = 0

  for (let x = x0; x <= x2; x++) {
    for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) continue
      const delta = brightnessDelta(img, pos, (y * width + x) * 4)
      if (delta === 0) {
        zeroes++
        if (zeroes > 2) return false
      } else if (delta < min) {
        min = delta
        minX = x
        minY = y
      } else if (delta > max) {
        max = delta
        maxX = x
        maxY = y
      }
    }
  }

  if (min === 0 || max === 0) return false

  return (
    (hasManySiblings(img, minX, minY, width, height) &&
      hasManySiblings(other, minX, minY, width, height)) ||
    (hasManySiblings(img, maxX, maxY, width, height) &&
      hasManySiblings(other, maxX, maxY, width, height))
  )
}

function hasManySiblings(
  img: Uint8Array,
  x1: number,
  y1: number,
  width: number,
  height: number
): boolean {
  const x0 = Math.max(x1 - 1, 0)
  const y0 = Math.max(y1 - 1, 0)
  const x2 = Math.min(x1 + 1, width - 1)
  const y2 = Math.min(y1 + 1, height - 1)
  const pos = (y1 * width + x1) * 4
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0

  for (let x = x0; x <= x2; x++) {
    for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) continue
      const pos2 = (y * width + x) * 4
      if (
        img[pos] === img[pos2] &&
        img[pos + 1] === img[pos2 + 1] &&
        img[pos + 2] === img[pos2 + 2] &&
        img[pos + 3] === img[pos2 + 3]
      ) {
        zeroes++
      }
      if (zeroes > 2) return true
    }
  }
  return false
}

interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

// "Measuring perceived color difference using YIQ NTSC transmission color space in mobile
// applications", Y. Kotsarenko and F. Ramos. Negative when the second pixel is brighter.
function colorDelta(img1: Uint8Array, img2: Uint8Array, k: number, m: number): number {
  if (samePixel(img1, img2, k, m)) return 0
  const c1 = blended(img1, k)
  const c2 = blended(img2, m)
  const y1 = rgb2y(c1)
  const y2 = rgb2y(c2)
  const y = y1 - y2
  const i = rgb2i(c1) - rgb2i(c2)
  const q = rgb2q(c1) - rgb2q(c2)
  const delta = 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q
  return y1 > y2 ? -delta : delta
}

function brightnessDelta(img: Uint8Array, k: number, m: number): number {
  if (samePixel(img, img, k, m)) return 0
  return rgb2y(blended(img, k)) - rgb2y(blended(img, m))
}

function samePixel(img1: Uint8Array, img2: Uint8Array, k: number, m: number): boolean {
  return (
    img1[k] === img2[m] &&
    img1[k + 1] === img2[m + 1] &&
    img1[k + 2] === img2[m + 2] &&
    img1[k + 3] === img2[m + 3]
  )
}

function blended(img: Uint8Array, pos: number): Rgb {
  const r = img[pos] ?? 0
  const g = img[pos + 1] ?? 0
  const b = img[pos + 2] ?? 0
  const a = img[pos + 3] ?? 0
  if (a === 255) return { r, g, b }
  const alpha = a / 255
  return { r: blend(r, alpha), g: blend(g, alpha), b: blend(b, alpha) }
}

// Blend a semi-transparent channel with white.
function blend(c: number, a: number): number {
  return 255 + (c - 255) * a
}

function rgb2y({ r, g, b }: Rgb): number {
  return r * 0.29889531 + g * 0.58662247 + b * 0.11448223
}

function rgb2i({ r, g, b }: Rgb): number {
  return r * 0.59597799 - g * 0.2741761 - b * 0.32180189
}

function rgb2q({ r, g, b }: Rgb): number {
  return r * 0.21147017 - g * 0.52261711 + b * 0.31114694
}
