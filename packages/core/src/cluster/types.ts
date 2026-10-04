import type { Deltas } from '../deltas/types.js'
import type { Explanation } from '../causes/types.js'
import type { SnapshotV1 } from '../snapshot/types.js'

/** One screenshot pair of a run with everything the pipeline derived from it. */
export interface ScreenCauses {
  /** Stable key of the pair: project, test id and ordinal. */
  readonly screen: string
  readonly before: SnapshotV1
  readonly after: SnapshotV1
  readonly deltas: Deltas
  readonly explanation: Explanation
}

/** A rule as the report names it; `sheet` is the basename of the href, `<style> #n`, `constructed #n`, `style attribute` or `style attribute of an ancestor` with an empty selector, or `user agent stylesheet` for the browser's own rule. */
export interface RuleRef {
  /** The whole selector list; empty for a style attribute. */
  readonly selector: string
  /** The stylesheet, named as the `sheet` of a rule cause is; `user agent stylesheet` for the browser's own rule. */
  readonly sheet: string
  /** The cascade layer, dotted; absent when unlayered. */
  readonly layer?: string
  /** Set for the rule's `!important` declarations. */
  readonly important?: true
  /** Set for a rule of the browser's own stylesheet; `selector` is then what it matched by. */
  readonly userAgent?: true
}

/** A longhand's computed value before and after, as captured. */
export interface LonghandValues {
  /** The longhand. */
  readonly prop: string
  /** Its computed value before. */
  readonly from: string
  /** Its computed value after. */
  readonly to: string
}

/** A longhand that is in more than one of a rule's `sets`, `changed` and `unsets`, with how many members put it in each. */
export interface MixedLonghand {
  /** The longhand. */
  readonly prop: string
  /** Members on which the rule now sets it. */
  readonly sets: number
  /** Members on which it set it before too, with another value. */
  readonly changed: number
  /** Members on which it no longer sets it. */
  readonly unsets: number
}

/** A custom property whose change reached the members' longhands through `var()`. */
export interface VarChange {
  /** The custom property. */
  readonly name: string
  /** Declared or registered value before, kept only when every member saw the same. */
  readonly from?: string
  /** Declared or registered value after, kept only when every member saw the same. */
  readonly to?: string
  /** Longhands that changed through it, sorted. */
  readonly readBy: readonly string[]
  /** What the declarations reading it did on the side where it had no value: used their `var()` fallback, or had none and were invalid; absent when it had a value on both sides or the members differ. */
  readonly missing?: 'fallback' | 'invalid'
}

/** A custom property that a longhand the rule sets reads from another author rule. */
export interface ViaRule {
  /** The custom property. */
  readonly name: string
  /** The author rule its value comes from. */
  readonly rule: RuleRef
  /** Longhands of the rule that read it, sorted. */
  readonly readBy: readonly string[]
}

/** Level 0 is the rule that wins, the three levels of the declaration shape follow. */
export type ClusterLevel = 0 | 1 | 2 | 3

/** What a cluster's key says, structured for the report. */
export type ClusterSummary =
  | {
      /** `style`: the node's own change; `container`: it re-laid its children out; `paint-order`: its stacking changed. */
      readonly kind: 'style' | 'container' | 'paint-order'
      /** What the members share per longhand: both values at level 1, how it changed at level 2, its name alone at level 3. */
      readonly changes: readonly {
        /** The longhand. */
        readonly prop: string
        /** Its computed value before, at level 1. */
        readonly from?: string
        /** Its computed value after, at level 1. */
        readonly to?: string
        /** How it changed at level 2, without the values: `<len +4px>`, `<num -1>`, `<color>` or `<kw from>to>`. */
        readonly delta?: string
      }[]
    }
  | {
      /** `content`: the element's text, or how it is drawn, changed. */
      readonly kind: 'content'
      /** `text`: the text itself; `wrap`: where its lines break; `font-metrics`: the platform font that draws it. */
      readonly detail: 'text' | 'wrap' | 'font-metrics'
      /** The platform font before, for `font-metrics`, when the capture recorded it. */
      readonly from?: string
      /** The platform font after, for `font-metrics`, when the capture recorded it. */
      readonly to?: string
    }
  | {
      /** `added` or `removed`: the element is on one side only; `scrolled`: its content scrolled; `resized`: its size changed and no change of its own says why. */
      readonly kind: 'added' | 'removed' | 'scrolled' | 'resized'
    }
  | (RuleRef & {
      /** `rule`: a stylesheet rule behind the members' changed longhands. */
      readonly kind: 'rule'
      /** Longhands, and custom properties a changed longhand reads, the rule now sets on members where another rule or none won before, sorted. */
      readonly sets: readonly string[]
      /** Longhands and custom properties the rule set before too, with another value, sorted. */
      readonly changed: readonly string[]
      /** Longhands the rule set before and no author rule sets now, and custom properties no rule declares now, sorted. */
      readonly unsets: readonly string[]
      /** Layer the rule moved out of; absent when it was unlayered or did not move. */
      readonly layerFrom?: string
      /** Layer the rule moved into; absent when it is unlayered now or did not move. */
      readonly layerTo?: string
      /** The rule every member's `sets` lost to, the browser's own included; absent when they lost to different rules or to none. */
      readonly over?: RuleRef
      /** The browser's declarations that `sets` longhands replaced, when `over` is the browser's rule and every member had the same value, sorted by longhand. */
      readonly defaults?: readonly {
        /** The longhand. */
        readonly prop: string
        /** The browser's value, as declared. */
        readonly value: string
      }[]
      /** Computed values before and after of the longhands of `sets`, `changed` and `unsets` on which every member agrees, sorted by longhand; a longhand left out had other values on some members. */
      readonly values?: readonly LonghandValues[]
      /** Longhands the rule sets on some members, changed on others or no longer sets on others, with how many members each, sorted by longhand. */
      readonly mixed?: readonly MixedLonghand[]
      /** Custom properties of `sets`, `changed` and `unsets`, with the longhands that changed through them, sorted by name. */
      readonly vars?: readonly VarChange[]
      /** Custom properties the after-side declarations of the rule's own changed longhands read from another author rule, sorted by name. */
      readonly via?: readonly ViaRule[]
    })

/** The summary of a level-0 cluster. */
export type RuleSummary = Extract<ClusterSummary, { kind: 'rule' }>
export type StyleFamily = Extract<ClusterSummary, { changes: unknown }>['kind']
export type ContentDetail = Extract<ClusterSummary, { kind: 'content' }>['detail']

/** One cause of one screen in a cluster. */
export interface ClusterMember {
  readonly screen: string
  readonly cause: number
  /** The cause node plus its effect nodes. */
  readonly nodes: number
  /** Differing pixels of the regions this cause touches, shared equally with the other causes of each region in whole pixels that add up per screen, then among the clusters the cause belongs to. */
  readonly pixels: number
}

/** Causes of the run grouped by what they share, at the level of its key. */
export interface Cluster {
  /** `c` plus the first six base36 digits of the key's FNV-1a 64 hash; stable across runs. */
  readonly id: string
  /** `c01`, `c02`, ... in list order; presentation only. */
  readonly alias: string
  readonly level: ClusterLevel
  readonly key: string
  readonly kind: string
  readonly summary: ClusterSummary
  readonly members: readonly ClusterMember[]
  readonly screens: number
  /** Sum of the members' pixels; the list is ordered by it, with unexplained `resized` clusters last. */
  readonly pixels: number
}

/** Causes of a run grouped by what changed on what kind of component. */
export interface Clusters {
  readonly rulesVersion: string
  readonly clusters: readonly Cluster[]
}
