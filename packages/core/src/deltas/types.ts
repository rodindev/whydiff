import type { Unmatched } from '../match/types.js'
import type { Point, Rect } from '../snapshot/types.js'

/** Why a changed value restates another change instead of being one. */
export type DerivedReason =
  'currentcolor' | 'unpainted' | 'border-style' | 'geometry' | 'font-size' | 'transform'

/** One changed computed property; derived ones stay listed with their reason. */
export interface StyleChange {
  readonly prop: string
  readonly from: string
  readonly to: string
  readonly derived?: DerivedReason
  /** Index into each side's `rules` of the declaration that set the value, null for none; absent when a side has no attributions. */
  readonly rule?: { readonly from: number | null; readonly to: number | null }
  /** Index into each side's `declarations` of the winning declaration when it reads custom properties or is the browser's, null for none; absent when a side has no declarations. */
  readonly declaration?: { readonly from: number | null; readonly to: number | null }
}

/** How a pair's box moved, in CSS px of the top-level document. */
export interface GeometryDelta {
  /** after.xy minus before.xy. */
  readonly abs: Point
  /** `abs` minus the matched parent's displacement; equals `abs` without a matched parent. */
  readonly rel: Point
  /** after.wh minus before.wh. */
  readonly size: Point
}

/** What kind of change a pair carries; the first applicable kind in the classifier's order wins. */
export type DeltaKind =
  | 'unchanged'
  | 'own'
  | 'inherited'
  | 'content:text'
  | 'content:wrap'
  | 'content:font-metrics'
  | 'resized-by-child'
  | 'resized-by-parent'
  | 'resized-by-sibling'
  | 'resized'
  | 'moved-with-ancestor'
  | 'shifted'
  | 'painted-by-ancestor'
  | 'scrolled'

/** Everything that changed on one matched pair. */
export interface PairDelta {
  readonly before: number
  readonly after: number
  readonly kind: DeltaKind
  readonly style: readonly StyleChange[]
  /** Before index of the top-most ancestor carrying the same inherited change. */
  readonly inheritedFrom?: number
  readonly geometry: GeometryDelta
  readonly text?: { readonly from: string; readonly to: string }
  readonly lines?: { readonly from: number; readonly to: number }
  /** Platform fonts of the two sides when they differ. */
  readonly font?: { readonly from: string; readonly to: string }
  readonly scroll?: { readonly from: Point; readonly to: Point }
  /** Either box intersects a diff region. */
  readonly inRegion: boolean
}

/** The changed regions, which tell `computeDeltas` whether a pair touches one. */
export interface DeltaOptions {
  /** Diff regions in PNG pixels of the compared images. */
  readonly regions: readonly Rect[]
}

/** The deltas of a matching: one record per pair plus the unmatched subtrees. */
export interface Deltas {
  readonly pairs: readonly PairDelta[]
  readonly added: readonly Unmatched[]
  readonly removed: readonly Unmatched[]
}
