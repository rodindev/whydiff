import { sameColor } from './color.js'
import { normalizeValue } from './normalize.js'

const COLOR_PROPS: ReadonlySet<string> = new Set([
  'color',
  'background-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
])
const LENGTH = /^-?\d+(\.\d+)?px$/

/** Whether two computed values of `prop` paint the same; equal strings always do. */
export function sameValue(prop: string, a: string, b: string): boolean {
  if (a === b) return true
  if (COLOR_PROPS.has(prop)) return sameColor(a, b)
  if (prop === 'box-shadow' && emptyShadow(a) && emptyShadow(b)) return true
  return normalizeValue(prop, a) === normalizeValue(prop, b)
}

/** `none`, or shadow layers whose every length is zero: nothing is painted either way. */
function emptyShadow(value: string): boolean {
  if (value === 'none') return true
  const tokens = value.split(/[\s,]+/).filter((token) => LENGTH.test(token))
  return tokens.length > 0 && tokens.every((token) => Number.parseFloat(token) === 0)
}
