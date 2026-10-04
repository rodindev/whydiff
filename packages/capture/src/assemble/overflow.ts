import type { Rect } from '@whydiff/core'

import { styleValue, type IndexedDocument } from './document.js'
import { px } from './units.js'

/** A clip in CSS px of the top-level document as left, top, right, bottom; an axis that does not clip is infinite. */
export type Edges = readonly [left: number, top: number, right: number, bottom: number]

const SIDES = ['left', 'top', 'right', 'bottom'] as const
const CLIP_BOXES: ReadonlySet<string> = new Set(['border-box', 'padding-box', 'content-box'])

/** Where a box clips its overflow: the padding box on each axis whose overflow is not visible, null when neither is. */
export function overflowClip(indexed: IndexedDocument, row: number, box: Rect): Edges | null {
  const x = styleValue(indexed, row, 'overflow-x') ?? 'visible'
  const y = styleValue(indexed, row, 'overflow-y') ?? 'visible'
  if (x === 'visible' && y === 'visible') return null
  const border = SIDES.map((side) => px(styleValue(indexed, row, `border-${side}-width`)))
  // Chromium applies overflow-clip-margin only when both axes are clip
  const inset = x === 'clip' && y === 'clip' ? marginInset(indexed, row, border) : border
  const [left = 0, top = 0, right = 0, bottom = 0] = inset
  return [
    x === 'visible' ? -Infinity : box[0] + left,
    y === 'visible' ? -Infinity : box[1] + top,
    x === 'visible' ? Infinity : box[0] + box[2] - right,
    y === 'visible' ? Infinity : box[1] + box[3] - bottom,
  ]
}

/** Whether any part of a box lies inside the clip. */
export function meets(box: Rect, clip: Edges): boolean {
  return (
    box[0] < clip[2] && clip[0] < box[0] + box[2] && box[1] < clip[3] && clip[1] < box[1] + box[3]
  )
}

/** The part of the outer clip that the inner one leaves; either may be absent. */
export function narrow(outer: Edges | null, inner: Edges | null): Edges | null {
  if (outer === null) return inner
  if (inner === null) return outer
  return [
    Math.max(outer[0], inner[0]),
    Math.max(outer[1], inner[1]),
    Math.min(outer[2], inner[2]),
    Math.min(outer[3], inner[3]),
  ]
}

function marginInset(indexed: IndexedDocument, row: number, border: readonly number[]): number[] {
  let box = 'padding-box'
  let length = 0
  for (const part of (styleValue(indexed, row, 'overflow-clip-margin') ?? '').split(' ')) {
    if (CLIP_BOXES.has(part)) box = part
    else length = px(part)
  }
  return SIDES.map((side, i) => {
    const edge = border[i] ?? 0
    const padding = px(styleValue(indexed, row, `padding-${side}`))
    const reference = box === 'border-box' ? 0 : box === 'content-box' ? edge + padding : edge
    return reference - length
  })
}
