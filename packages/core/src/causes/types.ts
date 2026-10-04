import type { DiffMask, Region } from '../pixels/index.js'
import type { Point } from '../snapshot/types.js'

/** The node a cause lives on: a pair, or an unmatched subtree on one side. */
export type CauseNode =
  | { readonly before: number; readonly after: number }
  | { readonly added: number }
  | { readonly removed: number }

/** What a cause's node did: changed its own style, passed an inherited change down, changed its content, appeared, disappeared, resized, scrolled, laid its children out again or changed its paint order. */
export type CauseKind =
  | 'own'
  | 'inherited-root'
  | 'content:text'
  | 'content:wrap'
  | 'content:font-metrics'
  | 'added'
  | 'removed'
  | 'resized'
  | 'scrolled'
  | 'container'
  | 'paint-order'

/** Nodes a cause moved, resized or repainted; indices are before indices. */
export interface Effect {
  readonly kind: 'shifted' | 'resized' | 'reflowed' | 'painted' | 'inherited'
  readonly nodes: readonly number[]
  readonly vector?: Point
}

/** One node whose own change explains part of the picture. */
export interface Cause {
  readonly id: number
  readonly node: CauseNode
  readonly kind: CauseKind
  readonly effects: readonly Effect[]
  /** One of several candidates of a reflowed unit. */
  readonly multiCause?: true
}

/** Siblings that moved together inside one parent and whose culprit no rule found. */
export interface ShiftGroup {
  readonly parent: number
  readonly vector: Point
  readonly nodes: readonly number[]
  readonly candidates: readonly number[]
}

/** A node touching a region, with the share of the region's differing pixels inside its box. */
export interface Candidate {
  readonly before: number | null
  readonly after: number | null
  /** Differing pixels inside the box over the box area, per mille. */
  readonly share: number
}

/** One region of differing pixels: the causes that touch it and the elements under it. */
export interface RegionExplanation {
  readonly region: Region
  readonly causes: readonly number[]
  readonly candidates: readonly Candidate[]
  /** Before index of an element whose resize corner holds the region, set when the corner rule left the region without a cause. */
  readonly corner?: number
}

/** The pixels `explainChanges` explains: the regions and the mask they come from. */
export interface CauseInput {
  readonly regions: readonly Region[]
  readonly mask: DiffMask
}

/** Causes, their effects, and what the pixels say about every region. */
export interface Explanation {
  readonly causes: readonly Cause[]
  readonly regions: readonly RegionExplanation[]
  readonly unexplained: readonly ShiftGroup[]
  readonly suppressed: {
    readonly movedWithAncestor: number
    readonly inherited: number
    readonly derivedOnly: number
  }
}
