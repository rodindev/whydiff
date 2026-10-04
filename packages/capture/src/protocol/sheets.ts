import type { CDPSession } from 'playwright-core'

import { FREEZE_ATTRIBUTE, HARNESS_ATTRIBUTE } from '../constants.js'
import { hashText } from '../hash.js'
import type { RawSheet } from '../raw.js'

interface SheetHeader {
  readonly styleSheetId: string
  readonly frameId: string
  readonly sourceURL: string
  readonly origin: string
  readonly ownerNode?: number
  readonly isInline: boolean
  readonly isConstructed: boolean
  readonly loadingFailed?: boolean
}

/** Author sheets of one session: `CSS.enable` replays `styleSheetAdded` for every sheet before it answers. */
export async function readSheets(session: CDPSession, firstOrder: number): Promise<RawSheet[]> {
  const headers: SheetHeader[] = []
  const onAdded = (event: { header: SheetHeader }): void => {
    headers.push(event.header)
  }
  session.on('CSS.styleSheetAdded', onAdded)
  try {
    await session.send('CSS.enable')
  } finally {
    session.off('CSS.styleSheetAdded', onAdded)
  }
  const sheets: RawSheet[] = []
  for (const header of headers) {
    if (header.origin !== 'regular') continue
    const owner =
      header.ownerNode === undefined
        ? { attributes: [], tag: '' }
        : await describeOwner(session, header.ownerNode)
    if (owner.attributes.includes(FREEZE_ATTRIBUTE)) continue
    const { text } = await session.send('CSS.getStyleSheetText', {
      styleSheetId: header.styleSheetId,
    })
    // A <style> in a document without a URL (setContent, about:blank) is announced with
    // isInline false and an empty sourceURL; the owner element decides.
    const inline = !header.isConstructed && (header.isInline || owner.tag === 'STYLE')
    sheets.push({
      styleSheetId: header.styleSheetId,
      frameId: header.frameId,
      href: inline || header.isConstructed || header.sourceURL === '' ? null : header.sourceURL,
      inline,
      // Chromium reads a linked sheet back by requesting it again, past `page.route` and
      // `routeFromHAR`; when that request fails the text is empty, whatever the page parsed
      hash: header.loadingFailed === true ? '' : hashText(text),
      text,
      harness: owner.attributes.includes(HARNESS_ATTRIBUTE),
      ownerBackendNodeId: header.ownerNode ?? null,
      order: firstOrder + sheets.length,
    })
  }
  return sheets
}

async function describeOwner(
  session: CDPSession,
  backendNodeId: number
): Promise<{ attributes: string[]; tag: string }> {
  const { node } = await session.send('DOM.describeNode', { backendNodeId })
  return {
    attributes: (node.attributes ?? []).filter((_, index) => index % 2 === 0),
    tag: node.nodeName,
  }
}
