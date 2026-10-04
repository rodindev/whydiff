import type { NodeFlag, NodeV1, Rect } from '@whydiff/core'

import { FONT_SAMPLE_PROPS, MASK_ATTRIBUTE, ROOT_ATTRIBUTE, TEXT_LIMIT } from '../constants.js'
import { hashText } from '../hash.js'
import { axByBackendNode } from './ax.js'
import { clipOf, clipsBelow, type Clips } from './containing.js'
import { attribute, styleValue, type IndexedDocument } from './document.js'
import type { PlacedDocument } from './frames.js'
import type { LayerNamer } from './layers.js'
import { attributeDocument, type Flow, type RuleTable } from './rules.js'
import type { StyleTable } from './styles.js'
import { meets } from './overflow.js'
import { quantize, toRect } from './units.js'

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const DOCUMENT_NODE = 9
const PSEUDO_FLAGS: ReadonlyMap<string, NodeFlag> = new Map([
  ['before', 'pseudo:before'],
  ['after', 'pseudo:after'],
  ['marker', 'pseudo:marker'],
])
const SHADOW_FLAGS: ReadonlyMap<string, NodeFlag> = new Map([
  ['open', 'shadow:open'],
  ['closed', 'shadow:closed'],
])
const TOGGLE_INPUTS: ReadonlySet<string> = new Set(['checkbox', 'radio'])
const WHITESPACE = /\s+/g

interface NodeMeta {
  readonly transparent: boolean
  readonly clips: Clips
}

export interface Emitter {
  readonly factor: number
  /** Style values per layout row that the snapshot records; the ones after them only feed the rules. */
  readonly recorded: number
  readonly testIdAttribute: string
  readonly props: readonly string[]
  readonly styles: StyleTable
  /** Null when the capture did not record winning rules. */
  readonly rules: RuleTable | null
  /** Snapshot sheet index per protocol style sheet id. */
  readonly sheetIndex: ReadonlyMap<string, number>
  readonly layerName: LayerNamer
  readonly shorthands: ReadonlyMap<string, readonly string[]>
  readonly nodes: NodeV1[]
  readonly meta: NodeMeta[]
  readonly masks: Rect[]
  rootIndex: number | null
}

/** Appends the visible nodes of one document and returns the emitted index per backend node id. */
export function emitDocument(
  placed: PlacedDocument,
  emitter: Emitter
): ReadonlyMap<number, number> {
  const { indexed, raw, offset, frameIndex } = placed
  const { strings, document } = indexed
  const { nodes, layout } = document
  const ax = axByBackendNode(raw.axNodes)
  const topLayer = new Set(raw.topLayer)
  const fontByTuple = fontTuples(indexed, raw.fonts)
  const flowOf = (node: number): Flow => {
    const row = indexed.rowOf[node] ?? -1
    return {
      writingMode: styleValue(indexed, row, 'writing-mode') ?? 'horizontal-tb',
      direction: styleValue(indexed, row, 'direction') ?? 'ltr',
    }
  }
  const rowOf =
    emitter.rules === null || raw.ruleGroups === null
      ? null
      : attributeDocument(raw.ruleGroups, emitter.rules, emitter, flowOf)
  const emittedOf: number[] = nodes.parentIndex.map(() => -1)
  const byBackendId = new Map<number, number>()

  nodes.parentIndex.forEach((parentIndex, nodeIndex) => {
    if (nodes.nodeType[nodeIndex] !== ELEMENT_NODE) return
    const row = indexed.rowOf[nodeIndex] ?? -1
    if (row < 0) return
    const pseudo = indexed.rare.pseudoType.get(nodeIndex) ?? null
    const pseudoFlag = pseudo === null ? null : PSEUDO_FLAGS.get(pseudo)
    if (pseudo !== null && pseudoFlag === undefined) return

    let ancestor = parentIndex
    while (ancestor >= 0 && emittedOf[ancestor] === -1) ancestor = nodes.parentIndex[ancestor] ?? -1
    const p = ancestor >= 0 ? (emittedOf[ancestor] ?? -1) : -1
    // the top layer paints above everything, out of reach of its ancestors' clip and opacity
    const inTopLayer = topLayer.has(nodes.backendNodeId[nodeIndex] ?? -1)
    const above = p < 0 || inTopLayer ? undefined : emitter.meta[p]
    const index = emitter.nodes.length
    const box = toRect(layout.bounds[row] ?? [], emitter.factor, offset)
    const tagNode = pseudo === null ? nodeIndex : parentIndex
    const node: Mutable<NodeV1> = {
      i: index,
      p,
      tag: (strings[nodes.nodeName[tagNode] ?? -1] ?? '').toLowerCase(),
      box,
      s: emitter.styles.index(
        (layout.styles[row] ?? []).slice(0, emitter.recorded).map((s) => strings[s] ?? '')
      ),
    }
    const a = rowOf?.get(nodeIndex)
    if (a !== undefined) node.a = a
    if (frameIndex > 0) node.f = frameIndex

    const axEntry = ax.get(nodes.backendNodeId[nodeIndex] ?? -1)
    if (axEntry?.role != null) node.role = axEntry.role
    if (axEntry?.name != null) node.name = axEntry.name
    const id = attribute(indexed, nodeIndex, 'id')
    if (id !== null) node.id = id
    const testId = attribute(indexed, nodeIndex, emitter.testIdAttribute)
    if (testId !== null) node.testId = testId
    const cls = (attribute(indexed, nodeIndex, 'class') ?? '').split(WHITESPACE).filter(Boolean)
    if (cls.length > 0) node.cls = cls

    const text = textOf(indexed, nodeIndex, emitter.factor, offset)
    if (text.text !== '') {
      node.text = text.text
      const font = fontByTuple.get(fontKey(indexed, row))
      if (font !== undefined) node.font = font
    }
    if (text.lineBoxes !== null) node.lineBoxes = text.lineBoxes

    if (node.tag === 'input' && TOGGLE_INPUTS.has(attribute(indexed, nodeIndex, 'type') ?? '')) {
      node.checked = indexed.checked.has(nodeIndex)
    } else {
      const value = indexed.rare.inputValue.get(nodeIndex) ?? indexed.rare.textValue.get(nodeIndex)
      if (value !== undefined) node.value = value
    }
    const source = indexed.rare.currentSourceURL.get(nodeIndex)
    if (source !== undefined) node.img = hashText(source)
    const layer = layout.paintOrders?.[row]
    if (layer !== undefined) node.layer = layer
    if (indexed.stackingRows.has(row)) node.stacking = true

    const visibility = styleValue(indexed, row, 'visibility')
    const transparent = styleValue(indexed, row, 'opacity') === '0' || (above?.transparent ?? false)
    const clip = clipOf(above?.clips ?? null, styleValue(indexed, row, 'position') ?? 'static')
    const flags: NodeFlag[] = []
    if (pseudoFlag !== undefined && pseudoFlag !== null) flags.push(pseudoFlag)
    const shadow = SHADOW_FLAGS.get(indexed.rare.shadowRootType.get(nodeIndex) ?? '')
    if (shadow !== undefined) flags.push(shadow)
    if (clip !== null && box[2] > 0 && box[3] > 0 && !meets(box, clip)) flags.push('clipped')
    if (transparent || (visibility !== null && visibility !== 'visible')) flags.push('hidden')
    if (flags.length > 0) node.flags = flags

    const clips =
      (styleValue(indexed, row, 'overflow-x') ?? 'visible') !== 'visible' ||
      (styleValue(indexed, row, 'overflow-y') ?? 'visible') !== 'visible'
    const scroll = clips ? scrollOf(indexed, row, emitter.factor) : null
    const root = nodes.nodeType[parentIndex] === DOCUMENT_NODE
    if (scroll !== null && !root) node.scroll = scroll
    emitter.meta.push({
      transparent,
      clips: clipsBelow(indexed, row, box, root, clip, above?.clips ?? null),
    })
    emitter.nodes.push(node)
    emittedOf[nodeIndex] = index
    const backendNodeId = nodes.backendNodeId[nodeIndex]
    if (backendNodeId !== undefined) byBackendId.set(backendNodeId, index)
    if (attribute(indexed, nodeIndex, ROOT_ATTRIBUTE) !== null) emitter.rootIndex = index
    if (attribute(indexed, nodeIndex, MASK_ATTRIBUTE) !== null) emitter.masks.push(box)
  })
  return byBackendId
}

function textOf(
  indexed: IndexedDocument,
  nodeIndex: number,
  factor: number,
  offset: readonly [number, number]
): { text: string; lineBoxes: Rect[] | null } {
  const { nodes, layout } = indexed.document
  const parts: string[] = []
  const boxes: Rect[] = []
  let wrapped = false
  for (const child of indexed.childrenOf[nodeIndex] ?? []) {
    if (nodes.nodeType[child] !== TEXT_NODE) continue
    const row = indexed.rowOf[child] ?? -1
    if (row < 0) continue
    const text = indexed.strings[layout.text[row] ?? -1]
    if (text !== undefined) parts.push(text)
    const lines = indexed.textBoxesOf.get(row) ?? []
    if (lines.length > 1) wrapped = true
    for (const line of lines) boxes.push(toRect(line, factor, offset))
  }
  const text = parts.join(' ').replace(WHITESPACE, ' ').trim().slice(0, TEXT_LIMIT)
  return { text, lineBoxes: wrapped ? boxes : null }
}

function scrollOf(indexed: IndexedDocument, row: number, factor: number): Rect | null {
  const scroll = indexed.document.layout.scrollRects?.[row]
  const client = indexed.document.layout.clientRects?.[row]
  if (scroll === undefined || client === undefined) return null
  const [x = 0, y = 0, width = 0, height = 0] = scroll
  const [, , clientWidth = 0, clientHeight = 0] = client
  if (width <= clientWidth + 0.5 && height <= clientHeight + 0.5) return null
  return [
    quantize(x / factor),
    quantize(y / factor),
    quantize(width / factor),
    quantize(height / factor),
  ]
}

function fontKey(indexed: IndexedDocument, row: number): string {
  return FONT_SAMPLE_PROPS.map((prop) => styleValue(indexed, row, prop) ?? '').join('\u0000')
}

function fontTuples(
  indexed: IndexedDocument,
  fonts: ReadonlyMap<number, string>
): ReadonlyMap<string, string> {
  const byTuple = new Map<string, string>()
  for (const [backendNodeId, font] of fonts) {
    const row = indexed.rowOf[indexed.nodeOf.get(backendNodeId) ?? -1] ?? -1
    if (row >= 0) byTuple.set(fontKey(indexed, row), font)
  }
  return byTuple
}
