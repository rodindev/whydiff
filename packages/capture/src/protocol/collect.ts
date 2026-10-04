import type { CDPSession, Page } from 'playwright-core'

import type { ResolvedOptions } from '../options.js'
import type { AcceptedProps } from '../props.js'
import type {
  AxNode,
  DocumentSnapshot,
  LayoutMetrics,
  RawCapture,
  RawDocument,
  RawSheet,
  SkippedFrame,
} from '../raw.js'
import { fontSamples, readFonts } from './fonts.js'
import { frameOwner, readFrameTree } from './frames.js'
import { normalizeDocument } from './normalize.js'
import { readRuleGroups, ruleGroups } from './rules.js'
import type { Sessions } from './sessions.js'
import { readSheets } from './sheets.js'
import { shorthands, unexpanded } from './shorthands.js'

interface CapturedDocument {
  readonly session: CDPSession
  readonly strings: readonly string[]
  readonly document: DocumentSnapshot
  readonly frameId: string
}

/** Asks the browser for everything a snapshot is built from; the page must already be frozen. */
export async function collectRaw(
  page: Page,
  sessions: Sessions,
  { props, ruleProps }: AcceptedProps,
  options: ResolvedOptions
): Promise<RawCapture> {
  const all = [sessions.page, ...sessions.frames.map((f) => f.cdp)]
  const metrics = toMetrics(await sessions.page.send('Page.getLayoutMetrics'))
  const tree = await readFrameTree(all)
  const captured: CapturedDocument[] = []
  for (const session of all) {
    const snapshot = await session.send('DOMSnapshot.captureSnapshot', {
      computedStyles: [...props, ...ruleProps],
      includePaintOrder: true,
      includeDOMRects: true,
    })
    for (const document of snapshot.documents.map(normalizeDocument)) {
      const frameId = snapshot.strings[document.frameId] ?? ''
      captured.push({ session, strings: snapshot.strings, document, frameId })
    }
  }
  const topLayer = new Map<CDPSession, readonly number[]>()
  for (const session of all) {
    await session.send('DOM.enable')
    await session.send('DOM.getDocument', { depth: 0 })
    topLayer.set(session, await readTopLayer(session))
  }
  const sheets: RawSheet[] = []
  for (const session of all) sheets.push(...(await readSheets(session, sheets.length)))
  const groups = await readRuleGroups(
    captured.map((c) => ({ session: c.session, groups: ruleGroups(c.document, c.strings) }))
  )
  const browser = browserName(page)
  const longhands = await shorthands(sessions.page, browser, unexpanded(groups))
  const sessionOf = new Map(captured.map((c) => [c.frameId, c.session]))
  const documents: RawDocument[] = []
  for (const [index, c] of captured.entries()) {
    const parentFrameId = tree.parents.get(c.frameId) ?? null
    const parentSession = parentFrameId === null ? null : (sessionOf.get(parentFrameId) ?? null)
    documents.push({
      frameId: c.frameId,
      parentFrameId,
      ownerBackendNodeId:
        parentSession === null ? null : await frameOwner(parentSession, c.frameId),
      url: c.strings[c.document.documentURL] ?? '',
      strings: c.strings,
      document: c.document,
      axNodes: await readAx(c.session, c.frameId),
      topLayer: topLayer.get(c.session) ?? [],
      fonts: await readFonts(c.session, fontSamples(c.document, props)),
      ruleGroups: groups[index] ?? null,
    })
  }
  const skippedFrames: SkippedFrame[] = []
  for (const url of sessions.skipped) {
    const frameId = [...tree.urls].find(([, u]) => u === url)?.[0]
    const parentFrameId = frameId === undefined ? null : (tree.parents.get(frameId) ?? null)
    const parentSession = parentFrameId === null ? null : (sessionOf.get(parentFrameId) ?? null)
    skippedFrames.push({
      url,
      parentFrameId,
      ownerBackendNodeId:
        parentSession === null || frameId === undefined
          ? null
          : await frameOwner(parentSession, frameId),
    })
  }
  return {
    url: page.url(),
    title: await page.title(),
    browser,
    devicePixelRatio:
      options.scale === 'device' ? await page.evaluate<number>('window.devicePixelRatio') : 1,
    props,
    ruleProps,
    metrics,
    documents,
    skippedFrames,
    sheets,
    shorthands: longhands,
  }
}

function toMetrics(metrics: {
  readonly cssLayoutViewport: { readonly clientWidth: number; readonly clientHeight: number }
  readonly cssVisualViewport: { readonly pageX: number; readonly pageY: number }
  readonly cssContentSize: { readonly width: number; readonly height: number }
  readonly contentSize: { readonly width: number }
}): LayoutMetrics {
  const { cssLayoutViewport, cssVisualViewport, cssContentSize, contentSize } = metrics
  return {
    viewportWidth: cssLayoutViewport.clientWidth,
    viewportHeight: cssLayoutViewport.clientHeight,
    scrollX: cssVisualViewport.pageX,
    scrollY: cssVisualViewport.pageY,
    cssContentWidth: cssContentSize.width,
    cssContentHeight: cssContentSize.height,
    layoutFactor: cssContentSize.width > 0 ? contentSize.width / cssContentSize.width : 1,
  }
}

async function readAx(session: CDPSession, frameId: string): Promise<readonly AxNode[]> {
  try {
    const { nodes } = await session.send('Accessibility.getFullAXTree', { frameId })
    return nodes
  } catch {
    return []
  }
}

async function readTopLayer(session: CDPSession): Promise<readonly number[]> {
  try {
    const { nodeIds } = await session.send('DOM.getTopLayerElements')
    const described = await Promise.all(
      nodeIds.map((nodeId) => session.send('DOM.describeNode', { nodeId }))
    )
    return described.map(({ node }) => node.backendNodeId)
  } catch {
    return []
  }
}

function browserName(page: Page): string {
  const browser = page.context().browser()
  return browser === null ? 'chromium' : `${browser.browserType().name()} ${browser.version()}`
}
