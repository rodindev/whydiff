import type { FrameStatus, Point } from '@whydiff/core'

import type { RawCapture, RawDocument } from '../raw.js'
import { indexDocument, styleValue, type IndexedDocument } from './document.js'
import { px, quantize } from './units.js'

/** A document placed in top-level coordinates, in the order its nodes are emitted (frame tree pre-order). */
export interface PlacedDocument {
  readonly raw: RawDocument
  readonly indexed: IndexedDocument
  readonly frameIndex: number
  readonly offset: Point
  readonly scroll: Point
  readonly status: FrameStatus
  /** The owning iframe: the parent document and the node index there; null for the main frame. */
  readonly owner: { readonly parent: PlacedDocument; readonly nodeIndex: number } | null
}

/** A frame without nodes: Playwright knew it, the protocol could not deliver its document. */
interface SkippedPlacement {
  readonly url: string
  readonly owner: { readonly parent: PlacedDocument; readonly nodeIndex: number } | null
}

export interface Placement {
  readonly documents: readonly PlacedDocument[]
  readonly skipped: readonly SkippedPlacement[]
}

export function placeDocuments(raw: RawCapture): Placement {
  const { metrics, props, ruleProps } = raw
  const factor = metrics.layoutFactor
  const main = raw.documents.find((d) => d.parentFrameId === null)
  if (main === undefined) return { documents: [], skipped: [] }
  const documents: PlacedDocument[] = []
  const skipped: SkippedPlacement[] = []
  const place = (rawDocument: RawDocument, owner: PlacedDocument['owner']): void => {
    const indexed = indexDocument(rawDocument.strings, rawDocument.document, [
      ...props,
      ...ruleProps,
    ])
    const { document } = rawDocument
    const scroll: Point =
      owner === null
        ? [quantize(metrics.scrollX), quantize(metrics.scrollY)]
        : [quantize(document.scrollOffsetX / factor), quantize(document.scrollOffsetY / factor)]
    let offset: Point = [0, 0]
    let status: FrameStatus = 'captured'
    if (owner !== null) {
      const row = owner.parent.indexed.rowOf[owner.nodeIndex] ?? -1
      const bounds = owner.parent.indexed.document.layout.bounds[row] ?? [0, 0]
      const inset = (prop: string): number => px(styleValue(owner.parent.indexed, row, prop))
      offset = [
        quantize(
          owner.parent.offset[0] +
            (bounds[0] ?? 0) / factor +
            inset('border-left-width') +
            inset('padding-left') -
            scroll[0]
        ),
        quantize(
          owner.parent.offset[1] +
            (bounds[1] ?? 0) / factor +
            inset('border-top-width') +
            inset('padding-top') -
            scroll[1]
        ),
      ]
      const transform = styleValue(owner.parent.indexed, row, 'transform') ?? 'none'
      status =
        owner.parent.status === 'approximate' || transform !== 'none' ? 'approximate' : 'captured'
    }
    const placed: PlacedDocument = {
      raw: rawDocument,
      indexed,
      frameIndex: documents.length,
      offset,
      scroll,
      status,
      owner,
    }
    documents.push(placed)
    for (const child of childrenOf(raw, rawDocument, indexed)) {
      const nodeIndex = indexed.nodeOf.get(child.ownerBackendNodeId ?? -1) ?? -1
      if (nodeIndex >= 0 && (indexed.rowOf[nodeIndex] ?? -1) >= 0) {
        place(child, { parent: placed, nodeIndex })
      } else {
        skipped.push({ url: child.url, owner: null })
      }
    }
    for (const frame of raw.skippedFrames) {
      if (frame.parentFrameId !== rawDocument.frameId) continue
      const nodeIndex = indexed.nodeOf.get(frame.ownerBackendNodeId ?? -1) ?? -1
      skipped.push({ url: frame.url, owner: nodeIndex >= 0 ? { parent: placed, nodeIndex } : null })
    }
  }
  place(main, null)
  const placedIds = new Set(documents.map((d) => d.raw.frameId))
  for (const document of raw.documents) {
    if (!placedIds.has(document.frameId)) skipped.push({ url: document.url, owner: null })
  }
  for (const frame of raw.skippedFrames) {
    if (frame.parentFrameId === null || !placedIds.has(frame.parentFrameId)) {
      skipped.push({ url: frame.url, owner: null })
    }
  }
  return { documents, skipped }
}

/** Child documents of `parent` in document order of their owning iframes. */
function childrenOf(raw: RawCapture, parent: RawDocument, indexed: IndexedDocument): RawDocument[] {
  const position = (child: RawDocument): number =>
    indexed.nodeOf.get(child.ownerBackendNodeId ?? -1) ?? -1
  return raw.documents
    .filter((d) => d.parentFrameId === parent.frameId && d.ownerBackendNodeId !== null)
    .sort((a, b) => position(a) - position(b) || a.frameId.localeCompare(b.frameId))
}
