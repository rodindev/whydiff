import type { Effect } from '../causes/types.js'
import type { ClusterLevel, ClusterSummary, Clusters, ScreenCauses } from '../cluster/types.js'
import type { OBSERVATION_FACTS } from '../constants.js'
import type { Matching } from '../match/types.js'
import type { Region, SizeMismatch } from '../pixels/index.js'
import type { Point, Rect } from '../snapshot/types.js'

/** Version of the report format this build writes and reads natively. */
export const REPORT_FORMAT_VERSION = 1

/** What was compared; inputs only, no timestamps. */
export interface ComparedV1 {
  /** Label of the before side: `expected` under Playwright. */
  readonly before: string
  /** Label of the after side: `actual` under Playwright. */
  readonly after: string
  /** Browser of every pair's after side, when they all agree. */
  readonly browser?: string
  /** Viewport of every pair's after side as `<width>x<height>`, when they all agree. */
  readonly viewport?: string
}

/** `changed` when a pair has a region of differing pixels, else `identical`. */
export type ScreenshotStatus = 'changed' | 'identical'

/** One compared pair of screenshots and what the report holds about it. */
export interface ScreenshotV1 {
  /** `s` plus a hash of the screen key; the same in every report that keys the screenshot alike. */
  readonly id: string
  /** The describe blocks, the test title and the screenshot name, joined by ` > `; the two names for two snaps or files. */
  readonly title: string
  /** The test's spec file, relative to Playwright's `rootDir`; absent for a pair outside a test. */
  readonly file?: string
  /** Line of the test in its file; absent for a pair outside a test. */
  readonly line?: number
  /** Playwright project of the test; absent for a pair outside a test. */
  readonly project?: string
  readonly status: ScreenshotStatus
  /** Width of the before side's PNG in pixels. */
  readonly width: number
  /** Height of the before side's PNG in pixels. */
  readonly height: number
  /** Regions of differing pixels. */
  readonly regions: number
  /** Differing pixels as Playwright counts them, anti-aliasing left out. */
  readonly pixels: number
  readonly massChange: boolean
  readonly sizeMismatch?: {
    /** Width and height of the before side's PNG. */
    readonly before: Point
    /** Width and height of the after side's PNG. */
    readonly after: Point
  }
  readonly causes: readonly string[]
  readonly unexplained: readonly string[]
}

/** How sure the matcher was about the elements behind a cause. */
export type MatchWord = 'exact' | 'likely' | 'ambiguous'

/** What a change did to other nodes, totalled per kind. */
export interface EffectV1 {
  /** `shifted` (moved), `resized`, `reflowed` (laid out again), `painted` (repainted) or `inherited`. */
  readonly kind: Effect['kind']
  /** How many nodes it reached. */
  readonly nodes: number
  /** The most common move of `shifted` nodes. */
  readonly vector?: Point
  /** How many of `nodes` moved by `vector`; absent when all of them did. */
  readonly vectorNodes?: number
}

/** The member of a cause to look at first. */
export interface ExampleV1 {
  /** Id of its screenshot. */
  readonly screenshot: string
  /** Playwright code that finds its element, as its member's `locator`. */
  readonly locator: string
  /** The source hint the page carried for its element. */
  readonly src?: string
}

/** What an observation can say about its element. */
export type FactKind = (typeof OBSERVATION_FACTS)[number]

/** One thing a person would see change on the element: rounded CSS px, a font size or weight, a colour, a text or a computed value. */
export interface FactV1 {
  /** What changed. */
  readonly kind: FactKind
  /** The value before; absent for `appears`, `gone`, `visible` and `invisible`. */
  readonly from?: number | string
  /** The value after; absent for `appears`, `gone`, `visible` and `invisible`. */
  readonly to?: number | string
}

/** What changed on a member's element as a person would see it, as facts and as the line the Markdown prints, its identifiers in code spans. */
export interface ObservationV1 {
  /** `name` is the accessible name next to a `role`, else the element's own short text of three characters or more; `class` is the class its component kind is read from, when it has no name. */
  readonly element: {
    /** Its role, or the role HTML gives its tag, when whydiff names elements by that role. */
    readonly role?: string
    /** The accessible name next to a `role`, else its own short text. */
    readonly name?: string
    /** The class that names its component, build hash removed, when it has no name. */
    readonly class?: string
    /** Its tag. */
    readonly tag: string
  }
  readonly facts: readonly FactV1[]
  readonly text: string
}

/** One cause of the report: a cluster with its scope, confidence and an example to open. */
export interface CauseV1 {
  /** The cluster id: `c` plus a hash of the key, stable across renders and rankings. */
  readonly id: string
  /** One sentence about the whole run that stands alone: what at least half of the members show and how many, its screenshots and its share of the changed pixels; identifiers in code spans. */
  readonly headline: string
  /** The cause's block as `report.md` prints it, Markdown, heading first. */
  readonly text: string
  readonly key: string
  readonly kind: string
  readonly level: ClusterLevel
  readonly summary: ClusterSummary
  readonly scope: 'global' | 'local'
  readonly file?: string
  readonly match: MatchWord
  readonly ambiguous: number
  readonly screenshots: number
  readonly elements: number
  /** Differing pixels of the regions the members touch, each member's shared among the causes it belongs to; the list is ordered by it. */
  readonly pixels: number
  readonly effects: readonly EffectV1[]
  readonly example: ExampleV1
  readonly members: readonly MemberV1[]
}

/** One changed longhand of a member's own node, with the computed values as captured. */
export interface MemberChangeV1 {
  /** The longhand. */
  readonly prop: string
  /** Its computed value before. */
  readonly from: string
  /** Its computed value after. */
  readonly to: string
}

/** One element of a cause in one screenshot and the nodes it moved with it; an element under several rules is a member of each rule's cause. */
export interface MemberV1 {
  /** Id of its screenshot. */
  readonly screenshot: string
  readonly locator: string
  /** The element plus the nodes of its effects. */
  readonly elements: number
  /** What its change did to other nodes, totalled per kind. */
  readonly effects: readonly EffectV1[]
  /** The node's own non-derived style changes; set for style, container, paint-order and rule causes. */
  readonly changes?: readonly MemberChangeV1[]
  /** What changed on the element as a person would see it; absent when nothing on it passed a threshold. */
  readonly observation?: ObservationV1
  /** The element's box in whole pixels of each side's PNG, on the sides it exists on. */
  readonly box?: {
    /** On the before side's PNG; absent when the element is not on that side. */
    readonly before?: Rect
    /** On the after side's PNG; absent when the element is not on that side. */
    readonly after?: Rect
  }
}

/** A region of differing pixels with no DOM, style or geometry change found under it. */
export interface UnexplainedV1 {
  /** `u` plus a hash of the screen key and the region. */
  readonly id: string
  /** Id of its screenshot. */
  readonly screenshot: string
  /** PNG pixels. */
  readonly region: Rect
  /** Differing pixels in the region. */
  readonly pixels: number
  readonly candidates: readonly {
    /** Playwright code that finds the element. */
    readonly locator: string
    /** The region's differing pixels inside the element's box, per mille. */
    readonly share: number
  }[]
  readonly note?: string
}

/** The run summary: the causes it lists and what they hold, and its text. */
export interface LeadV1 {
  /** Ids of the causes it lists: the first in report order, up to the last of the first five that adds a changed screenshot they appear on or one they settle. */
  readonly causes: readonly string[]
  /** Changed screenshots the listed causes appear on. */
  readonly screenshots: number
  /** Changed screenshots on which the listed causes account for every changed pixel: no other cause and no unexplained region there, so fixing or accepting them leaves these unchanged. */
  readonly settled: number
  /** Changed pixels of the listed causes. */
  readonly pixels: number
  /** The run summary as `report.md` prints it: the leading sentence, the listed causes' headlines, what the rest holds. */
  readonly text: string
}

/** Report format v1: the second public contract. */
export interface ReportV1 {
  /** Version of the report format. */
  readonly formatVersion: typeof REPORT_FORMAT_VERSION
  /** The tool that wrote the report. */
  readonly tool: {
    /** Always `whydiff`. */
    readonly name: 'whydiff'
    /** Version of whydiff that wrote the report. */
    readonly version: string
    /** Versions of the rules the report was written with. */
    readonly rules: { readonly cluster: string }
  }
  readonly compared: ComparedV1
  /** The run in numbers, and the run summary it leads with. */
  readonly summary: {
    /** The screenshots the report lists, changed or identical: every assertion of the run under the reporter, only the failed ones read when rebuilt from test-results. */
    readonly screenshots: {
      /** Screenshots listed, as many as `screenshots` holds: the run's total under the reporter, only the screenshots read when rebuilt from test-results. */
      readonly compared: number
      /** Those with a region of differing pixels. */
      readonly changed: number
      /** Those without one, the passed screenshots of a run among them. */
      readonly identical: number
    }
    /** Causes of the run. */
    readonly causes: number
    /** Unexplained regions of the run. */
    readonly unexplained: number
    /** Changed screenshots with too many regions or too large a share of differing pixels to explain one by one. */
    readonly massChange: number
    /** The run summary the report leads with. */
    readonly lead: LeadV1
  }
  readonly screenshots: readonly ScreenshotV1[]
  readonly causes: readonly CauseV1[]
  readonly unexplained: readonly UnexplainedV1[]
}

/** A cause before its headline and text are written. */
export type CauseDraft = Omit<CauseV1, 'headline' | 'text'>

/** A report whose causes have no headline or text yet and without a run summary: what a build or a merge holds before `describeRun`. */
export type ReportDraft = Omit<ReportV1, 'causes' | 'summary'> & {
  readonly causes: readonly CauseDraft[]
  readonly summary: Omit<ReportV1['summary'], 'lead'>
}

/** One compared pair as the report builder sees it; `regions` is empty for an identical pair. */
export interface ScreenInput extends ScreenCauses {
  readonly title: string
  readonly file?: string
  readonly line?: number
  readonly project?: string
  readonly matching: Matching
  readonly regions: readonly Region[]
  readonly differing: number
  readonly massChange: boolean
  readonly sizeMismatch: SizeMismatch | null
}

/** What `buildReport` takes: the writer's version, the sides' labels, every pair and the run's clusters. */
export interface ReportInput {
  readonly version: string
  readonly compared: ComparedV1
  readonly screens: readonly ScreenInput[]
  readonly clusters: Clusters
}

/** How `renderReport`, `renderScreenshot` and `renderRunPage` write a report out. */
export interface RenderOptions {
  readonly maxClusters?: number
  readonly explainCommand?: string
  /** Failed screenshots the report holds no pair for, which its writer lists after it, under No baseline snapshot or Not explained; when no screenshot changed, the page opens with them. */
  readonly failed?: number
  /** True when the run's total of screenshots is not known, as in a report rebuilt from test-results, which keep nothing of a passed one: the header then says how many changed, not of how many. */
  readonly totalUnknown?: boolean
}
