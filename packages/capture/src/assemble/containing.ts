import type { Rect } from '@whydiff/core'

import { styleValue, type IndexedDocument } from './document.js'
import { narrow, overflowClip, type Edges } from './overflow.js'

/** The clip in force below an element for each way a descendant can be positioned; null where nothing clips. */
export interface Clips {
  readonly flow: Edges | null
  readonly absolute: Edges | null
  readonly fixed: Edges | null
}

const TRANSFORM_PROPS: readonly string[] = [
  'transform',
  'translate',
  'rotate',
  'scale',
  'perspective',
  'offset-path',
]
const FILTER_PROPS: readonly string[] = ['filter', 'backdrop-filter']
const CONTAINING_HINTS: ReadonlySet<string> = new Set([
  ...TRANSFORM_PROPS,
  'offset-position',
  'transform-style',
  'contain',
])
const LAYOUT_CONTAINMENT = /\b(?:layout|paint|strict|content)\b/
const SIZE_CONTAINER = /\bsize\b/

/** The clip a box must meet to be painted: the one in force at its containing block. */
export function clipOf(clips: Clips | null, position: string): Edges | null {
  if (clips === null) return null
  if (position === 'fixed') return clips.fixed
  if (position === 'absolute') return clips.absolute
  return clips.flow
}

/** The clips a box hands down: its own clip and overflow reach the descendants whose containing block it is. */
export function clipsBelow(
  indexed: IndexedDocument,
  row: number,
  box: Rect,
  root: boolean,
  own: Edges | null,
  above: Clips | null
): Clips {
  const flow = narrow(own, overflowClip(indexed, row, box))
  const fixed = containsFixed(indexed, row, root)
  const absolute =
    fixed ||
    (styleValue(indexed, row, 'position') ?? 'static') !== 'static' ||
    hints(indexed, row).includes('position')
  return {
    flow,
    absolute: absolute ? flow : (above?.absolute ?? null),
    fixed: fixed ? flow : (above?.fixed ?? null),
  }
}

function containsFixed(indexed: IndexedDocument, row: number, root: boolean): boolean {
  const set = (prop: string, initial: string): boolean =>
    (styleValue(indexed, row, prop) ?? initial) !== initial
  const hinted = hints(indexed, row)
  const filtered = FILTER_PROPS.some((prop) => set(prop, 'none') || hinted.includes(prop))
  if (filtered && !root) return true
  if (styleValue(indexed, row, 'display') === 'inline') return false
  return (
    TRANSFORM_PROPS.some((prop) => set(prop, 'none')) ||
    set('transform-style', 'flat') ||
    hinted.some((prop) => CONTAINING_HINTS.has(prop)) ||
    LAYOUT_CONTAINMENT.test(styleValue(indexed, row, 'contain') ?? '') ||
    set('content-visibility', 'visible') ||
    SIZE_CONTAINER.test(styleValue(indexed, row, 'container-type') ?? '')
  )
}

function hints(indexed: IndexedDocument, row: number): string[] {
  return (styleValue(indexed, row, 'will-change') ?? 'auto').split(', ')
}
