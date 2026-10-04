import { parseSnapshot, serializeSnapshot, type SnapshotV1 } from '@whydiff/core'

import { assembleSnapshot } from '../assemble/snapshot.js'
import { resolveOptions, type CaptureOptions } from '../options.js'
import { RULE_PROPS } from '../props.js'
import type { DocumentSnapshot, RawCapture, RawDocument, RawSheet } from '../raw.js'

/** Recorded props of the hand-built documents; style rows carry RULE_PROPS after them. */
export const PROPS: readonly string[] = [
  'display',
  'position',
  'visibility',
  'opacity',
  'overflow-x',
  'overflow-y',
  'transform',
  'translate',
  'rotate',
  'scale',
  'filter',
  'backdrop-filter',
  'contain',
  'border-left-width',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'padding-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'font-family',
  'font-weight',
  'font-style',
]
const DEFAULTS: Readonly<Record<string, string>> = {
  display: 'block',
  position: 'static',
  visibility: 'visible',
  opacity: '1',
  'overflow-x': 'visible',
  'overflow-y': 'visible',
  transform: 'none',
  contain: 'none',
  'border-left-width': '0px',
  'border-top-width': '0px',
  'border-right-width': '0px',
  'border-bottom-width': '0px',
  'padding-left': '0px',
  'padding-top': '0px',
  'padding-right': '0px',
  'padding-bottom': '0px',
  'font-family': 'serif',
  'font-weight': '400',
  'font-style': 'normal',
  'overflow-clip-margin': '0px',
  filter: 'none',
  'backdrop-filter': 'none',
  perspective: 'none',
  translate: 'none',
  rotate: 'none',
  scale: 'none',
  'offset-path': 'none',
  'transform-style': 'flat',
  'will-change': 'auto',
  'content-visibility': 'visible',
  'container-type': 'normal',
  'writing-mode': 'horizontal-tb',
}

/** One node of a hand-built document; a node without `box` has no layout row. */
export interface Spec {
  readonly tag: string
  readonly parent: number
  readonly box?: readonly [number, number, number, number]
  readonly style?: Readonly<Record<string, string>>
  readonly attrs?: Readonly<Record<string, string>>
  readonly text?: string
  readonly lines?: readonly (readonly [number, number, number, number])[]
  readonly pseudo?: string
  readonly scroll?: readonly [number, number, number, number]
  readonly client?: readonly [number, number, number, number]
}

/** Protocol columns of one hand-built document and their string table. */
export interface Built {
  readonly strings: string[]
  readonly document: DocumentSnapshot
}

/** Builds protocol columns from a flat node list: index 0 is the #document node, ids are 100 + index. */
export function build(specs: readonly Spec[], frameId: string, url: string): Built {
  const strings: string[] = []
  const intern = (text: string): number => {
    const at = strings.indexOf(text)
    if (at >= 0) return at
    strings.push(text)
    return strings.length - 1
  }
  const all: Spec[] = [{ tag: '#document', parent: -1 }, ...specs]
  const nodeIndex: number[] = []
  const styles: number[][] = []
  const bounds: number[][] = []
  const text: number[] = []
  const scrollRects: number[][] = []
  const clientRects: number[][] = []
  const textLayout: number[] = []
  const textBounds: number[][] = []
  const pseudoType: { index: number[]; value: number[] } = { index: [], value: [] }
  all.forEach((spec, index) => {
    if (spec.box === undefined) return
    const row = nodeIndex.length
    nodeIndex.push(index)
    styles.push(
      [...PROPS, ...RULE_PROPS].map((prop) => intern(spec.style?.[prop] ?? DEFAULTS[prop] ?? ''))
    )
    bounds.push([...spec.box])
    text.push(spec.text === undefined ? -1 : intern(spec.text))
    scrollRects.push([...(spec.scroll ?? [0, 0, spec.box[2], spec.box[3]])])
    clientRects.push([...(spec.client ?? [0, 0, spec.box[2], spec.box[3]])])
    for (const line of spec.lines ?? []) {
      textLayout.push(row)
      textBounds.push([...line])
    }
    if (spec.pseudo !== undefined) {
      pseudoType.index.push(index)
      pseudoType.value.push(intern(spec.pseudo))
    }
  })
  return {
    strings,
    document: {
      documentURL: intern(url),
      frameId: intern(frameId),
      nodes: {
        parentIndex: all.map((spec) => spec.parent),
        nodeType: all.map((spec) => (spec.tag === '#document' ? 9 : spec.tag === '#text' ? 3 : 1)),
        nodeName: all.map((spec) =>
          intern(spec.tag.startsWith('#') ? spec.tag : spec.tag.toUpperCase())
        ),
        nodeValue: all.map((spec) => (spec.tag === '#text' ? intern(spec.text ?? '') : -1)),
        backendNodeId: all.map((_, index) => 100 + index),
        attributes: all.map((spec) =>
          Object.entries(spec.attrs ?? {}).flatMap(([name, value]) => [intern(name), intern(value)])
        ),
        pseudoType,
      },
      layout: {
        nodeIndex,
        styles,
        bounds,
        text,
        stackingContexts: { index: [] },
        paintOrders: nodeIndex.map(() => 1),
        scrollRects,
        clientRects,
      },
      textBoxes: { layoutIndex: textLayout, bounds: textBounds },
      scrollOffsetX: 0,
      scrollOffsetY: 0,
      contentWidth: 1000,
      contentHeight: 1000,
    },
  }
}

/** A captured document around hand-built columns. */
export function rawDocument(
  built: Built,
  frameId: string,
  url: string,
  extra: Partial<RawDocument> = {}
): RawDocument {
  return {
    frameId,
    parentFrameId: null,
    ownerBackendNodeId: null,
    url,
    strings: built.strings,
    document: built.document,
    axNodes: [],
    topLayer: [],
    fonts: new Map(),
    ruleGroups: null,
    ...extra,
  }
}

/** An inline sheet of the main document with the given protocol id and text. */
export function rawSheet(styleSheetId: string, text: string): RawSheet {
  return {
    styleSheetId,
    frameId: 'MAIN',
    href: null,
    inline: true,
    hash: '',
    text,
    harness: false,
    ownerBackendNodeId: null,
    order: 0,
  }
}

/** A whole capture around hand-built documents: a 1000x800 viewport at layout factor 1. */
export function capture(
  documents: readonly RawDocument[],
  extra: Partial<RawCapture> = {}
): RawCapture {
  return {
    url: 'http://app.test/',
    title: 'App',
    browser: 'chromium 147.0.0',
    devicePixelRatio: 1,
    props: PROPS,
    ruleProps: RULE_PROPS,
    metrics: {
      viewportWidth: 1000,
      viewportHeight: 800,
      scrollX: 0,
      scrollY: 0,
      cssContentWidth: 1000,
      cssContentHeight: 1000,
      layoutFactor: 1,
    },
    documents,
    skippedFrames: [],
    sheets: [],
    shorthands: new Map(),
    ...extra,
  }
}

/** Assembles and runs the result through the public parser, so every snapshot is also validated. */
export function assemble(raw: RawCapture, options: CaptureOptions = {}): SnapshotV1 {
  const snapshot = assembleSnapshot(raw, resolveOptions(options))
  return parseSnapshot(serializeSnapshot(snapshot))
}

/** Columns of the main document at http://app.test/. */
export function main(specs: readonly Spec[]): Built {
  return build(specs, 'MAIN', 'http://app.test/')
}

/** Flags of every node with an id, after assembling the main document; `topLayer` holds backend node ids. */
export function flagsById(
  specs: readonly Spec[],
  topLayer: readonly number[] = []
): Readonly<Record<string, readonly string[]>> {
  const raw = capture([rawDocument(main(specs), 'MAIN', 'http://app.test/', { topLayer })])
  const { nodes } = assemble(raw)
  return Object.fromEntries(
    nodes.flatMap((n) => (n.id === undefined ? [] : [[n.id, n.flags ?? []]]))
  )
}
