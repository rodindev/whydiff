import type { Locator } from 'playwright-core'

import { DEFAULT_THRESHOLD } from './constants.js'

/** What the screenshot next to the snapshot was taken with; mirrors Playwright's screenshot options. */
export interface CaptureOptions {
  /** Capture unit, as in `locator.screenshot()`; the whole page when absent. Refused unless it matches one element; never waited for. */
  readonly root?: Locator
  readonly fullPage?: boolean
  readonly mask?: readonly Locator[]
  /** CSS applied while the screenshot was taken (the contents of Playwright's `stylePath`). */
  readonly style?: string
  readonly animations?: 'disabled' | 'allow'
  readonly caret?: 'hide' | 'initial'
  readonly scale?: 'css' | 'device'
  readonly compare?: {
    readonly threshold?: number
    readonly maxDiffPixels?: number
    readonly maxDiffPixelRatio?: number
  }
  /** Attribute that `testId` is read from. */
  readonly testIdAttribute?: string
}

export interface ResolvedOptions {
  readonly root: Locator | null
  readonly fullPage: boolean
  readonly mask: readonly Locator[]
  readonly style: string
  readonly animations: 'disabled' | 'allow'
  readonly caret: 'hide' | 'initial'
  readonly scale: 'css' | 'device'
  readonly threshold: number
  readonly maxDiffPixels: number | null
  readonly maxDiffPixelRatio: number | null
  readonly testIdAttribute: string
}

export function resolveOptions(options: CaptureOptions): ResolvedOptions {
  return {
    root: options.root ?? null,
    fullPage: options.fullPage ?? false,
    mask: options.mask ?? [],
    style: options.style ?? '',
    animations: options.animations ?? 'disabled',
    caret: options.caret ?? 'hide',
    scale: options.scale ?? 'css',
    threshold: options.compare?.threshold ?? DEFAULT_THRESHOLD,
    maxDiffPixels: options.compare?.maxDiffPixels ?? null,
    maxDiffPixelRatio: options.compare?.maxDiffPixelRatio ?? null,
    testIdAttribute: options.testIdAttribute ?? 'data-testid',
  }
}
