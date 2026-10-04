import { GEOM_REPORT_TOL } from '../constants.js'
import { dominantAxis, isZero } from './geometry.js'
import type { DeltaKind, GeometryDelta } from './types.js'

/** What the classifier needs to know about one pair; computed by the deltas pass. */
export interface Facts {
  /** Either side has area and is not flagged hidden; a node that paints nothing explains nothing. */
  readonly visible: boolean
  /** A non-derived style change that the parent does not explain. */
  readonly own: boolean
  /** Every non-derived style change repeats the matched parent's. */
  readonly inherited: boolean
  readonly textChanged: boolean
  readonly linesChanged: boolean
  readonly hasText: boolean
  /** The platform font differs between the sides, or the capture did not record fonts. */
  readonly fontChanged: boolean
  readonly geometry: GeometryDelta
  readonly scrolled: boolean
  readonly inRegion: boolean
  readonly ancestorPaints: boolean
  readonly childrenExplain: (axis: 0 | 1, delta: number) => boolean
  readonly parentExplains: (axis: 0 | 1, delta: number) => boolean
  readonly siblingsExplain: (axis: 0 | 1, delta: number) => boolean
}

/** One kind per pair, first rule that applies. */
export function classify(facts: Facts): DeltaKind {
  if (!facts.visible) return 'unchanged'
  if (facts.own) return 'own'
  if (facts.inherited) return 'inherited'
  if (facts.textChanged) return 'content:text'
  if (facts.linesChanged) return 'content:wrap'
  const { size } = facts.geometry
  if (!isZero(size)) {
    const axis = dominantAxis(size)
    const delta = size[axis]
    if (facts.childrenExplain(axis, delta)) return 'resized-by-child'
    if (facts.hasText && facts.fontChanged && Math.abs(delta) > GEOM_REPORT_TOL) {
      return 'content:font-metrics'
    }
    if (facts.parentExplains(axis, delta)) return 'resized-by-parent'
    if (facts.siblingsExplain(axis, delta)) return 'resized-by-sibling'
    return 'resized'
  }
  if (!isZero(facts.geometry.rel)) return 'shifted'
  if (!isZero(facts.geometry.abs)) return 'moved-with-ancestor'
  if (facts.scrolled) return 'scrolled'
  if (facts.inRegion && facts.ancestorPaints) return 'painted-by-ancestor'
  return 'unchanged'
}
