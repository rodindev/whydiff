import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { Locator, Page, TestInfo } from '@playwright/test'
import { screenshotId, serializeSnapshot, WhydiffError, type SnapshotV1 } from '@whydiff/core'

import { attachmentName, CONTENT_TYPES, type WhydiffKind } from './attachments.js'
import { explainedLater, POINTER, reporterDir } from './cap.js'
import { annotate, captureFor } from './capture.js'
import { MESSAGE_LINES, REPORT_DIR } from './constants.js'
import {
  annotationOf,
  explanationOf,
  pixelExplanation,
  type Explanation,
  type Lead,
} from './lead.js'
import { parseArgs, type ScreenshotArgs, type Settings } from './options.js'
import { stampOf, type Outcome } from './outcome.js'
import { configDir, relativeTo, shardSuffix, sidecarPath } from './output.js'
import {
  analyzePair,
  COMPARED,
  count,
  pairIdentity,
  pixelSummary,
  readPng,
  readSnapshot,
  screenReport,
  writeIfChanged,
  type PairIdentity,
} from './pair.js'

let warned = false
const REPEATED = /-\d+$/

/** One screenshot assertion once the built-in ran, before its baseline is known. */
export interface Asserted {
  readonly testInfo: TestInfo
  readonly settings: Settings
  readonly receiver: Page | Locator
  readonly args: ScreenshotArgs
  /** `performance.now()` when the built-in was done; the budget and `capturedAfterMs` count from it. */
  readonly endedAt: number
}

/** The assertion with its one capture and its baseline, as the matcher and the explicit call both hand it over. */
export interface Explained extends Asserted {
  /** The receiver captured at most once per assertion; the two-run file, the sidecar and the actual side share it. */
  readonly capture: () => Promise<Captured>
  /** The PNG the built-in compared against. */
  readonly baseline: string
}

/** One capture of the receiver and how long after `endedAt` it started. */
export interface Captured {
  readonly snapshot: SnapshotV1
  readonly capturedAfterMs: number
}

/** The PNGs the built-in produced for a failed comparison, under the name of its attachments. */
export interface BuiltinFiles {
  readonly name: string
  readonly expected: string
  readonly actual: string
}

/** A capture that runs on its first call and hands every later one the same result; `label` names the snapshot in the annotation of options it ignores. */
export function captureOnce(a: Asserted, label: string): () => Promise<Captured> {
  let captured: Promise<Captured> | null = null
  return () => {
    captured ??= captureSide(a, label)
    return captured
  }
}

/** Runs whydiff's part of one assertion with the budget added to the timeout, then takes back what it left unused, so the timeout grows by whydiff's own time; a `test.step` or `toPass` timeout keeps its deadline. */
export async function onOwnTime(a: Asserted, work: () => Promise<void>): Promise<void> {
  const { testInfo } = a
  const budget = a.settings.budgetMs
  // `timeout` reads the test's slot while `setTimeout` writes the running one, a hook's or a fixture
  // teardown's, so both writes start from the value written first instead of reading it back.
  const extended = testInfo.timeout === 0 ? null : testInfo.timeout + budget
  if (extended !== null) testInfo.setTimeout(extended)
  try {
    await work()
  } finally {
    const unused = budget - Math.ceil(performance.now() - a.endedAt)
    // Once the test timed out, the running slot belongs to its teardown, which must not shrink.
    if (extended !== null && unused > 0 && testInfo.status !== 'timedOut') {
      testInfo.setTimeout(extended - unused)
    }
  }
}

/** Captures the actual side; while its project's in-test explanations last it explains the pair against the baseline-side snapshot, past them it writes where the reporter's explanation will be and keeps the snapshots for it. Annotates the test with the first line a person reads and returns the lines for the assertion's message. */
export async function explainFailure(a: Explained, files: BuiltinFiles): Promise<string[]> {
  const captured = await a.capture()
  const after: SnapshotV1 = {
    ...captured.snapshot,
    tool: { ...captured.snapshot.tool, capturedAfterMs: captured.capturedAfterMs },
  }
  checkBudget(a)
  const expected = sidecarPath(a.baseline)
  const hasExpected = (await stampOf(expected)) !== null
  // Without attachments the reporter has nothing to explain, so the test keeps every explanation.
  const reportDir = a.settings.attach
    ? await explainedLater(
        a.testInfo.project.name,
        capScreen(a.testInfo, files.name),
        a.settings.maxExplained
      )
    : null
  const explanation =
    reportDir === null
      ? await describeFailure(a, files, after)
      : pointer(a, files.name, reportDir, hasExpected)
  const { page, leads } = explanation
  const actualPath = a.testInfo.outputPath(`${files.name}-actual.whydiff.json`)
  const markdownPath = a.testInfo.outputPath(`${files.name}-whydiff.md`)
  await mkdir(dirname(actualPath), { recursive: true })
  await Promise.all([
    writeFile(actualPath, serializeSnapshot(after)),
    writeFile(markdownPath, page),
  ])
  const first = annotationOf(explanation)
  // A toPass loop repeats one screenshot under numbered names; its test says the same thing once.
  if (first !== undefined && !a.testInfo.annotations.some((n) => n.description === first)) {
    annotate(a.testInfo, first)
  }
  const message = messageLines(a, files.name, leads, markdownPath, hasExpected)
  if (!a.settings.attach) return message
  await a.testInfo.attach(attachmentName(files.name, 'markdown'), {
    body: page,
    contentType: CONTENT_TYPES.markdown,
  })
  await attach(a.testInfo, files.name, 'snapshot-actual', actualPath)
  if (hasExpected) await attach(a.testInfo, files.name, 'snapshot-expected', expected)
  return message
}

/** True after the built-in wrote the baseline; after a pass only to backfill a missing sidecar. */
export async function wantsBaselineSide(a: Explained, outcome: Outcome): Promise<boolean> {
  switch (outcome) {
    case 'written':
    case 'written-but-failed':
      return true
    case 'passed':
      return a.settings.backfill && (await stampOf(sidecarPath(a.baseline))) === null
    default:
      return false
  }
}

/** Captures the baseline side and stores it next to the baseline PNG, identical bytes left untouched. */
export async function keepBaselineSide(a: Explained): Promise<void> {
  const { snapshot } = await a.capture()
  checkBudget(a)
  await writeIfChanged(sidecarPath(a.baseline), serializeSnapshot(snapshot))
}

/** Turns a whydiff error into an annotation; the first per worker also into a warning. */
export function report(testInfo: TestInfo, label: string, error: unknown): void {
  const description = `${label}: ${error instanceof Error ? error.message : String(error)}`
  annotate(testInfo, description)
  if (warned) return
  warned = true
  console.warn(`whydiff: ${description} (later whydiff errors in this worker are annotations only)`)
}

async function describeFailure(
  a: Explained,
  files: BuiltinFiles,
  after: SnapshotV1
): Promise<Explanation> {
  const [before, expected, actual] = await Promise.all([
    readSnapshot(sidecarPath(a.baseline)),
    readPng(files.expected),
    readPng(files.actual),
  ])
  const identity = identityOf(a.testInfo, files.name)
  const explanation =
    before === null
      ? pixelExplanation(identity, pixelSummary(expected, actual, after.compare.threshold))
      : explanationOf(
          screenReport(analyzePair(identity, before, after, expected, actual)),
          screenshotId(identity.screen)
        )
  checkBudget(a)
  return explanation
}

function pointer(a: Explained, name: string, reportDir: string, hasExpected: boolean): Explanation {
  const { testInfo } = a
  const dir = relativeTo(configDir(testInfo), reportDir) || '.'
  const suffix = shardSuffix(testInfo.config.shard)
  const where = hasExpected
    ? `${dir}/screenshots${suffix}/${screenshotId(identityOf(testInfo, name).screen)}.md`
    : `${dir}/report${suffix}.md, under No baseline snapshot`
  const lead = `${POINTER}${where}.`
  const page = [
    lead,
    'The reporter writes it there when the run ends, because this project has more failed screenshots in the run than whydiff explains inside their tests.',
    'Nothing failed in whydiff.',
    '',
  ].join('\n')
  return { page, leads: [{ text: lead, causes: [] }], causes: [] }
}

// The sides, the first lines without their cause ids, which need not be the run's, and a last
// line: the command that explains the screenshot from the run's report once the reporter wrote
// it, else where the rest of the lines are.
function messageLines(
  a: Explained,
  name: string,
  leads: readonly Lead[],
  markdownPath: string,
  inReport: boolean
): string[] {
  if (leads.length === 0) return []
  const more = leads.length - MESSAGE_LINES
  const reportDir = a.settings.attach && inReport ? reporterDir() : null
  const rest = a.settings.attach
    ? `the attachment ${attachmentName(name, 'markdown')}`
    : relativeTo(configDir(a.testInfo), markdownPath)
  const last =
    reportDir !== null
      ? `${more > 0 ? `+ ${count(more)} more; ` : ''}details when the run ends: ${explainCommand(a.testInfo, name, reportDir)}`
      : more > 0
        ? `+ ${count(more)} more in ${rest}`
        : null
  return [
    `whydiff, ${COMPARED.before} -> ${COMPARED.after}:`,
    ...leads.slice(0, MESSAGE_LINES).map((lead) => `- ${lead.text}`),
    ...(last === null ? [] : [last]),
  ]
}

// Run from the config directory, as the pointer's paths are; `--report` only where explain would
// not find the run's report by itself.
function explainCommand(testInfo: TestInfo, name: string, reportDir: string): string {
  const id = screenshotId(identityOf(testInfo, name).screen)
  const dir = relativeTo(configDir(testInfo), reportDir) || '.'
  const report = `${dir}/report${shardSuffix(testInfo.config.shard)}.json`
  const command = `npx whydiff explain ${id}`
  return report === `${REPORT_DIR}/report.json` ? command : `${command} --report ${report}`
}

// One token per screenshot whatever its attempt: a retry keeps the test id, and the built-in
// numbers the later calls of one name in a test, as a toPass loop makes them, `-1`, `-2` and on.
function capScreen(testInfo: TestInfo, name: string): string {
  return `${testInfo.project.name}|${testInfo.testId}|${name.replace(REPEATED, '')}`
}

async function captureSide(a: Asserted, label: string): Promise<Captured> {
  const capturedAfterMs = Math.round(performance.now() - a.endedAt)
  const { snapshot, unsupported } = await captureFor(
    a.testInfo,
    a.receiver,
    a.settings.use,
    parseArgs(a.args).options
  )
  if (unsupported.length > 0) annotate(a.testInfo, `${label} ignores ${unsupported.join(', ')}`)
  return { snapshot, capturedAfterMs }
}

function checkBudget(a: Explained): void {
  const elapsed = Math.round(performance.now() - a.endedAt)
  if (elapsed <= a.settings.budgetMs) return
  throw new WhydiffError(
    'capture-failed',
    `skipped after ${String(elapsed)} ms, over the budget of ${String(a.settings.budgetMs)} ms. Raise use.whydiff.budgetMs to keep it.`
  )
}

function identityOf(testInfo: TestInfo, name: string): PairIdentity {
  return pairIdentity(
    {
      project: testInfo.project.name,
      testId: testInfo.testId,
      titles: testInfo.titlePath.slice(1),
      file: relativeTo(testInfo.config.rootDir, testInfo.file),
      line: testInfo.line,
      repeat: testInfo.repeatEachIndex,
    },
    name
  )
}

async function attach(
  testInfo: TestInfo,
  name: string,
  kind: WhydiffKind,
  path: string
): Promise<void> {
  await testInfo.attach(attachmentName(name, kind), { path, contentType: CONTENT_TYPES[kind] })
}
