import { INHERITED_PROPS, LINE_HEIGHT_RATIO_TOL } from '../constants.js'
import type { StyleLookup } from './derived.js'
import { sameValue } from './equal.js'

const EM_SCALED: ReadonlySet<string> = new Set(['line-height', 'letter-spacing'])

export function isInherited(prop: string): boolean {
  return INHERITED_PROPS.includes(prop)
}

/** Whether the parent changed `prop` the same way: equal values, or for em-scaled lengths equal ratios to font-size. */
export function sameInheritedChange(
  prop: string,
  node: { readonly before: StyleLookup; readonly after: StyleLookup },
  parent: { readonly before: StyleLookup; readonly after: StyleLookup }
): boolean {
  return sameSide(prop, node.before, parent.before) && sameSide(prop, node.after, parent.after)
}

function sameSide(prop: string, node: StyleLookup, parent: StyleLookup): boolean {
  const a = node(prop)
  const b = parent(prop)
  if (a === null || b === null) return false
  if (sameValue(prop, a, b)) return true
  if (!EM_SCALED.has(prop)) return false
  const ratioA = Number.parseFloat(a) / Number.parseFloat(node('font-size') ?? '')
  const ratioB = Number.parseFloat(b) / Number.parseFloat(parent('font-size') ?? '')
  return (
    Number.isFinite(ratioA) &&
    Number.isFinite(ratioB) &&
    Math.abs(ratioA - ratioB) <= LINE_HEIGHT_RATIO_TOL
  )
}
