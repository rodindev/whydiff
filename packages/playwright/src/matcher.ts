import { basename, relative } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  expect as rootExpect,
  test,
  type ExpectMatcherState,
  type Locator,
  type MatcherReturnType,
  type Page,
  type PageAssertionsToHaveScreenshotOptions,
  type TestInfo,
} from '@playwright/test'

import { attachedImages, noActualImage, notExplainedLabel } from './attachments.js'
import { annotate, isLocator, onChromium, pageOf } from './capture.js'
import {
  captureOnce,
  explainFailure,
  keepBaselineSide,
  onOwnTime,
  report,
  wantsBaselineSide,
  type Asserted,
  type BuiltinFiles,
  type Explained,
} from './explain.js'
import { nextOrdinal, recordCapture } from './explicit.js'
import {
  parseArgs,
  resolveSettings,
  useOptions,
  type ScreenshotArgs,
  type Settings,
  type WhydiffUseOptions,
} from './options.js'
import { classifyOutcome, stampOf, type Outcome } from './outcome.js'
import { outputRoot, predictBaseline } from './output.js'

// A private child of the root expect, created once at import: the built-in is always called through it.
const builtin = rootExpect.extend({})
const records = new WeakMap<TestInfo, Settings>()
const ACTUAL_PNG = /-actual\.png$/

interface BuiltinCall {
  readonly threw: boolean
  readonly error: unknown
  readonly endedAt: number
}

interface Assertion extends Explained {
  readonly state: ExpectMatcherState
  readonly baselineExisted: boolean
  readonly attachmentsBefore: number
  readonly call: BuiltinCall
  readonly outcome: Outcome
}

/** Keeps the options the fixture resolved for one test, `test.use` overrides included. */
export function recordSettings(testInfo: TestInfo, use: WhydiffUseOptions): void {
  records.set(testInfo, resolveSettings(use))
}

/** `toHaveScreenshot` that lets the built-in decide, then explains what it produced; installed by `withWhydiff`. */
export async function toHaveScreenshot(
  this: ExpectMatcherState,
  receiver: Page | Locator,
  ...args: ScreenshotArgs
): Promise<MatcherReturnType> {
  const testInfo = currentTestInfo()
  const settings =
    testInfo === null
      ? null
      : (records.get(testInfo) ?? resolveSettings(useOptions(testInfo.project.use)))
  const parsed = parseArgs(args)
  const baseline = testInfo === null ? null : baselineOf(testInfo, parsed.name)
  if (
    testInfo === null ||
    settings === null ||
    baseline === null ||
    !settings.enabled ||
    testInfo.project.ignoreSnapshots
  ) {
    return resultOf(this, await callBuiltin(this, receiver, args))
  }
  const before = await stampOf(baseline)
  const errorsBefore = testInfo.errors.length
  const attachmentsBefore = testInfo.attachments.length
  const call = await callBuiltin(this, receiver, args)
  const outcome = classifyOutcome({
    threw: call.threw,
    matcherResult: matcherResultOf(call.error) !== null,
    before,
    after: await stampOf(baseline),
    errorsBefore,
    errorsAfter: testInfo.errors.length,
  })
  const asserted: Asserted = { testInfo, settings, receiver, args, endedAt: call.endedAt }
  let lines: readonly string[] = []
  await onOwnTime(asserted, async () => {
    lines = await explain({
      ...asserted,
      state: this,
      baseline,
      capture: captureOnce(asserted, `${basename(baseline)} snapshot`),
      baselineExisted: before !== null,
      attachmentsBefore,
      call,
      outcome,
    })
  })
  return resultOf(this, call, lines)
}

function currentTestInfo(): TestInfo | null {
  try {
    return test.info()
  } catch {
    return null
  }
}

function baselineOf(testInfo: TestInfo, name: readonly string[] | null): string | null {
  try {
    return predictBaseline(testInfo, name)
  } catch {
    return null
  }
}

async function callBuiltin(
  state: ExpectMatcherState,
  receiver: Page | Locator,
  args: ScreenshotArgs
): Promise<BuiltinCall> {
  const configured = builtin.configure({ timeout: state.timeout })
  try {
    const assertion: NegatableAssertion = isLocator(receiver)
      ? configured(receiver)
      : configured(receiver)
    await screenshot(state.isNot ? assertion.not : assertion, args)
    return { threw: false, error: null, endedAt: performance.now() }
  } catch (error) {
    return { threw: true, error, endedAt: performance.now() }
  }
}

interface ScreenshotAssertion {
  toHaveScreenshot(
    name: string | readonly string[],
    options?: PageAssertionsToHaveScreenshotOptions
  ): Promise<void>
  toHaveScreenshot(options?: PageAssertionsToHaveScreenshotOptions): Promise<void>
}

interface NegatableAssertion extends ScreenshotAssertion {
  readonly not: ScreenshotAssertion
}

// The arguments go on in their original form: a name and a one-segment list resolve differently.
async function screenshot(assertion: ScreenshotAssertion, args: ScreenshotArgs): Promise<void> {
  const [first, second] = args
  if (first === undefined) await assertion.toHaveScreenshot()
  else if (isName(first)) await assertion.toHaveScreenshot(first, second)
  else await assertion.toHaveScreenshot(first)
}

function isName(value: unknown): value is string | readonly string[] {
  return typeof value === 'string' || Array.isArray(value)
}

function resultOf(
  state: ExpectMatcherState,
  call: BuiltinCall,
  lines: readonly string[] = []
): MatcherReturnType {
  if (!call.threw) return { pass: !state.isNot, message: () => '' }
  const message = withLines(
    call.error instanceof Error ? call.error.message : String(call.error),
    lines
  )
  const matcherResult = matcherResultOf(call.error)
  // A failing result rather than a rethrow, so the error points at the test's line, not at whydiff.
  if (matcherResult === null) return { pass: state.isNot, message: () => message }
  const result: MatcherReturnType & { diff?: unknown } = {
    pass: state.isNot,
    message: () => message,
    name: 'toHaveScreenshot',
    expected: field(matcherResult, 'expected'),
    actual: field(matcherResult, 'actual'),
    diff: field(matcherResult, 'diff'),
  }
  const log = field(matcherResult, 'log')
  if (Array.isArray(log) && log.every((entry) => typeof entry === 'string')) result.log = log
  return result
}

// After the first paragraph, the pixel count, and indented like it. Playwright's report pairs the
// message with its diff image by the first line and the snapshot name, which stay as they were.
function withLines(message: string, lines: readonly string[]): string {
  if (lines.length === 0) return message
  const parts = message.split('\n')
  const start = parts.findIndex((part, index) => index > 0 && part.trim() !== '')
  const end = start < 0 ? -1 : parts.findIndex((part, index) => index > start && part.trim() === '')
  const at = end < 0 ? parts.length : end
  const block = ['', ...lines.map((line) => `  ${line}`)]
  return [...parts.slice(0, at), ...block, ...parts.slice(at)].join('\n')
}

function matcherResultOf(error: unknown): object | null {
  if (typeof error !== 'object' || error === null || !('matcherResult' in error)) return null
  const { matcherResult } = error
  return typeof matcherResult === 'object' && matcherResult !== null ? matcherResult : null
}

function field(source: object, key: string): unknown {
  return key in source ? Reflect.get(source, key) : undefined
}

async function explain(a: Assertion): Promise<readonly string[]> {
  if (a.outcome === 'errored') return []
  const label = basename(a.baseline)
  try {
    if (!onChromium(a.testInfo, pageOf(a.receiver))) return []
    const files = a.outcome === 'failed' ? await builtinFiles(a) : null
    const root = outputRoot(a.settings.use)
    if (root !== null) {
      const ordinal = nextOrdinal(a.testInfo)
      await recordCapture(a, root, ordinal, await comparedPng(a, files), nameIfFailed(a))
    }
    if (a.state.isNot) return []
    if (a.outcome === 'failed') {
      if (files === null) {
        const error = a.call.error instanceof Error ? a.call.error.message : undefined
        annotate(a.testInfo, `${notExplainedLabel(builtinName(a))}: ${noActualImage(error)}`)
        return []
      }
      if (!a.baselineExisted) return []
      return await explainFailure(a, files).catch((error: unknown) => {
        report(a.testInfo, notExplainedLabel(files.name), error)
        return []
      })
    } else if (await wantsBaselineSide(a, a.outcome)) {
      await keepBaselineSide(a).catch((error: unknown) => {
        report(a.testInfo, `${label} baseline snapshot not kept`, error)
      })
    }
  } catch (error) {
    report(a.testInfo, label, error)
  }
  return []
}

/** The PNG the built-in compared: the actual it attached on a failure, else the baseline once it exists. */
async function comparedPng(a: Assertion, files: BuiltinFiles | null): Promise<string | null> {
  if (a.outcome === 'failed') return files?.actual ?? null
  return (await stampOf(a.baseline)) === null ? null : a.baseline
}

// The run's reporter keys a failed screenshot by the images the built-in attached, by its place in
// the test when there are none.
function nameIfFailed(a: Assertion): string | null {
  if (a.outcome !== 'failed') return null
  return attachedImages(a.testInfo.attachments, a.attachmentsBefore)?.name ?? null
}

async function builtinFiles(a: Assertion): Promise<BuiltinFiles | null> {
  const attached = attachedImages(a.testInfo.attachments, a.attachmentsBefore)
  const actual = (await existingPath(reported(a, 'actual'))) ?? attached?.actual
  if (actual === undefined) return null
  const expected = (await existingPath(reported(a, 'expected'))) ?? a.baseline
  return { name: builtinName(a), expected, actual }
}

// The built-in reports an actual path named like its attachments whether or not it wrote the file.
function builtinName(a: Assertion): string {
  const attached = attachedImages(a.testInfo.attachments, a.attachmentsBefore)
  if (attached !== null) return attached.name
  const actual = reported(a, 'actual')
  return typeof actual === 'string'
    ? relative(a.testInfo.outputDir, actual).replace(ACTUAL_PNG, '')
    : basename(a.baseline, '.png')
}

function reported(a: Assertion, key: string): unknown {
  const matcherResult = matcherResultOf(a.call.error)
  return matcherResult === null ? undefined : field(matcherResult, key)
}

async function existingPath(value: unknown): Promise<string | undefined> {
  if (typeof value !== 'string') return undefined
  return (await stampOf(value)) === null ? undefined : value
}
