import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter'
import {
  buildReport,
  clusterCauses,
  code,
  noneExplained,
  parseSnapshot,
  renderReport,
  renderRunPage,
  renderScreenshot,
  screenshotId,
  serializeReport,
  SNAPSHOT_FORMAT_VERSION,
  type ReportV1,
  type ScreenInput,
  type SnapshotV1,
} from '@whydiff/core'

import {
  acrossAttempts,
  compareListed,
  listScreenshots,
  readImageAttachment,
  readWhydiffAttachment,
  type Listed,
  type ReportedAttachment,
} from './attachments.js'
import { closeRun, openRun, POINTER } from './cap.js'
import { REPORT_DIR } from './constants.js'
import {
  annotationOf,
  causesOf,
  explanationOf,
  leadsOf,
  pixelExplanation,
  type Explanation,
} from './lead.js'
import { relativeTo, shardSuffix } from './output.js'
import {
  analyzePair,
  COMPARED,
  count,
  decodePng,
  NO_BASELINE,
  pairIdentity,
  pixelSummary,
  screenReport,
  sourceOf,
  type PairIdentity,
  type PixelSummary,
  type TestIdentity,
} from './pair.js'
import { jobSummary } from './summary.js'
import { VERSION } from './version.js'

/** Options of `@whydiff/playwright/reporter` in the Playwright config. */
export interface WhydiffReporterOptions {
  /** Where `report.json`, `report.md`, `report.html` and `screenshots/` go, relative to the config directory; default `whydiff-report`. */
  readonly outputDir?: string
}

interface MissingBaseline {
  readonly identity: PairIdentity
  readonly summary: PixelSummary
}

interface Ended {
  readonly identity: TestIdentity
  /** Every attempt, in the order Playwright ran them. */
  readonly results: readonly TestResult[]
}

interface Attempt {
  readonly result: TestResult
  readonly listed: readonly Listed[]
}

interface NotExplained {
  readonly identity: PairIdentity
  readonly reason: string
}

/** The attachment the run page is linked by. */
const RUN_PAGE = 'whydiff/run'
const REPORTER_NAME = '@whydiff/playwright/reporter'
const HTML_FIRST = `the html reporter runs before this one, so Playwright's HTML report keeps each test's own page; list ${REPORTER_NAME} before html (npx whydiff init does it)`
// The job summary is Markdown, where a bare @whydiff would read as a mention.
const HTML_FIRST_MARKDOWN = `the html reporter runs before this one, so Playwright's HTML report keeps each test's own page; list ${code(REPORTER_NAME)} before ${code('html')} (${code('npx whydiff init')} does it)`

const NOT_EXPLAINED =
  "Failed screenshots that neither their test nor this report could explain, each with the reason its whydiff annotation gives, else the error of its assertion, or the test's own when the test timed out during it."

const BLANK: SnapshotV1 = {
  formatVersion: SNAPSHOT_FORMAT_VERSION,
  tool: { name: 'whydiff', version: VERSION, source: 'cdp', browser: '' },
  page: { url: '', title: '' },
  image: { width: 0, height: 0, k: 1, layoutFactor: 1, origin: [0, 0], fullPage: false },
  viewport: { width: 0, height: 0, scrollX: 0, scrollY: 0 },
  content: { width: 0, height: 0 },
  compare: { threshold: 0, animations: 'disabled', caret: 'hide', scale: 'css' },
  frames: [],
  masks: [],
  sheets: [],
  props: [],
  styles: [],
  nodes: [],
}

/** Explains every failed screenshot of the run from its attachments, those past the run's in-test cap included, clusters the causes into one report and lists the failures it could not explain. Listed before Playwright's `html` reporter, it hands that report the run's explanation of each failed screenshot, those past the cap included; with `GITHUB_STEP_SUMMARY` set, it writes a short summary of a run with failed screenshots there. */
export default class WhydiffReporter implements Reporter {
  private readonly outputDir: string | undefined
  private config: FullConfig | null = null
  private run: string | null = null
  private readonly tests = new Map<string, Ended>()

  constructor(options: WhydiffReporterOptions = {}) {
    this.outputDir = options.outputDir
  }

  onBegin(config: FullConfig): void {
    this.config = config
    this.run = openRun(reportDir(config, this.outputDir))
    if (htmlFirst(config)) console.log(`whydiff: ${HTML_FIRST}`)
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const rootDir = this.config?.rootDir ?? ''
    const identity: TestIdentity = {
      project: test.parent.project()?.name ?? '',
      testId: test.id,
      titles: test.titlePath().slice(3),
      file: relativeTo(rootDir, test.location.file),
      line: test.location.line,
      repeat: test.repeatEachIndex,
    }
    this.tests.set(test.id, {
      identity,
      results: [...(this.tests.get(test.id)?.results ?? []), result],
    })
  }

  async onEnd(): Promise<void> {
    const config = this.config
    if (config === null) return
    try {
      await this.write(config)
    } catch (error) {
      console.log(`whydiff: report not written: ${messageOf(error)}`)
    } finally {
      if (this.run !== null) closeRun(this.run)
    }
  }

  printsToStdio(): boolean {
    return false
  }

  private async write(config: FullConfig): Promise<void> {
    const dir = reportDir(config, this.outputDir)
    const suffix = shardSuffix(config.shard)
    const tests = [...this.tests.values()].map(({ identity, results }) => {
      const attempts: Attempt[] = results.map((result) => ({
        result,
        listed: listScreenshots(
          identity,
          result.attachments,
          result.steps,
          result.annotations,
          result.status === 'timedOut' ? (result.errors[0]?.message ?? null) : null
        ),
      }))
      const listed = acrossAttempts(
        identity,
        attempts.map((a) => a.listed)
      )
      return { identity, attempts, listed }
    })
    const listed = tests.flatMap((test) => test.listed).sort(compareListed)
    const screens: ScreenInput[] = []
    const missing: MissingBaseline[] = []
    const notExplained: NotExplained[] = []
    for (const entry of listed) {
      if (entry.notExplained !== null) {
        notExplained.push({ identity: entry.identity, reason: entry.notExplained })
        continue
      }
      try {
        const analyzed = await analyzeListed(entry)
        if ('summary' in analyzed) missing.push(analyzed)
        else screens.push(analyzed)
      } catch (error) {
        console.log(`whydiff: ${entry.identity.title} skipped: ${messageOf(error)}`)
        notExplained.push({
          identity: entry.identity,
          reason: `its files could not be read: ${firstLine(messageOf(error))}`,
        })
      }
    }
    const report = buildReport({
      version: VERSION,
      compared: COMPARED,
      screens,
      clusters: clusterCauses(screens.filter((s) => s.regions.length > 0)),
    })
    const markdown = join(dir, `report${suffix}.md`)
    const failed = missing.length + notExplained.length
    const text =
      renderReport(report, { failed }) + missingSection(missing) + notExplainedSection(notExplained)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `report${suffix}.json`), serializeReport(report))
    await writeFile(markdown, text)
    await writeScreenshots(report, join(dir, `screenshots${suffix}`))
    const explain = explanations(report, screens, missing)
    let later = 0
    for (const test of tests) {
      for (const { result, listed } of test.attempts) {
        // A failed screenshot gets the run's page in the one attempt the report took it from.
        const taken = listed.filter((l) => test.listed.includes(l)).map((l) => l.identity.screen)
        later += await writeBack(test.identity, result, (screen) =>
          taken.includes(screen) ? explain(screen) : undefined
        )
      }
    }
    const page = join(dir, `report${suffix}.html`)
    await writeFile(page, renderRunPage(report, { failed }))
    attachRunPage(
      tests
        .flatMap((test) => test.attempts)
        .filter((a) => a.listed.some((l) => l.files !== null || l.notExplained !== null))
        .map((a) => a.result),
      page
    )
    const { summary } = report
    const totals = [
      summary.screenshots.changed === 0 && failed > 0
        ? noneExplained(failed)
        : `${count(summary.screenshots.changed)} of ${plural(summary.screenshots.compared, 'screenshot')} changed${missing.length > 0 ? `, ${count(missing.length)} more without a baseline snapshot` : ''}${notExplained.length > 0 ? `, ${count(notExplained.length)} more failed but not explained` : ''}`,
      `${plural(summary.causes, 'cause')}, ${plural(summary.unexplained, 'unexplained region')}`,
    ]
    for (const line of totals) console.log(`whydiff: ${line}`)
    if (later > 0) {
      console.log(
        `whydiff: ${plural(later, 'failed screenshot')} past use.whydiff.maxExplained explained when the run ended, not in ${later === 1 ? 'its test' : 'their tests'}`
      )
    }
    console.log(`whydiff: ${relative(process.cwd(), markdown)}`)
    if (summary.screenshots.changed + failed > 0) {
      await writeJobSummary(totals, report, htmlFirst(config) ? [HTML_FIRST_MARKDOWN] : [], {
        report: relative(process.cwd(), markdown),
        screenshots: `${relative(process.cwd(), join(dir, `screenshots${suffix}`))}/`,
      })
    }
  }
}

async function writeJobSummary(
  totals: readonly string[],
  report: ReportV1,
  warnings: readonly string[],
  files: { readonly report: string; readonly screenshots: string }
): Promise<void> {
  const step = process.env.GITHUB_STEP_SUMMARY
  if (step === undefined || step === '') return
  await appendFile(step, jobSummary(totals, report, warnings, files)).catch((error: unknown) => {
    console.log(`whydiff: job summary not written: ${messageOf(error)}`)
  })
}

interface Explained {
  /** What the run's report says about the screenshot. */
  readonly run: Explanation
  /** The annotation its test wrote, from the same pair explained alone. */
  readonly own: () => string | undefined
}

// The run's explanation of a screenshot, or the one its No baseline snapshot line stands for, and
// what its test saw of the same pair alone, whose causes need not be the run's.
function explanations(
  report: ReportV1,
  screens: readonly ScreenInput[],
  missing: readonly MissingBaseline[]
): (screen: string) => Explained | undefined {
  const bare = new Map(missing.map((m) => [m.identity.screen, m]))
  const pairs = new Map(screens.map((s) => [s.screen, s]))
  return (screen) => {
    const pixels = bare.get(screen)
    if (pixels !== undefined) {
      const explained = pixelExplanation(pixels.identity, pixels.summary)
      return { run: explained, own: () => annotationOf(explained) }
    }
    const pair = pairs.get(screen)
    if (pair === undefined) return undefined
    const id = screenshotId(screen)
    return {
      run: explanationOf(report, id),
      own: () => {
        const alone = screenReport(pair)
        return annotationOf({ leads: leadsOf(alone, id), causes: causesOf(alone, id) })
      },
    }
  }
}

// The run's page of each failed screenshot takes the place of what its test attached, a pointer
// or the test's own page, in the attachment and in the copy the test wrote next to its actual
// image, and its first line that of the annotation the test wrote: the ids then match
// report.json and annot: finds every test of a cause. Changed in place, before the html
// reporter reads them in its own onEnd: it finds a step's attachments in the result's by identity.
async function writeBack(
  identity: TestIdentity,
  result: TestResult,
  explain: (screen: string) => Explained | undefined
): Promise<number> {
  let pointers = 0
  for (const attachment of result.attachments) {
    const own = readWhydiffAttachment(attachment)
    const attached = own?.kind === 'markdown' ? attachment.body?.toString('utf8') : undefined
    if (own === null || attached === undefined) continue
    const explained = explain(pairIdentity(identity, own.name).screen)
    if (explained === undefined) continue
    const pointer = attached.startsWith(POINTER)
    const written = pointer ? attached.split('\n', 1)[0] : explained.own()
    const annotation = result.annotations.find(
      (a) => a.type === 'whydiff' && a.description === written
    )
    const run = annotationOf(explained.run)
    if (annotation !== undefined && run !== undefined) annotation.description = run
    attachment.body = Buffer.from(explained.run.page)
    await rewriteCopy(result, own.name, explained.run.page)
    if (pointer) pointers++
  }
  return pointers
}

/** Rewrites the page the test wrote as `<name>-whydiff.md` next to its actual image, when it is there. */
async function rewriteCopy(result: TestResult, name: string, page: string): Promise<void> {
  const actual = result.attachments.find((a) => {
    const image = readImageAttachment(a)
    return image?.name === name && image.kind === 'actual'
  })?.path
  const copy = actual?.replace(/-actual\.png$/, '-whydiff.md')
  if (copy !== undefined && copy !== actual && existsSync(copy)) await writeFile(copy, page)
}

/** True when the config lists Playwright's html reporter before this one, which then reads each test's results before this one rewrites them. */
function htmlFirst(config: FullConfig): boolean {
  const base = config.configFile === undefined ? config.rootDir : dirname(config.configFile)
  const from = createRequire(join(base, 'playwright.config.js'))
  // Playwright resolves a reporter's name from the config's directory; a name it cannot resolve stays as written.
  const resolved = (name: string): string => {
    try {
      return from.resolve(name)
    } catch {
      return name
    }
  }
  const own = resolved(REPORTER_NAME)
  const names = config.reporter.map(([name]) => name)
  const html = names.indexOf('html')
  const self = names.findIndex((name) => name === REPORTER_NAME || resolved(name) === own)
  return html >= 0 && self > html
}

function reportDir(config: FullConfig, outputDir: string | undefined): string {
  const base = config.configFile === undefined ? config.rootDir : dirname(config.configFile)
  return resolve(base, outputDir ?? REPORT_DIR)
}

async function analyzeListed(entry: Listed): Promise<ScreenInput | MissingBaseline> {
  if (entry.files === null) return titleOnly(entry.identity)
  const { whydiff, images } = entry.files
  if (
    whydiff['snapshot-actual'] === undefined ||
    images.expected === undefined ||
    images.actual === undefined
  ) {
    throw new Error('the actual snapshot or an image of the pair is not attached')
  }
  const [after, expected, actual] = await Promise.all([
    readText(whydiff['snapshot-actual']).then(parseSnapshot),
    readBytes(images.expected).then(decodePng),
    readBytes(images.actual).then(decodePng),
  ])
  if (whydiff['snapshot-expected'] === undefined) {
    return {
      identity: entry.identity,
      summary: pixelSummary(expected, actual, after.compare.threshold),
    }
  }
  const before = parseSnapshot(await readText(whydiff['snapshot-expected']))
  return analyzePair(entry.identity, before, after, expected, actual)
}

function titleOnly(identity: PairIdentity): ScreenInput {
  return {
    ...identity,
    before: BLANK,
    after: BLANK,
    matching: { pairs: [], removed: [], added: [], afterOf: [], beforeOf: [], lowConfidence: [] },
    deltas: { pairs: [], added: [], removed: [] },
    explanation: {
      causes: [],
      regions: [],
      unexplained: [],
      suppressed: { movedWithAncestor: 0, inherited: 0, derivedOnly: 0 },
    },
    regions: [],
    differing: 0,
    massChange: false,
    sizeMismatch: null,
  }
}

async function readBytes(attachment: ReportedAttachment): Promise<Uint8Array> {
  if (attachment.body !== undefined) return attachment.body
  if (attachment.path !== undefined) return readFile(attachment.path)
  throw new Error(`attachment ${attachment.name} has neither a body nor a path`)
}

async function readText(attachment: ReportedAttachment): Promise<string> {
  return new TextDecoder().decode(await readBytes(attachment))
}

function missingSection(missing: readonly MissingBaseline[]): string {
  if (missing.length === 0) return ''
  const lines = [
    '',
    `## No baseline snapshot (${count(missing.length)})`,
    NO_BASELINE,
    ...missing.map(
      ({ identity, summary }) =>
        `- ${identity.title} | ${sourceOf(identity)} | ${String(summary.width)}x${String(summary.height)} px, ${count(summary.differing)} differing, ${plural(summary.regions.length, 'region')}`
    ),
  ]
  return `${lines.join('\n')}\n`
}

function notExplainedSection(notExplained: readonly NotExplained[]): string {
  if (notExplained.length === 0) return ''
  const lines = [
    '',
    `## Not explained (${count(notExplained.length)})`,
    NOT_EXPLAINED,
    ...notExplained.map(
      ({ identity, reason }) => `- ${identity.title} | ${sourceOf(identity)} | ${reason}`
    ),
  ]
  return `${lines.join('\n')}\n`
}

/** Links the run page from every test with a failed screenshot; Playwright's HTML reporter, listed after this one, stores one copy of the file under its content hash and opens it in a new tab. */
function attachRunPage(results: readonly TestResult[], path: string): void {
  for (const result of results) {
    result.attachments.unshift({ name: RUN_PAGE, contentType: 'text/html', path })
  }
}

async function writeScreenshots(report: ReportV1, dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
  const changed = report.screenshots.filter((s) => s.status === 'changed')
  if (changed.length === 0) return
  await mkdir(dir, { recursive: true })
  for (const screenshot of changed) {
    await writeFile(join(dir, `${screenshot.id}.md`), renderScreenshot(report, screenshot.id))
  }
}

function plural(value: number, word: string): string {
  return `${count(value)} ${word}${value === 1 ? '' : 's'}`
}

function firstLine(text: string): string {
  return text.split('\n', 1)[0] ?? ''
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
