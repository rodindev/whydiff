import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { WhydiffError } from '@whydiff/core'
import type { ManifestLine, ReportedAttachment, TestIdentity } from '@whydiff/playwright'

import { walkFiles } from './walk.js'

const MANIFEST = 'manifest.jsonl'
const SIDECAR = '.whydiff.json'
const PNG = /\.png$/i
// Playwright names an attempt's directory after its test and project, then `-retry<n>` from the first
// retry on, then `-repeat<n>` under --repeat-each from the second repeat on.
const ATTEMPT = /^(.*?)(?:-retry(\d+))?(?:-repeat(\d+))?$/
const WHYDIFF_COPY = /^whydiff-(.+)-(snapshot-(?:actual|expected))-[0-9a-f]{40}\.json$/
const MARKDOWN = /^(.+)-whydiff\.md$/
const IMAGE = /^(.+)-(?:expected|actual|diff)\.png$/
const DIFF = /^(.+)-diff\.png$/
const TITLE_LINE =
  /^# whydiff: (.*) \| (?:\d[\d,]* causes? \| \d[\d,]* unexplained regions?|no baseline snapshot)$/
// A page without a baseline snapshot ends without the screenshot id and keeps the project field
// of a test of an unnamed project empty, where the other pages leave it out.
const SOURCE_LINE =
  /^source: (.*):(\d+) \| (?:(.*) \| )?\d+x\d+ px, [\d,]+ changed pixels(?: \| s[0-9a-z]{6})?$/
const CODE_SPAN = /^(`+)(.*)\1$/
const ERROR_CONTEXT = 'error-context.md'
// Playwright's error context names a failed test by its title path, file first, and its location.
const NAME_LINE = /^- Name: (.+)$/m
const LOCATION_LINE = /^- Location: .+:(\d+):\d+$/m
// What Playwright's sanitizeForFilePath turns into one `-` when it names a test's output directory after its project.
const UNSAFE = /[^-0-9A-Za-z\u0080-\uffff]+/g
const FROM_TEST_RESULTS = 'rebuilt from test-results, which keep no annotation that says why'
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  markdown: 'text/markdown',
  'snapshot-actual': 'application/json',
  'snapshot-expected': 'application/json',
}

/** One side of a pair found in a run directory: who it belongs to and the two files to read; `png` is null when the run recorded none. */
export interface RunSide {
  readonly key: string
  readonly title: string
  readonly file?: string
  readonly line?: number
  readonly project?: string
  readonly snapshot: string
  readonly png: string | null
}

/** The sides of a snapshot directory, plus the baselines that have no snapshot next to them. */
export interface SnapshotSides {
  readonly sides: ReadonlyMap<string, RunSide>
  readonly withoutSnapshot: readonly string[]
}

/** One test attempt of a Playwright `test-results` directory, as the reporter would have seen it. */
export interface TestRun {
  readonly identity: TestIdentity
  readonly attachments: readonly ReportedAttachment[]
  /** In place of the annotations test-results do not keep: one per failed screenshot, saying so. */
  readonly annotations: readonly { readonly type: string; readonly description: string }[]
}

/** The test attempts of a `test-results` directory, and how many with whydiff files or a failed screenshot it skipped for want of a description or an error context that names their test. */
export interface TestResults {
  readonly runs: readonly TestRun[]
  readonly skipped: number
}

/** True when a directory holds the `manifest.jsonl` of two-run mode. */
export async function isRunDir(dir: string): Promise<boolean> {
  return stat(join(dir, MANIFEST)).then(
    (info) => info.isFile(),
    () => false
  )
}

/** The sides of a two-run output, keyed by project, test id and ordinal; the last retry of each wins. */
export async function runSides(dir: string): Promise<Map<string, RunSide>> {
  const lines = (await readManifest(dir)).sort((a, b) => a.retry - b.retry)
  const sides = new Map<string, RunSide>()
  for (const line of lines) {
    if (line.snapshot === null) continue
    const key = `${line.project}|${line.testId}|${String(line.ordinal)}`
    sides.set(key, {
      key,
      title: `${line.title} > ${line.name}`,
      file: line.file,
      line: line.line,
      project: line.project,
      snapshot: join(dir, line.snapshot),
      png: line.png === null ? null : join(dir, line.png),
    })
  }
  return sides
}

/** The baselines of a Playwright snapshot directory that have a sidecar snapshot, keyed by relative path. */
export async function snapshotSides(dir: string): Promise<SnapshotSides> {
  const files = await walkFiles(dir)
  const sides = new Map<string, RunSide>()
  const withoutSnapshot: string[] = []
  for (const png of files.filter((file) => PNG.test(file))) {
    const key = relative(dir, png).split('\\').join('/').replace(PNG, '')
    const snapshot = png.replace(PNG, SIDECAR)
    if (!files.includes(snapshot)) {
      withoutSnapshot.push(key)
      continue
    }
    sides.set(key, { key, title: key, snapshot, png })
  }
  return { sides, withoutSnapshot }
}

/** A test directory's name as Playwright builds it: `testId` without the retry, `base` without the repeat index either. */
interface Attempt {
  readonly testId: string
  readonly base: string
  readonly retry: number
  readonly repeat: number
}

/** A test attempt no whydiff page names, with the error context Playwright wrote for it, empty when there is none. */
interface Unnamed {
  readonly attempt: Attempt
  readonly context: string
  readonly attachments: readonly ReportedAttachment[]
  readonly annotations: TestRun['annotations']
}

/** Every test attempt of a `test-results` directory with its attachments, each test's in the order they ran, rebuilt from the files Playwright copied there and the Markdown whydiff wrote next to them; a test whose pages only point to the run report, as past `use.whydiff.maxExplained`, from Playwright's error context. */
export async function listTestResults(dir: string): Promise<TestResults> {
  const entries = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((a, b) => attemptOf(a).retry - attemptOf(b).retry || (a < b ? -1 : a > b ? 1 : 0))
  const read: (TestRun | Unnamed)[] = []
  for (const name of entries) {
    const test = await readTestDir(join(dir, name), name)
    if (test !== null) read.push(test)
  }
  const projects = [...new Set(read.flatMap((t) => ('identity' in t ? [t.identity.project] : [])))]
  const runs: TestRun[] = []
  const skipped = new Set<string>()
  for (const test of read) {
    const identity = 'identity' in test ? test.identity : contextIdentity(test, projects)
    if (identity !== null) {
      runs.push({ identity, attachments: test.attachments, annotations: test.annotations })
    } else if ('attempt' in test) skipped.add(test.attempt.testId)
  }
  return { runs, skipped: skipped.size }
}

async function readTestDir(dir: string, name: string): Promise<TestRun | Unnamed | null> {
  const attempt = attemptOf(name)
  const files = (await readdir(dir)).sort()
  const copies = await readdir(join(dir, 'attachments')).then(
    (list) => list.sort(),
    () => []
  )
  const attachments: ReportedAttachment[] = []
  for (const copy of copies) {
    const match = WHYDIFF_COPY.exec(copy)
    const kind = match?.[2]
    if (match === null || kind === undefined) continue
    attachments.push({
      name: `whydiff/${match[1] ?? ''}/${kind}`,
      contentType: CONTENT_TYPES[kind] ?? '',
      path: join(dir, 'attachments', copy),
    })
  }
  for (const file of files) {
    const markdown = MARKDOWN.exec(file)?.[1]
    if (markdown === undefined) continue
    attachments.push({
      name: `whydiff/${markdown}/markdown`,
      contentType: 'text/markdown',
      path: join(dir, file),
    })
  }
  for (const file of files) {
    if (IMAGE.test(file))
      attachments.push({ name: file, contentType: 'image/png', path: join(dir, file) })
  }
  // Worded as the matcher words a reason, so the reporter matches it by the screenshot's name.
  const annotations = files.flatMap((file) => {
    const failed = DIFF.exec(file)?.[1]
    return failed === undefined
      ? []
      : [{ type: 'whydiff', description: `${failed}: not explained: ${FROM_TEST_RESULTS}` }]
  })
  for (const { name: attachment, contentType, path } of attachments) {
    if (contentType !== 'text/markdown' || path === undefined) continue
    // A pointer to the run's report names no test; a description further on may.
    const identity = parseIdentity(await readFile(path, 'utf8'), attempt, attachment)
    if (identity !== null) return { identity, attachments, annotations }
  }
  const whydiff = attachments.some((a) => a.name.startsWith('whydiff/'))
  if (!whydiff && annotations.length === 0) return null
  const context = files.includes(ERROR_CONTEXT)
    ? await readFile(join(dir, ERROR_CONTEXT), 'utf8')
    : ''
  return { attempt, context, attachments, annotations }
}

function attemptOf(dirName: string): Attempt {
  const [, base = dirName, retry = '0', repeat = '0'] = ATTEMPT.exec(dirName) ?? []
  const testId = repeat === '0' ? base : `${base}-repeat${repeat}`
  return { testId, base, retry: Number(retry), repeat: Number(repeat) }
}

/** Who a test is by its error context: the file and titles of its title path, its line, and the project of the run whose name ends the directory's name, the longest that does, else the run's unnamed project; null when the context says no title or no project fits. */
function contextIdentity(test: Unnamed, projects: readonly string[]): TestIdentity | null {
  const [file, ...titles] = NAME_LINE.exec(test.context)?.[1]?.split(' >> ') ?? []
  const line = LOCATION_LINE.exec(test.context)?.[1]
  const [named] = projects
    .filter((p) => p !== '' && test.attempt.base.endsWith(`-${p.replace(UNSAFE, '-')}`))
    .sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
  // A project without a name, the default config's one, adds no suffix to the directory.
  const project = named ?? (projects.includes('') ? '' : undefined)
  if (file === undefined || titles.length === 0 || line === undefined || project === undefined) {
    return null
  }
  const { testId, repeat } = test.attempt
  return { project, testId, titles, file, line: Number(line), repeat }
}

/** Who a screenshot belongs to, read back from the header of the Markdown the matcher attached, after the lines of what changed, first when there are none. */
function parseIdentity(
  markdown: string,
  attempt: Attempt,
  attachment: string
): TestIdentity | null {
  const lines = markdown.split('\n')
  const at = lines.findIndex((line) => TITLE_LINE.test(line))
  const title = unspan(TITLE_LINE.exec(lines[at] ?? '')?.[1])
  const source = SOURCE_LINE.exec(lines[at + 2] ?? '')
  const file = unspan(source?.[1])
  const line = source?.[2]
  const project = source === null ? undefined : (unspan(source[3]) ?? '')
  if (title === undefined || file === undefined || line === undefined || project === undefined) {
    return null
  }
  const name = attachment.slice('whydiff/'.length, -'/markdown'.length)
  const suffix = ` > ${name}`
  return {
    project,
    testId: attempt.testId,
    titles: [title.endsWith(suffix) ? title.slice(0, -suffix.length) : title],
    file,
    line: Number(line),
    repeat: attempt.repeat,
  }
}

/** A title, file or project as the Markdown wrote it, out of the code span it is in when it holds markup. */
function unspan(text: string | undefined): string | undefined {
  const content = text === undefined ? undefined : CODE_SPAN.exec(text)?.[2]
  if (content === undefined) return text
  return content.startsWith(' ') && content.endsWith(' ') && content.trim() !== ''
    ? content.slice(1, -1)
    : content
}

async function readManifest(dir: string): Promise<ManifestLine[]> {
  const text = await readFile(join(dir, MANIFEST), 'utf8')
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, index) => parseLine(line, index + 1, join(dir, MANIFEST)))
}

function parseLine(text: string, number: number, path: string): ManifestLine {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    value = null
  }
  if (!isManifestLine(value)) {
    throw new WhydiffError(
      'invalid-option',
      `${basename(path)} line ${String(number)} is not a whydiff manifest line. Point diff at the directory @whydiff/playwright recorded a run into, set with WHYDIFF_OUT or use.whydiff.outputDir.`
    )
  }
  return value
}

function isManifestLine(value: unknown): value is ManifestLine {
  if (typeof value !== 'object' || value === null) return false
  const line = value as Record<string, unknown> // a plain object, narrowed above; every key is checked below
  return (
    typeof line.project === 'string' &&
    typeof line.testId === 'string' &&
    typeof line.title === 'string' &&
    typeof line.file === 'string' &&
    typeof line.line === 'number' &&
    typeof line.ordinal === 'number' &&
    typeof line.name === 'string' &&
    typeof line.retry === 'number' &&
    (typeof line.screenshot === 'string' || line.screenshot === null) &&
    (typeof line.snapshot === 'string' || line.snapshot === null) &&
    (typeof line.png === 'string' || line.png === null)
  )
}
