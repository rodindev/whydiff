import { FONT_SCALE_TOL, FONT_SCALED_PROPS, LINE_HEIGHT_RATIO_TOL } from '../constants.js'
import { pxLengths } from './normalize.js'
import { sameTransform, TRANSFORM_PROPS } from './transforms.js'
import type { DerivedReason, StyleChange } from './types.js'

/** Computed value of a property on one node, null when the snapshot does not carry it. */
export type StyleLookup = (prop: string) => string | null

const SIDES = ['top', 'right', 'bottom', 'left'] as const
const UNPAINTED_BORDER: ReadonlySet<string> = new Set(['none', 'hidden'])
const OUTLINE_PARTS: ReadonlySet<string> = new Set([
  'outline-width',
  'outline-color',
  'outline-offset',
])
const SAME_TRACKS = /\S+/g

/** Marks the changes that only restate another change, in rule order; nothing is removed. `sameRule` says whether one rule set a property on both sides. */
export function markDerived(
  changes: readonly StyleChange[],
  before: StyleLookup,
  after: StyleLookup,
  sameRule: (prop: string) => boolean
): StyleChange[] {
  const changed = new Set(changes.map((change) => change.prop))
  const restated = TRANSFORM_PROPS.some((prop) => changed.has(prop)) && sameTransform(before, after)
  return changes.map((change) => {
    const reason =
      restated && TRANSFORM_PROPS.includes(change.prop)
        ? 'transform'
        : derivedReason(change.prop, changed, before, after, sameRule)
    return reason === null ? change : { ...change, derived: reason }
  })
}

/** Whether a change still moves or repaints other nodes: it is not derived, or it is a length that followed its node's font-size. */
export function actsOnOthers(change: StyleChange): boolean {
  return change.derived === undefined || change.derived === 'font-size'
}

function derivedReason(
  prop: string,
  changed: ReadonlySet<string>,
  before: StyleLookup,
  after: StyleLookup,
  sameRule: (prop: string) => boolean
): DerivedReason | null {
  const both = (test: (side: StyleLookup) => boolean): boolean => test(before) && test(after)
  const side = SIDES.find(
    (name) => prop === `border-${name}-color` || prop === `border-${name}-width`
  )
  const isColor = prop.endsWith('-color')
  if ((side !== undefined && isColor) || prop === 'outline-color') {
    if (changed.has('color') && both((s) => s(prop) === s('color'))) return 'currentcolor'
  }
  if (side !== undefined) {
    const style = `border-${side}-style`
    if (both((s) => UNPAINTED_BORDER.has(s(style) ?? ''))) return 'unpainted'
    if (isColor && both((s) => s(`border-${side}-width`) === '0px')) return 'unpainted'
    if (
      !isColor &&
      changed.has(style) &&
      (UNPAINTED_BORDER.has(before(style) ?? '') || UNPAINTED_BORDER.has(after(style) ?? ''))
    ) {
      return 'border-style'
    }
  }
  if (OUTLINE_PARTS.has(prop) && both((s) => s('outline-style') === 'none')) return 'unpainted'
  if (prop === 'outline-color' && both((s) => s('outline-width') === '0px')) return 'unpainted'
  if (prop === 'outline-width' && changed.has('outline-style')) return 'border-style'
  if (prop === 'grid-template-columns' || prop === 'grid-template-rows') {
    const tracks = (s: StyleLookup): number => (s(prop) ?? '').match(SAME_TRACKS)?.length ?? 0
    if (!changed.has('display') && tracks(before) === tracks(after)) return 'geometry'
  }
  if (prop === 'line-height' && changed.has('font-size')) {
    const ratio = (s: StyleLookup): number =>
      Number.parseFloat(s('line-height') ?? '') / Number.parseFloat(s('font-size') ?? '')
    const a = ratio(before)
    const b = ratio(after)
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= LINE_HEIGHT_RATIO_TOL)
      return 'font-size'
  }
  if (FONT_SCALED_PROPS.includes(prop) && changed.has('font-size') && sameRule(prop)) {
    const ratio =
      Number.parseFloat(after('font-size') ?? '') / Number.parseFloat(before('font-size') ?? '')
    if (scaled(before(prop), after(prop), ratio)) return 'font-size'
  }
  return null
}

function scaled(from: string | null, to: string | null, ratio: number): boolean {
  if (from === null || to === null || !Number.isFinite(ratio)) return false
  const a = pxLengths(from)
  const b = pxLengths(to)
  return (
    a.rest === b.rest &&
    a.lengths.length === b.lengths.length &&
    a.lengths.every(
      (length, i) =>
        Math.abs((b.lengths[i] ?? Number.NaN) - length * ratio) <=
        FONT_SCALE_TOL * Math.abs(length * ratio)
    )
  )
}
