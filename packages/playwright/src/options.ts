import type { Locator, PageAssertionsToHaveScreenshotOptions } from '@playwright/test'
import type { CaptureOptions } from '@whydiff/capture'

import { CAPTURE_BUDGET_MS, MAX_EXPLAINED } from './constants.js'

/** Screenshot defaults mirrored from `expect.toHaveScreenshot` and whydiff's own switches, set under `use.whydiff` in the Playwright config. */
export interface WhydiffUseOptions {
  readonly threshold?: number
  readonly maxDiffPixels?: number
  readonly maxDiffPixelRatio?: number
  readonly animations?: 'disabled' | 'allow'
  readonly caret?: 'hide' | 'initial'
  readonly scale?: 'css' | 'device'
  readonly stylePath?: string | readonly string[]
  /** Where each run records its snapshots and the manifest, env `WHYDIFF_OUT` winning; with neither set, nothing is recorded per run. */
  readonly outputDir?: string
  /** False leaves `toHaveScreenshot` to the built-in alone; default true. */
  readonly enabled?: boolean
  /** Captures the baseline side when its snapshot is missing and the assertion passed; default true. */
  readonly backfill?: boolean
  /** Milliseconds per assertion for its one capture, the analysis and the writes, added to the test's timeout while whydiff works; over it the rest is skipped with an annotation. Default 60000. */
  readonly budgetMs?: number
  /** Attaches the Markdown and the snapshots of a failed screenshot to the test; default true. False leaves the reporter nothing to read, so every Markdown stays in its test. */
  readonly attach?: boolean
  /** With the whydiff reporter in the configuration that runs the tests, the failing screenshots of each project in a run that get their Markdown in the test, each counted once across retries; later ones attach the snapshots and say where the reporter explains them. A fuse for runs where almost everything fails; default 500. */
  readonly maxExplained?: number
}

/** `use.whydiff` with the matcher's switches resolved. */
export interface Settings {
  readonly use: WhydiffUseOptions
  readonly enabled: boolean
  readonly backfill: boolean
  readonly budgetMs: number
  readonly attach: boolean
  readonly maxExplained: number
}

/** What `toHaveScreenshot` accepts: an optional name, then optional options. */
export type ScreenshotArgs =
  | []
  | [name: string | readonly string[]]
  | [options: PageAssertionsToHaveScreenshotOptions]
  | [name: string | readonly string[], options: PageAssertionsToHaveScreenshotOptions]

export interface ParsedArgs {
  readonly name: readonly string[] | null
  readonly options: PageAssertionsToHaveScreenshotOptions
}

export function parseArgs(args: ScreenshotArgs): ParsedArgs {
  const [first, second] = args
  if (first === undefined) return { name: null, options: {} }
  if (typeof first === 'string') return { name: [first], options: second ?? {} }
  if (isSegments(first)) return { name: first, options: second ?? {} }
  return { name: null, options: first }
}

function isSegments(value: unknown): value is readonly string[] {
  return Array.isArray(value)
}

const UNSUPPORTED = ['clip', 'omitBackground'] as const

export interface ResolvedCapture {
  /** Everything except `style`, `root` and `mask`, which the caller adds. */
  readonly capture: CaptureOptions
  readonly stylePaths: readonly string[]
  readonly mask: readonly Locator[]
  /** Options the snapshot cannot express. */
  readonly unsupported: readonly string[]
}

/** Merges `use.whydiff` defaults with the call's own options, the call winning. */
export function resolveCapture(
  use: WhydiffUseOptions,
  options: PageAssertionsToHaveScreenshotOptions
): ResolvedCapture {
  const compare: { threshold?: number; maxDiffPixels?: number; maxDiffPixelRatio?: number } = {}
  const threshold = options.threshold ?? use.threshold
  if (threshold !== undefined) compare.threshold = threshold
  const maxDiffPixels = options.maxDiffPixels ?? use.maxDiffPixels
  if (maxDiffPixels !== undefined) compare.maxDiffPixels = maxDiffPixels
  const maxDiffPixelRatio = options.maxDiffPixelRatio ?? use.maxDiffPixelRatio
  if (maxDiffPixelRatio !== undefined) compare.maxDiffPixelRatio = maxDiffPixelRatio
  const capture: { -readonly [K in keyof CaptureOptions]: CaptureOptions[K] } = { compare }
  const animations = options.animations ?? use.animations
  if (animations !== undefined) capture.animations = animations
  const caret = options.caret ?? use.caret
  if (caret !== undefined) capture.caret = caret
  const scale = options.scale ?? use.scale
  if (scale !== undefined) capture.scale = scale
  if (options.fullPage !== undefined) capture.fullPage = options.fullPage
  const stylePath = options.stylePath ?? use.stylePath ?? []
  return {
    capture,
    stylePaths: typeof stylePath === 'string' ? [stylePath] : stylePath,
    mask: options.mask ?? [],
    unsupported: UNSUPPORTED.filter((key) => options[key] !== undefined),
  }
}

export function resolveSettings(use: WhydiffUseOptions): Settings {
  return {
    use,
    enabled: use.enabled ?? true,
    backfill: use.backfill ?? true,
    budgetMs: use.budgetMs ?? CAPTURE_BUDGET_MS,
    attach: use.attach ?? true,
    maxExplained: use.maxExplained ?? MAX_EXPLAINED,
  }
}

/** The `whydiff` entry of a project's `use`, when it looks like one. */
export function useOptions(use: unknown): WhydiffUseOptions {
  if (typeof use !== 'object' || use === null || !('whydiff' in use)) return {}
  const { whydiff } = use
  return typeof whydiff === 'object' && whydiff !== null ? whydiff : {}
}
