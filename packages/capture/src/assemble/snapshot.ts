import {
  SNAPSHOT_FORMAT_VERSION,
  type CompareV1,
  type FrameV1,
  type ImageV1,
  type Point,
  type Rect,
  type SnapshotV1,
} from '@whydiff/core'

import type { ResolvedOptions } from '../options.js'
import type { RawCapture } from '../raw.js'
import { VERSION } from '../version.js'
import { clipToRoot } from './clip.js'
import { placeDocuments, type PlacedDocument } from './frames.js'
import { layerNamer } from './layers.js'
import { emitDocument, type Emitter } from './nodes.js'
import { RuleTable } from './rules.js'
import { assembleSheets, orderSheets, type SheetRank } from './sheets.js'
import { StyleTable } from './styles.js'
import { quantize } from './units.js'

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/** Builds the snapshot from what the protocol stage collected; pure, so it is tested on recorded data. */
export function assembleSnapshot(raw: RawCapture, options: ResolvedOptions): SnapshotV1 {
  const placement = placeDocuments(raw)
  const sheets = orderSheets(raw.sheets, sheetRank(placement.documents))
  const emitter: Emitter = {
    factor: raw.metrics.layoutFactor,
    recorded: raw.props.length,
    testIdAttribute: options.testIdAttribute,
    props: raw.props,
    styles: new StyleTable(),
    rules: placement.documents.every((placed) => placed.raw.ruleGroups !== null)
      ? new RuleTable()
      : null,
    sheetIndex: new Map(sheets.map((sheet, index) => [sheet.styleSheetId, index])),
    layerName: layerNamer(sheets),
    shorthands: raw.shorthands,
    nodes: [],
    meta: [],
    masks: [],
    rootIndex: null,
  }
  const emitted = new Map<PlacedDocument, ReadonlyMap<number, number>>()
  let frames: FrameV1[] = []
  for (const placed of placement.documents) {
    emitted.set(placed, emitDocument(placed, emitter))
    frames.push({
      url: placed.raw.url,
      owner: ownerIndex(placed.owner, emitted),
      offset: placed.offset,
      scroll: placed.scroll,
      status: placed.status,
    })
  }
  for (const skipped of placement.skipped) {
    frames.push({
      url: skipped.url,
      owner: ownerIndex(skipped.owner, emitted),
      offset: [0, 0],
      scroll: [0, 0],
      status: 'skipped',
    })
  }

  let nodes = emitter.nodes
  const k = options.scale === 'device' ? raw.devicePixelRatio : 1
  const { metrics } = raw
  const image: Mutable<ImageV1> = {
    width: Math.round(metrics.viewportWidth * k),
    height: Math.round(metrics.viewportHeight * k),
    k,
    layoutFactor: metrics.layoutFactor,
    origin: [quantize(metrics.scrollX), quantize(metrics.scrollY)],
    fullPage: options.fullPage,
  }
  if (options.fullPage) {
    image.width = Math.ceil(metrics.cssContentWidth * k)
    image.height = Math.ceil(metrics.cssContentHeight * k)
    image.origin = [0, 0]
  }
  if (emitter.rootIndex !== null) {
    const box = nodes[emitter.rootIndex]?.box ?? [0, 0, 0, 0]
    const origin: Point = [Math.floor(box[0]), Math.floor(box[1])]
    const clip: Rect = [
      origin[0],
      origin[1],
      Math.ceil(box[0] + box[2]) - origin[0],
      Math.ceil(box[1] + box[3]) - origin[1],
    ]
    const clipped = clipToRoot(nodes, frames, emitter.rootIndex, clip)
    nodes = clipped.nodes
    frames = clipped.frames
    image.origin = origin
    image.width = Math.round(clip[2] * k)
    image.height = Math.round(clip[3] * k)
    image.fullPage = false
    image.root = clipped.rootIndex
  }

  const compare: Mutable<CompareV1> = {
    threshold: options.threshold,
    animations: options.animations,
    caret: options.caret,
    scale: options.scale,
  }
  if (options.maxDiffPixels !== null) compare.maxDiffPixels = options.maxDiffPixels
  if (options.maxDiffPixelRatio !== null) compare.maxDiffPixelRatio = options.maxDiffPixelRatio

  return {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    tool: { name: 'whydiff', version: VERSION, source: 'cdp', browser: raw.browser },
    page: { url: raw.url, title: raw.title },
    image,
    viewport: {
      width: quantize(metrics.viewportWidth),
      height: quantize(metrics.viewportHeight),
      scrollX: quantize(metrics.scrollX),
      scrollY: quantize(metrics.scrollY),
    },
    content: {
      width: quantize(metrics.cssContentWidth),
      height: quantize(metrics.cssContentHeight),
    },
    compare,
    frames,
    masks: emitter.masks,
    sheets: assembleSheets(sheets),
    props: raw.props,
    styles: emitter.styles.rows,
    ...(emitter.rules === null
      ? {}
      : {
          rules: emitter.rules.rules,
          attributions: emitter.rules.rows,
          declarations: emitter.rules.declarations.entries,
          uses: emitter.rules.uses,
        }),
    nodes,
  }
}

function sheetRank(documents: readonly PlacedDocument[]): SheetRank {
  const byFrame = new Map(documents.map((placed) => [placed.raw.frameId, placed]))
  return (sheet) => {
    const placed = byFrame.get(sheet.frameId)
    if (placed === undefined) return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
    const node = placed.indexed.nodeOf.get(sheet.ownerBackendNodeId ?? -1)
    return [placed.frameIndex, node ?? Number.MAX_SAFE_INTEGER]
  }
}

function ownerIndex(
  owner: PlacedDocument['owner'],
  emitted: ReadonlyMap<PlacedDocument, ReadonlyMap<number, number>>
): number | null {
  if (owner === null) return null
  const backendNodeId = owner.parent.raw.document.nodes.backendNodeId[owner.nodeIndex]
  return backendNodeId === undefined
    ? null
    : (emitted.get(owner.parent)?.get(backendNodeId) ?? null)
}
