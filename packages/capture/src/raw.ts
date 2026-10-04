/** Sparse string column of a DOM snapshot: node indices and string-table indices. */
export interface RareString {
  readonly index: readonly number[]
  readonly value: readonly number[]
}

/** Sparse boolean column of a DOM snapshot: the node indices where the flag is set. */
interface RareBoolean {
  readonly index: readonly number[]
}

/** The node columns of `DOMSnapshot.captureSnapshot` that the assembler reads; indices point into `strings`. */
export interface NodeTree {
  readonly parentIndex: readonly number[]
  readonly nodeType: readonly number[]
  readonly nodeName: readonly number[]
  readonly nodeValue: readonly number[]
  readonly backendNodeId: readonly number[]
  readonly attributes: readonly (readonly number[])[]
  readonly textValue?: RareString
  readonly inputValue?: RareString
  readonly inputChecked?: RareBoolean
  readonly pseudoType?: RareString
  readonly shadowRootType?: RareString
  readonly currentSourceURL?: RareString
}

/** The layout columns: one row per laid-out node, geometry in layout units. */
export interface LayoutTree {
  readonly nodeIndex: readonly number[]
  readonly styles: readonly (readonly number[])[]
  readonly bounds: readonly (readonly number[])[]
  readonly text: readonly number[]
  readonly stackingContexts: RareBoolean
  readonly paintOrders?: readonly number[]
  readonly scrollRects?: readonly (readonly number[])[]
  readonly clientRects?: readonly (readonly number[])[]
}

/** One box per rendered line of a text node. */
export interface TextBoxes {
  readonly layoutIndex: readonly number[]
  readonly bounds: readonly (readonly number[])[]
}

/** One document of a DOM snapshot. */
export interface DocumentSnapshot {
  readonly documentURL: number
  readonly frameId: number
  readonly nodes: NodeTree
  readonly layout: LayoutTree
  readonly textBoxes: TextBoxes
  readonly scrollOffsetX: number
  readonly scrollOffsetY: number
  readonly contentWidth: number
  readonly contentHeight: number
}

/** One node of `Accessibility.getFullAXTree`. */
export interface AxNode {
  readonly ignored: boolean
  readonly role?: { readonly value?: unknown }
  readonly name?: { readonly value?: unknown }
  readonly backendDOMNodeId?: number
}

/** One author stylesheet as the protocol reported it, with its text already hashed. */
export interface RawSheet {
  readonly styleSheetId: string
  readonly frameId: string
  readonly href: string | null
  readonly inline: boolean
  /** Empty when the browser could not read the text back. */
  readonly hash: string
  readonly text: string
  readonly harness: boolean
  /** Backend node id of the owning style or link element; null for constructed sheets. */
  readonly ownerBackendNodeId: number | null
  /** Order in which the browser announced the sheet. */
  readonly order: number
}

/** One declaration of a matched style as `CSS.getMatchedStylesForNode` reports it, trimmed to what the assembler reads. */
export interface RawDeclaration {
  readonly name: string
  readonly value: string
  readonly important?: boolean
  readonly parsedOk?: boolean
  readonly disabled?: boolean
  /** Set for a declaration as the source wrote it; the browser's own longhands of the style follow without it. */
  readonly source?: true
  /** The longhands a shorthand expands to; absent when the browser could not expand it, as for a `var()` or a CSS-wide keyword. */
  readonly longhandProperties?: readonly { readonly name: string }[]
}

export interface RawStyle {
  readonly cssProperties: readonly RawDeclaration[]
}

/** One cascade layer around a matched rule: an `@layer` block or a layered `@import`. */
export interface RawLayer {
  /** The name as written; empty for an anonymous layer. */
  readonly text: string
  /** The sheet that declares the layer; for a layered `@import`, the importing sheet. */
  readonly styleSheetId?: string
  /** Where the layer's rule header starts in that sheet's text; absent when the browser has no source. */
  readonly range?: { readonly startLine: number; readonly startColumn: number }
}

/** One matched rule; the browser lists them in cascade order, lowest first. */
export interface RawRule {
  readonly styleSheetId?: string
  readonly origin: string
  /** For a rule of the browser's own sheet, only its selectors that matched. */
  readonly selectorList: { readonly text: string }
  /** Cascade layers from the outermost inwards, as Chromium sends them; the protocol documentation says the reverse. */
  readonly layers?: readonly RawLayer[]
  readonly style: RawStyle
}

/** The style attribute and matched rules of one ancestor, trimmed to their custom property declarations. */
export interface RawInheritedStyle {
  readonly inlineStyle?: RawStyle
  readonly matchedCSSRules: readonly { readonly rule: RawRule }[]
}

/** The `@property` rule that registered a custom property. */
export interface RawPropertyRule {
  readonly styleSheetId?: string
  readonly propertyName: { readonly text: string }
  /** Its `inherits` and `initial-value` descriptors. */
  readonly style: RawStyle
}

/** A custom property registered by `CSS.registerProperty`. */
export interface RawPropertyRegistration {
  readonly propertyName: string
  readonly initialValue?: { readonly text: string }
  readonly inherits: boolean
}

/** What `CSS.getMatchedStylesForNode` answered for the representative of a group, trimmed to what the assembler reads. */
export interface MatchedStyles {
  readonly inlineStyle?: RawStyle
  /** Presentational attributes such as `align` or `bgcolor`: author declarations below every rule. */
  readonly attributesStyle?: RawStyle
  readonly matchedCSSRules?: readonly { readonly rule: RawRule }[]
  /** From the parent up to the root of the flat tree. */
  readonly inherited?: readonly RawInheritedStyle[]
  /** The `@property` rules of the registered names the element has a value for; a name a script registered is in `cssPropertyRegistrations` instead. */
  readonly cssPropertyRules?: readonly RawPropertyRule[]
  readonly cssPropertyRegistrations?: readonly RawPropertyRegistration[]
}

/** Nodes that share one matched-styles answer: the same style row, tag, classes, id and pseudo type. */
export interface RuleGroup {
  readonly nodes: readonly number[]
  readonly matched: MatchedStyles
}

/** One captured document with everything the protocol gave about it. */
export interface RawDocument {
  readonly frameId: string
  readonly parentFrameId: string | null
  /** Backend node id of the owning iframe in the parent document; null for the main frame. */
  readonly ownerBackendNodeId: number | null
  readonly url: string
  readonly strings: readonly string[]
  readonly document: DocumentSnapshot
  readonly axNodes: readonly AxNode[]
  /** Backend node ids of the elements the browser renders in the top layer, such as a modal dialog. */
  readonly topLayer: readonly number[]
  /** Platform font per sampled backend node id. */
  readonly fonts: ReadonlyMap<number, string>
  /** Attribution groups in node order; null when the capture exceeded the group budget. */
  readonly ruleGroups: readonly RuleGroup[] | null
}

/** A frame Playwright knows about whose document could not be captured. */
export interface SkippedFrame {
  readonly url: string
  readonly parentFrameId: string | null
  readonly ownerBackendNodeId: number | null
}

/** Viewport and content metrics of the page session, in the protocol's own units. */
export interface LayoutMetrics {
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly scrollX: number
  readonly scrollY: number
  readonly cssContentWidth: number
  readonly cssContentHeight: number
  readonly layoutFactor: number
}

/** Everything the protocol stage collected; the assembler turns it into a snapshot without touching the browser. */
export interface RawCapture {
  readonly url: string
  readonly title: string
  readonly browser: string
  readonly devicePixelRatio: number
  readonly props: readonly string[]
  /** Computed longhands requested after `props` that only the assembler's rules read. */
  readonly ruleProps: readonly string[]
  readonly metrics: LayoutMetrics
  readonly documents: readonly RawDocument[]
  readonly skippedFrames: readonly SkippedFrame[]
  readonly sheets: readonly RawSheet[]
  /** The longhands, or the canonical name of an alias, per property name the matched styles carry without longhands; a name the probe could not answer is missing. */
  readonly shorthands: ReadonlyMap<string, readonly string[]>
}
