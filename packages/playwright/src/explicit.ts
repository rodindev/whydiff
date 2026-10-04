import { basename } from 'node:path'
import { performance } from 'node:perf_hooks'
import { test, type Locator, type Page, type TestInfo } from '@playwright/test'

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
  type Explained,
} from './explain.js'
import { parseArgs, resolveSettings, useOptions, type ScreenshotArgs } from './options.js'
import { sameBytes, stampOf, type Outcome } from './outcome.js'
import {
  appendManifest,
  copyPng,
  outputRoot,
  pngPath,
  predictBaseline,
  relativeTo,
  sanitizeName,
  snapshotPath,
  writeSnapshot,
  type ManifestLine,
} from './output.js'

interface TestState {
  /** Snapshots recorded so far in this test. */
  ordinal: number
  /** `testInfo.attachments.length` when the previous explicit call began; the built-in's images for the next one come after it. */
  cursor: number
}

/** One call with its capture, before its baseline is known; the matcher's assertion carries the same. */
export type Recorded = Omit<Explained, 'baseline'>

interface Call extends Recorded {
  readonly ordinal: number
  readonly cursor: number
}

const states = new WeakMap<TestInfo, TestState>()

/** Placed after `toHaveScreenshot` with the same receiver and arguments: captures at most once, records the snapshot in two-run mode, explains a failure in an annotation and an attachment, keeps the baseline side; never fails the test, and cannot add to the assertion's error message, which the built-in recorded before it ran. */
export async function whydiffCapture(
  receiver: Page | Locator,
  ...args: ScreenshotArgs
): Promise<void> {
  const endedAt = performance.now()
  let testInfo: TestInfo
  try {
    testInfo = test.info()
  } catch {
    return
  }
  const state = stateOf(testInfo)
  const { cursor } = state
  state.cursor = testInfo.attachments.length
  const ordinal = nextOrdinal(testInfo)
  const settings = resolveSettings(useOptions(testInfo.project.use))
  const asserted: Asserted = { testInfo, settings, receiver, args, endedAt }
  const call: Call = {
    ...asserted,
    capture: captureOnce(asserted, `snapshot ${String(ordinal)}`),
    ordinal,
    cursor,
  }
  await onOwnTime(asserted, async () => {
    const root = outputRoot(settings.use)
    if (root !== null) {
      await recordCapture(call, root, ordinal, await comparedPng(testInfo, args, cursor))
    }
    if (!settings.enabled || testInfo.project.ignoreSnapshots) return
    await explainCall(call)
  })
}

/** The number of the next snapshot of the test, as the manifest and the annotations count them. */
export function nextOrdinal(testInfo: TestInfo): number {
  const state = stateOf(testInfo)
  state.ordinal += 1
  return state.ordinal
}

/** The two-run record of one call, shared with the matcher: snapshot file, attachment, compared PNG, manifest line. */
export async function recordCapture(
  call: Recorded,
  root: string,
  ordinal: number,
  compared: string | null
): Promise<void> {
  const { testInfo, receiver } = call
  const { name } = parseArgs(call.args)
  const fileName = sanitizeName(name)
  const path = snapshotPath(root, testInfo, ordinal, fileName)
  const png = compared === null ? null : await recordPng(testInfo, ordinal, compared, pngPath(path))
  const line: ManifestLine = {
    project: testInfo.project.name,
    testId: testInfo.testId,
    title: testInfo.titlePath.slice(1).join(' > '),
    file: relativeTo(testInfo.config.rootDir, testInfo.file),
    line: testInfo.line,
    ordinal,
    name: fileName,
    retry: testInfo.retry,
    receiver: isLocator(receiver) ? 'locator' : 'page',
    screenshot: name === null ? null : predictBaseline(testInfo, name),
    snapshot: relativeTo(root, path),
    png: png === null ? null : relativeTo(root, png),
  }
  try {
    const { snapshot } = await call.capture()
    await writeSnapshot(path, snapshot)
    await testInfo.attach(`whydiff/${String(ordinal)}-${fileName}`, {
      path,
      contentType: 'application/json',
    })
    await appendManifest(root, line)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    annotate(testInfo, `snapshot ${String(ordinal)} not captured: ${message}`)
    await appendManifest(root, { ...line, snapshot: null, error: message }).catch(() => undefined)
  }
}

async function recordPng(
  testInfo: TestInfo,
  ordinal: number,
  from: string,
  to: string
): Promise<string | null> {
  try {
    await copyPng(from, to)
    return to
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    annotate(testInfo, `snapshot ${String(ordinal)} png not copied: ${message}`)
    return null
  }
}

/** The actual the built-in attached on a failure, none when the failure has no actual image, else the baseline of a named call once it exists. */
async function comparedPng(
  testInfo: TestInfo,
  args: ScreenshotArgs,
  cursor: number
): Promise<string | null> {
  const attached = attachedImages(testInfo.attachments, cursor)
  if (attached !== null) return attached.actual ?? null
  const { name } = parseArgs(args)
  if (name === null) return null
  const baseline = predictBaseline(testInfo, name)
  return (await stampOf(baseline)) === null ? null : baseline
}

function stateOf(testInfo: TestInfo): TestState {
  let state = states.get(testInfo)
  if (state === undefined) {
    state = { ordinal: 0, cursor: 0 }
    states.set(testInfo, state)
  }
  return state
}

/** Reads what the built-in left in the attachments since the previous call, as the matcher reads its own call. */
async function explainCall(call: Call): Promise<void> {
  const { testInfo } = call
  try {
    if (!onChromium(testInfo, pageOf(call.receiver))) return
    const attached = attachedImages(testInfo.attachments, call.cursor)
    if (attached === null) await afterPass(call)
    else if (attached.actual === undefined) {
      // Only a failed assertion attaches its expected alone; its soft error is the test's last.
      const error = testInfo.errors.at(-1)?.message
      annotate(testInfo, `${notExplainedLabel(attached.name)}: ${noActualImage(error)}`)
    } else if (attached.expected !== undefined) {
      await afterImages(call, attached.name, attached.actual, attached.expected)
    }
  } catch (error) {
    report(testInfo, `screenshot ${String(call.ordinal)}`, error)
  }
}

/** No image attached: the built-in passed, or rewrote the baseline under --update-snapshots; only a named call knows its baseline. */
async function afterPass(call: Call): Promise<void> {
  const { testInfo } = call
  const { name } = parseArgs(call.args)
  if (name === null) {
    annotate(
      testInfo,
      `screenshot ${String(call.ordinal)} baseline snapshot not kept: name the screenshot, whydiffCapture cannot tell which baseline an unnamed one that passed was compared with`
    )
    return
  }
  const baseline = predictBaseline(testInfo, name)
  if ((await stampOf(baseline)) === null) return
  const { updateSnapshots } = testInfo.config
  const outcome: Outcome =
    updateSnapshots === 'all' || updateSnapshots === 'changed' ? 'written' : 'passed'
  const a = explained(call, baseline)
  if (!(await wantsBaselineSide(a, outcome))) return
  await keepBaselineSide(a).catch((error: unknown) => {
    report(testInfo, `${basename(baseline)} baseline snapshot not kept`, error)
  })
}

/** An actual beside its baseline: a failed comparison, unless both hold the same bytes, which the built-in writes for a missing baseline. */
async function afterImages(
  call: Call,
  name: string,
  actual: string,
  baseline: string
): Promise<void> {
  const { testInfo } = call
  const a = explained(call, baseline)
  const label = basename(baseline)
  if (await sameBytes(actual, baseline)) {
    await keepBaselineSide(a).catch((error: unknown) => {
      report(testInfo, `${label} baseline snapshot not kept`, error)
    })
    return
  }
  await explainFailure(a, { name, expected: baseline, actual }).catch((error: unknown) => {
    report(testInfo, notExplainedLabel(name), error)
  })
}

function explained(call: Call, baseline: string): Explained {
  const { testInfo, settings, receiver, args, endedAt, capture } = call
  return { testInfo, settings, receiver, args, endedAt, capture, baseline }
}
