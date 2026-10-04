import type { Page } from 'playwright-core'
import { WhydiffError, type SnapshotV1 } from '@whydiff/core'

import { assembleSnapshot } from './assemble/snapshot.js'
import { freeze } from './freeze/freeze.js'
import { resolveOptions, type CaptureOptions } from './options.js'
import { acceptedProps } from './props.js'
import { collectRaw } from './protocol/collect.js'
import { closeSessions, openSessions } from './protocol/sessions.js'

/** Captures the render tree of `page` as the screenshot taken with the same options saw it. */
export async function captureSnapshot(
  page: Page,
  options: CaptureOptions = {}
): Promise<SnapshotV1> {
  const resolved = resolveOptions(options)
  const sessions = await openSessions(page)
  try {
    const restore = await freeze([sessions.page, ...sessions.frames.map((f) => f.cdp)], resolved)
    try {
      const browser = page.context().browser()?.version() ?? ''
      const props = await acceptedProps(sessions.page, browser)
      const raw = await collectRaw(page, sessions, props, resolved)
      const snapshot = assembleSnapshot(raw, resolved)
      if (resolved.root !== null && snapshot.image.root === undefined) {
        throw new WhydiffError(
          'capture-failed',
          `${resolved.root.toString()} matched one element, but it left the page or was not rendered when whydiff read it. Make it match the one element the screenshot shows.`
        )
      }
      return snapshot
    } catch (error) {
      if (error instanceof WhydiffError) throw error
      const reason = error instanceof Error ? error.message : String(error)
      throw new WhydiffError(
        'capture-failed',
        `The browser refused a capture step (${reason}). Re-run the test; if it repeats, open an issue with the page URL.`
      )
    } finally {
      await restore()
    }
  } finally {
    await closeSessions(sessions)
  }
}
