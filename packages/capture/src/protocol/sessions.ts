import type { CDPSession, Page } from 'playwright-core'
import { WhydiffError } from '@whydiff/core'

/** One CDP session plus the id of the frame whose document it serves. */
interface FrameSession {
  readonly cdp: CDPSession
  readonly frameId: string
  readonly parentFrameId: string | null
  readonly url: string
}

/** The page session, one extra session per out-of-process frame, and the frames that refused one. */
export interface Sessions {
  readonly page: CDPSession
  readonly frames: readonly FrameSession[]
  readonly skipped: readonly string[]
}

/** Opens the page session and tries one per child frame; Chromium answers for in-process frames that the parent covers them. */
export async function openSessions(page: Page): Promise<Sessions> {
  const context = page.context()
  let pageSession: CDPSession
  try {
    pageSession = await context.newCDPSession(page)
  } catch (error) {
    throw new WhydiffError(
      'unsupported-browser',
      `whydiff captures through the Chrome DevTools Protocol, which this browser does not offer (${message(error)}). Run the screenshot tests in Chromium.`
    )
  }
  const frames: FrameSession[] = []
  const skipped: string[] = []
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    try {
      const cdp = await context.newCDPSession(frame)
      const { frameTree } = await cdp.send('Page.getFrameTree')
      frames.push({
        cdp,
        frameId: frameTree.frame.id,
        parentFrameId: frameTree.frame.parentId ?? null,
        url: frame.url(),
      })
    } catch (error) {
      if (!message(error).includes('part of the parent frame')) skipped.push(frame.url())
    }
  }
  return { page: pageSession, frames, skipped }
}

export async function closeSessions(sessions: Sessions): Promise<void> {
  await Promise.allSettled(
    [sessions.page, ...sessions.frames.map((f) => f.cdp)].map((s) => s.detach())
  )
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
