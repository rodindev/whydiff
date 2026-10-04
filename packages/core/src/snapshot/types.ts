/** Version of the snapshot format this build writes and reads natively. */
export const SNAPSHOT_FORMAT_VERSION = 1

/** Box in CSS px of the top-level document: x, y, width, height. */
export type Rect = readonly [x: number, y: number, width: number, height: number]

/** Two numbers: an x/y offset or a scroll position in CSS px. */
export type Point = readonly [x: number, y: number]

/** How the snapshot was read: `cdp`, through the Chrome DevTools Protocol. */
export type CaptureSource = 'cdp'

/** Playwright's `scale` option: `css` keeps one PNG pixel per CSS px, `device` multiplies by the device scale factor. */
export type ScreenshotScale = 'css' | 'device'

/** How a frame was captured; `approximate` means its offset ignores a CSS transform on the iframe. */
export type FrameStatus = 'captured' | 'skipped' | 'approximate'

/** Per-node markers that the protocol does not express as styles. */
export type NodeFlag =
  | 'pseudo:before'
  | 'pseudo:after'
  | 'pseudo:marker'
  | 'shadow:open'
  | 'shadow:closed'
  | 'clipped'
  | 'hidden'

/** Tool that produced the snapshot and the browser it ran in. */
export interface ToolV1 {
  /** Always `whydiff`. */
  readonly name: 'whydiff'
  /** Version of `@whydiff/capture` that wrote the snapshot. */
  readonly version: string
  readonly source: CaptureSource
  /** Browser name and version the page ran in. */
  readonly browser: string
  /** Milliseconds from Playwright's screenshot to this capture, on the actual side of a failed assertion; absent on baselines, two-run snapshots and snaps. */
  readonly capturedAfterMs?: number
}

/** Page identity at capture time. */
export interface PageV1 {
  /** URL of the page. */
  readonly url: string
  /** Title of the page's document. */
  readonly title: string
}

/** How snapshot coordinates map onto the PNG taken next to it. */
export interface ImageV1 {
  /** Width of the PNG in its pixels. */
  readonly width: number
  /** Height of the PNG in its pixels. */
  readonly height: number
  /** PNG pixels per CSS px. */
  readonly k: number
  /** Divisor that turned protocol layout units into CSS px; diagnostics only. */
  readonly layoutFactor: number
  /** Document point that the PNG's top-left pixel shows. */
  readonly origin: Point
  /** Whether the screenshot shows the whole scrollable page. */
  readonly fullPage: boolean
  /** Index of the node a locator screenshot was taken of; absent for a page screenshot. */
  readonly root?: number
}

/** Visual viewport at capture time, in CSS px. */
export interface ViewportV1 {
  /** Width of the viewport. */
  readonly width: number
  /** Height of the viewport. */
  readonly height: number
  /** Horizontal scroll offset of the page. */
  readonly scrollX: number
  /** Vertical scroll offset of the page. */
  readonly scrollY: number
}

/** Size of the whole document, in CSS px. */
export interface ContentV1 {
  /** Width of the document. */
  readonly width: number
  /** Height of the document. */
  readonly height: number
}

/** The screenshot comparison settings in force, so the differ never reads a Playwright config. */
export interface CompareV1 {
  /** Playwright's `threshold`: the perceived colour difference, from 0 (strict) to 1 (lax), up to which two pixels match. */
  readonly threshold: number
  /** Playwright's `maxDiffPixels`: the differing pixels the assertion tolerates; absent when not set. */
  readonly maxDiffPixels?: number
  /** Playwright's `maxDiffPixelRatio`: the share of differing pixels the assertion tolerates; absent when not set. */
  readonly maxDiffPixelRatio?: number
  /** Playwright's `animations` option: `disabled` or `allow`. */
  readonly animations: string
  /** Playwright's `caret` option: `hide` or `initial`. */
  readonly caret: string
  readonly scale: ScreenshotScale
}

/** One document in the page; index 0 is the main frame. */
export interface FrameV1 {
  /** URL of the document. */
  readonly url: string
  /** Index of the iframe node in the parent frame; null for the main frame. */
  readonly owner: number | null
  /** Offset added to child coordinates to reach the top-level document. */
  readonly offset: Point
  /** Scroll position of the document. */
  readonly scroll: Point
  readonly status: FrameStatus
}

/** One author stylesheet of the page, identified by its text hash. */
export interface SheetV1 {
  /** URL of a linked sheet; absent for inline and constructed sheets. */
  readonly href?: string
  /** Set for a `<style>` element's sheet; absent for linked and constructed sheets. */
  readonly inline?: true
  /** Empty when the browser could not read the text back: a sheet that failed to load, or a linked sheet served by `page.route` or `routeFromHAR`. */
  readonly hash: string
  /** Set when the owner node carries `data-whydiff-harness`: the sheet belongs to the test, not the app. */
  readonly harness?: true
}

/** One source of declarations: a rule of an author sheet, the element's style attribute, an `@property` rule or a rule of the browser's own sheet. */
export interface RuleV1 {
  /** Index into `sheets`; absent for the style attribute and the browser's rules. */
  readonly sheet?: number
  /** Set for the element's style attribute. */
  readonly inline?: true
  /** Set for a rule of the browser's own sheet; only `declarations` point at one, never `attributions`. */
  readonly userAgent?: true
  /** Selector text as the browser reports it; empty for the style attribute; `@property --name` for a registration; for a browser rule, only its selectors that matched. */
  readonly selector: string
  /** Cascade layer path, outermost first, joined with dots; an anonymous segment reads `<anonymous #n>`, n counting the `@layer {` blocks and bare `@import ... layer` rules of the sheet that declares it in source order, or `<anonymous>` when the browser did not say where it is. Absent when unlayered. */
  readonly layer?: string
  /** Set for the entry of the rule's `!important` declarations. */
  readonly important?: true
}

/** A winning declaration of a recorded longhand that reads custom properties or comes from the browser's own sheet, or a custom property such a declaration reads. */
export interface DeclarationV1 {
  /** A name of `props`, or a custom property name. */
  readonly prop: string
  /** Index into `rules` of the rule that declared it, or of the `@property` rule that registered it when it took the registration's initial value; absent when no rule did. */
  readonly rule?: number
  /** Declared value without `!important`, or the registered initial value; absent when nothing gave one. */
  readonly value?: string
  /** Set when `value` is the registered initial value. */
  readonly initial?: true
  /** Set for a custom property declared on an ancestor. */
  readonly inherited?: true
  /** Indices into `declarations` of the custom properties the value reads, in order of first appearance, each below this entry's index; a name already on the path from the longhand, or past the depth capture follows, is left out. */
  readonly reads?: readonly number[]
}

/** One visible node of the render tree. Field names are short because files hold thousands of them. */
export interface NodeV1 {
  /** Index in `nodes`; dense, in document order. */
  readonly i: number
  /** Index of the nearest emitted ancestor, -1 for a root. */
  readonly p: number
  /** Index in `frames`; absent for the main frame. */
  readonly f?: number
  /** Tag name in lower case; a pseudo-element's is its element's. */
  readonly tag: string
  /** Role from the browser's accessibility tree. */
  readonly role?: string
  /** Accessible name from the browser's accessibility tree. */
  readonly name?: string
  /** The `id` attribute. */
  readonly id?: string
  /** The test id attribute: `data-testid` unless the capture named another. */
  readonly testId?: string
  /** The `class` attribute, split at white space. */
  readonly cls?: readonly string[]
  /** The element's own text: its rendered text children joined, white space collapsed, at most 80 characters. */
  readonly text?: string
  /** Current value of an input or textarea. */
  readonly value?: string
  /** Whether a checkbox or radio input is checked. */
  readonly checked?: boolean
  /** The element's layout box. */
  readonly box: Rect
  /** One box per rendered line of text, when the text wraps. */
  readonly lineBoxes?: readonly Rect[]
  /** Scroll offset and scrollable size of an inner scroller. */
  readonly scroll?: Rect
  /** Hash of the image URL actually chosen for an img. */
  readonly img?: string
  /** Index in `styles`. */
  readonly s: number
  /** Index in `attributions`. */
  readonly a?: number
  /** Paint layer index shared by all nodes of a layer. */
  readonly layer?: number
  /** Set when the element starts a stacking context. */
  readonly stacking?: true
  /** Platform font actually used for the text. */
  readonly font?: string
  /** Source hint such as `src/components/PayButton.ts:12`. */
  readonly src?: string
  readonly flags?: readonly NodeFlag[]
}

/** Snapshot format v1: header, style table and the visible nodes of one screenshot. */
export interface SnapshotV1 {
  /** Version of the snapshot format. */
  readonly formatVersion: typeof SNAPSHOT_FORMAT_VERSION
  readonly tool: ToolV1
  readonly page: PageV1
  readonly image: ImageV1
  readonly viewport: ViewportV1
  readonly content: ContentV1
  readonly compare: CompareV1
  /** The documents of the page; index 0 is the main frame. */
  readonly frames: readonly FrameV1[]
  /** Boxes of the elements Playwright's `mask` option covered. */
  readonly masks: readonly Rect[]
  /** The author stylesheets of the page, each identified by its text hash. */
  readonly sheets: readonly SheetV1[]
  /** Property names; values in `styles` follow this order. */
  readonly props: readonly string[]
  /** Unique value tuples; nodes point into this table. */
  readonly styles: readonly (readonly string[])[]
  /** Winning declaration sources in first-use order; absent when the capture did not record them. */
  readonly rules?: readonly RuleV1[]
  /** Per row one entry per `props` entry: the index into `rules` that set it, or -1 for no author declaration. */
  readonly attributions?: readonly (readonly number[])[]
  /** Declarations the `uses` rows point at and the custom properties they read, deduplicated in first-use order; present exactly when `uses` is. */
  readonly declarations?: readonly DeclarationV1[]
  /** Per `attributions` row, the indices into `declarations` of the winning declarations of its longhands that read custom properties or, where no author declaration won, come from the browser's own sheet; in `props` order. */
  readonly uses?: readonly (readonly number[])[]
  /** The visible nodes of the render tree, in document order. */
  readonly nodes: readonly NodeV1[]
}
