import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type {
  Locator,
  Page,
  PageAssertionsToHaveScreenshotOptions,
  TestInfo,
} from '@playwright/test'
import { captureSnapshot, type CaptureOptions } from '@whydiff/capture'
import type { SnapshotV1 } from '@whydiff/core'

import { resolveCapture, type WhydiffUseOptions } from './options.js'
import { configDir } from './output.js'

const ANNOTATION = 'whydiff'
const annotatedBrowser = new WeakSet<TestInfo>()

/** Captures the receiver of one screenshot assertion with the options it was taken with. */
export async function captureFor(
  testInfo: TestInfo,
  receiver: Page | Locator,
  use: WhydiffUseOptions,
  options: PageAssertionsToHaveScreenshotOptions
): Promise<{ snapshot: SnapshotV1; unsupported: readonly string[] }> {
  const resolved = resolveCapture(use, options)
  const style = await readStyles(resolved.stylePaths, configDir(testInfo))
  const capture: { -readonly [K in keyof CaptureOptions]: CaptureOptions[K] } = {
    ...resolved.capture,
    style,
    mask: resolved.mask,
  }
  if (isLocator(receiver)) capture.root = receiver
  return {
    snapshot: await captureSnapshot(pageOf(receiver), capture),
    unsupported: resolved.unsupported,
  }
}

/** True on Chromium; any other browser gets one annotation per test and no snapshots. */
export function onChromium(testInfo: TestInfo, page: Page): boolean {
  const name = page.context().browser()?.browserType().name()
  if (name === undefined || name === 'chromium') return true
  if (!annotatedBrowser.has(testInfo)) {
    annotatedBrowser.add(testInfo)
    annotate(testInfo, `${name} screenshots are not explained: whydiff captures in Chromium only`)
  }
  return false
}

export function isLocator(receiver: Page | Locator): receiver is Locator {
  return !('context' in receiver)
}

export function pageOf(receiver: Page | Locator): Page {
  return isLocator(receiver) ? receiver.page() : receiver
}

export function annotate(testInfo: TestInfo, description: string): void {
  testInfo.annotations.push({ type: ANNOTATION, description })
}

async function readStyles(paths: readonly string[], rootDir: string): Promise<string> {
  const texts = await Promise.all(paths.map((path) => readFile(resolve(rootDir, path), 'utf8')))
  return texts.join('\n')
}
