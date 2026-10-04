import type { Point, Rect } from '@whydiff/core'

import { GEOMETRY_UNIT } from '../constants.js'

const CSS_PX = /^(-?\d+(?:\.\d+)?)px$/

export function quantize(value: number): number {
  return Math.round(value * GEOMETRY_UNIT) / GEOMETRY_UNIT
}

/** Protocol bounds (layout units, own document) to CSS px of the top-level document. */
export function toRect(bounds: readonly number[], factor: number, offset: Point): Rect {
  const [x = 0, y = 0, width = 0, height = 0] = bounds
  return [
    quantize(x / factor + offset[0]),
    quantize(y / factor + offset[1]),
    quantize(width / factor),
    quantize(height / factor),
  ]
}

/** A computed length in px as a number; 0 for anything else. */
export function px(value: string | null): number {
  const match = value === null ? null : CSS_PX.exec(value)
  return match === null ? 0 : Number(match[1])
}

export function intersects(a: Rect, b: Rect): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]
}
