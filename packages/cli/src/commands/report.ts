import { readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { FullConfig, TestCase, TestResult } from '@playwright/test/reporter'
import type WhydiffReporter from '@whydiff/playwright/reporter'
import {
  describeRun,
  parseReport,
  renderReport,
  serializeReport,
  WhydiffError,
  type CauseDraft,
  type CauseV1,
  type EffectV1,
  type MemberV1,
  type ReportDraft,
  type ReportV1,
  type ScreenshotV1,
} from '@whydiff/core'

import { flagValue, hasFlag, type FlagSpec, type ParsedArgs } from '../args.js'
import { REPORT_DIR } from '../constants.js'
import type { Context } from '../context.js'
import { readReport, writeReportFiles } from '../io/reportDir.js'
import { listTestResults, type TestRun } from '../io/runs.js'

/** Flags of `report`. */
export const REPORT_FLAGS: FlagSpec = {
  from: true,
  merge: true,
  out: true,
  json: false,
  help: false,
}

interface Built {
  readonly report: ReportV1
  readonly markdown: string
  readonly markdownPath: string
}

const HEADING = /^## (.+) \(\d[\d,]*\)$/
const MISSING_LINE =
  /^- (.*) \| ([^|]*):(\d+) \| ([^|]*) \| \d+x\d+ px, [\d,]+ differing, [\d,]+ regions?$/
const NOT_EXPLAINED_LINE = /^- (.*?) \| ([^|]*):(\d+) \| ([^|]*) \| /

/** Rebuilds the run report from a `test-results` directory, or merges shard reports into one. */
export async function report(args: ParsedArgs, ctx: Context): Promise<number> {
  const from = flagValue(args, 'from')
  const merge = flagValue(args, 'merge')
  if (
    (from === undefined) === (merge === undefined) ||
    (from !== undefined && args.positionals.length > 0)
  ) {
    throw new WhydiffError(
      'invalid-option',
      'report takes --from <test-results dir> or --merge <report.json>...: npx whydiff report --from test-results.'
    )
  }
  const out = resolve(ctx.cwd, flagValue(args, 'out') ?? REPORT_DIR)
  const built =
    from !== undefined
      ? await rebuild(resolve(ctx.cwd, from), out, ctx)
      : await mergeShards(
          [merge ?? '', ...args.positionals].map((path) => resolve(ctx.cwd, path)),
          out,
          ctx
        )
  ctx.ui.info(relative(ctx.cwd, built.markdownPath))
  ctx.out(hasFlag(args, 'json') ? serializeReport(built.report) : built.markdown)
  return 0
}

/** Feeds the attachments Playwright copied into `test-results` through the reporter itself. */
async function rebuild(dir: string, out: string, ctx: Context): Promise<Built> {
  const { runs, skipped } = await listTestResults(dir)
  if (runs.length === 0) {
    throw new WhydiffError(
      'invalid-option',
      `${dir} holds no test with whydiff attachments. Point --from at the test-results directory of a run that used withWhydiff or whydiffCapture.`
    )
  }
  const Reporter = await loadReporter()
  const reporter = new Reporter({ outputDir: out })
  const listed: FullConfig['reporter'] = []
  reporter.onBegin({ rootDir: ctx.cwd, shard: null, reporter: listed } as FullConfig) // the reporter reads rootDir, configFile, shard and reporter only
  for (const run of runs) reporter.onTestEnd(testCase(run, ctx.cwd), testResult(run))
  // The attempts of one test share its id; only how many there are is read.
  const tests = count(new Set(runs.map((run) => run.identity.testId)).size, 'test')
  const done = ctx.ui.start(`rebuilding the report of ${tests}`)
  await withLogsOnStderr(ctx, () => reporter.onEnd())
  done(`${tests} read from ${relative(ctx.cwd, dir) || '.'}`)
  if (skipped > 0) {
    ctx.ui.warn(
      `${count(skipped, 'test')} skipped: test-results hold no whydiff description and no Playwright error context that names ${skipped === 1 ? 'it' : 'them'}`
    )
  }
  const markdownPath = join(out, 'report.md')
  return {
    report: parseReport(await readFile(join(out, 'report.json'), 'utf8')),
    markdown: await readFile(markdownPath, 'utf8'),
    markdownPath,
  }
}

async function loadReporter(): Promise<typeof WhydiffReporter> {
  try {
    return (await import('@whydiff/playwright/reporter')).default
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new WhydiffError(
      'invalid-option',
      `report --from needs @whydiff/playwright installed next to whydiff (${reason}). Run npm i -D @whydiff/playwright.`
    )
  }
}

function testCase(run: TestRun, rootDir: string): TestCase {
  const { identity } = run
  const fake = {
    id: identity.testId,
    titlePath: () => ['', identity.project, identity.file, ...identity.titles],
    location: { file: join(rootDir, identity.file), line: identity.line, column: 1 },
    repeatEachIndex: identity.repeat,
    parent: { project: () => ({ name: identity.project }) },
  }
  return fake as unknown as TestCase // the reporter reads only these fields
}

function testResult(run: TestRun): TestResult {
  const fake = { attachments: run.attachments, steps: [], annotations: run.annotations }
  return fake as unknown as TestResult // the reporter reads only these fields
}

// The reporter announces its files with console.log; on the CLI the result alone belongs on stdout.
async function withLogsOnStderr<T>(ctx: Context, action: () => Promise<T>): Promise<T> {
  const original = console.log
  console.log = (line: unknown): void => {
    ctx.ui.info(typeof line === 'string' ? line : '')
  }
  try {
    return await action()
  } finally {
    console.log = original
  }
}

/** One report from shard reports: a union by the stable ids, ranked again. */
async function mergeShards(paths: readonly string[], out: string, ctx: Context): Promise<Built> {
  const shards = await Promise.all(paths.map(readReport))
  const report = mergeReports(shards)
  const sections =
    (await mergedSection(paths, 'No baseline snapshot', MISSING_LINE)) +
    (await mergedSection(paths, 'Not explained', NOT_EXPLAINED_LINE))
  const failed = sections.split('\n').filter((line) => line.startsWith('- ')).length
  const markdown = renderReport(report, { failed }) + sections
  const files = await writeReportFiles(out, report, markdown, { failed })
  ctx.ui.info(`${count(shards.length, 'shard')} merged`)
  return { report, markdown, markdownPath: files.markdown }
}

/** Deterministic union of shard reports; members follow the order of their screenshots' project, file and title, the fields a screen key sorts by. */
export function mergeReports(shards: readonly ReportV1[]): ReportV1 {
  const [first] = shards
  if (first === undefined)
    throw new WhydiffError('invalid-report', 'merge needs at least one report.')
  for (const shard of shards) {
    if (shard.tool.rules.cluster !== first.tool.rules.cluster) {
      throw new WhydiffError(
        'invalid-report',
        `the shards were written with different cluster rules (${first.tool.rules.cluster} and ${shard.tool.rules.cluster}). Rebuild them with one whydiff version.`
      )
    }
  }
  const screenshotMap = new Map<string, ScreenshotV1>()
  const causeMap = new Map<string, CauseV1[]>()
  const unexplainedMap = new Map<string, ReportV1['unexplained'][number]>()
  for (const shard of shards) {
    for (const s of shard.screenshots) if (!screenshotMap.has(s.id)) screenshotMap.set(s.id, s)
    for (const c of shard.causes) causeMap.set(c.id, [...(causeMap.get(c.id) ?? []), c])
    for (const u of shard.unexplained) if (!unexplainedMap.has(u.id)) unexplainedMap.set(u.id, u)
  }
  const screenshots = [...screenshotMap.values()].sort(compareScreenshots)
  const order = new Map(screenshots.map((s, index) => [s.id, index]))
  const causes = [...causeMap.values()]
    .map((parts) => mergeCause(parts, screenshots, screenshotMap))
    .sort(compareCauses)
  const unexplained = [...unexplainedMap.values()].sort(
    (a, b) => (order.get(a.screenshot) ?? 0) - (order.get(b.screenshot) ?? 0)
  )
  const changed = screenshots.filter((s) => s.status === 'changed')
  const draft: ReportDraft = {
    formatVersion: first.formatVersion,
    tool: first.tool,
    compared: first.compared,
    summary: {
      screenshots: {
        compared: screenshots.length,
        changed: changed.length,
        identical: screenshots.length - changed.length,
      },
      causes: causes.length,
      unexplained: unexplained.length,
      massChange: changed.filter((s) => s.massChange).length,
    },
    screenshots,
    causes,
    unexplained,
  }
  return describeRun(draft)
}

function mergeCause(
  parts: readonly CauseV1[],
  screenshots: readonly ScreenshotV1[],
  byId: ReadonlyMap<string, ScreenshotV1>
): CauseDraft {
  const [first] = parts
  if (first === undefined) throw new Error('a cause without parts')
  const members = parts
    .flatMap((part) => part.members)
    .sort((a, b) => {
      const x = byId.get(a.screenshot)
      const y = byId.get(b.screenshot)
      return (
        compareText(x?.project ?? '', y?.project ?? '') ||
        compareText(x?.file ?? '', y?.file ?? '') ||
        compareText(x?.title ?? '', y?.title ?? '') ||
        compareText(a.screenshot, b.screenshot) ||
        compareText(a.locator, b.locator)
      )
    })
  const screens = new Set(members.map((m) => m.screenshot))
  const files = new Set(
    members
      .map((m) => screenshots.find((s) => s.id === m.screenshot)?.file)
      .filter((f): f is string => f !== undefined)
  )
  const [file] = files
  const example = members.reduce((best, m) => (m.elements > best.elements ? m : best))
  const ambiguous = parts.reduce((sum, part) => sum + part.ambiguous, 0)
  const scope = screens.size > 1 ? 'global' : 'local'
  return {
    id: first.id,
    key: first.key,
    kind: first.kind,
    level: first.level,
    summary: mergeSummary(parts),
    scope,
    ...(scope === 'local' && files.size === 1 && file !== undefined ? { file } : {}),
    match:
      ambiguous > 0 ? 'ambiguous' : parts.every((p) => p.match === 'exact') ? 'exact' : 'likely',
    ambiguous,
    screenshots: screens.size,
    elements: members.reduce((sum, m) => sum + m.elements, 0),
    pixels: parts.reduce((sum, part) => sum + part.pixels, 0),
    effects: effectsOf(members),
    example: exampleOf(example, parts),
    members,
  }
}

/** The first shard's summary; for a rule, each list the union of the shards', its values where every shard agrees, and a longhand mixed when the united lists hold it more than once, as one run decides. */
function mergeSummary(parts: readonly CauseV1[]): CauseV1['summary'] {
  const [first] = parts
  if (first === undefined) throw new Error('a cause without parts')
  if (first.summary.kind !== 'rule') return first.summary
  const rules = parts.flatMap((part) =>
    part.summary.kind === 'rule' ? [{ rule: part.summary, members: part.members.length }] : []
  )
  const union = (key: Longhands): string[] =>
    [...new Set(rules.flatMap(({ rule }) => rule[key]))].sort(compareText)
  const lists = { sets: union('sets'), changed: union('changed'), unsets: union('unsets') }
  const mixed = mixedOf(rules, lists)
  return {
    ...first.summary,
    ...lists,
    ...(first.summary.values === undefined ? {} : { values: valuesOf(rules) }),
    ...(mixed.length === 0 ? {} : { mixed }),
  }
}

type Longhands = 'sets' | 'changed' | 'unsets'
type RuleSummaryV1 = Extract<CauseV1['summary'], { kind: 'rule' }>

/** A rule cause's summary in one shard and how many members its part there has. */
interface RulePart {
  readonly rule: RuleSummaryV1
  readonly members: number
}

/** Each longhand's values where every shard that lists it recorded the same two, sorted by longhand. */
function valuesOf(rules: readonly RulePart[]): NonNullable<RuleSummaryV1['values']> {
  const props = rules.flatMap(({ rule }) => (rule.values ?? []).map((v) => v.prop))
  return [...new Set(props)].sort(compareText).flatMap((prop) => {
    const seen = rules.map(({ rule }) => ({
      rule,
      value: rule.values?.find((v) => v.prop === prop),
    }))
    const agreed = seen.find((s) => s.value !== undefined)?.value
    if (agreed === undefined) return []
    const agree = seen.every(({ rule, value }) =>
      value === undefined
        ? ![...rule.sets, ...rule.changed, ...rule.unsets].includes(prop)
        : value.from === agreed.from && value.to === agreed.to
    )
    return agree ? [agreed] : []
  })
}

/** The longhands the united lists hold more than once, with how many members put each in each list; a shard that lists one in a single list counts every member of its part there. */
function mixedOf(
  rules: readonly RulePart[],
  lists: Readonly<Record<Longhands, readonly string[]>>
): NonNullable<RuleSummaryV1['mixed']> {
  const count = (prop: string, key: Longhands): number =>
    rules.reduce((sum, { rule, members }) => {
      const own = rule.mixed?.find((m) => m.prop === prop)
      return sum + (own !== undefined ? own[key] : rule[key].includes(prop) ? members : 0)
    }, 0)
  const all = [lists.sets, lists.changed, lists.unsets]
  return [...new Set(all.flat())]
    .sort(compareText)
    .filter((prop) => all.filter((list) => list.includes(prop)).length > 1)
    .map((prop) => ({
      prop,
      sets: count(prop, 'sets'),
      changed: count(prop, 'changed'),
      unsets: count(prop, 'unsets'),
    }))
}

/** The member with the most elements, first in member order on a tie, with the src hint a shard recorded for it. */
function exampleOf(example: MemberV1, parts: readonly CauseV1[]): CauseV1['example'] {
  const src = parts.find(
    (p) => p.example.screenshot === example.screenshot && p.example.locator === example.locator
  )?.example.src
  return {
    screenshot: example.screenshot,
    locator: example.locator,
    ...(src === undefined ? {} : { src }),
  }
}

/** Totals per effect kind over the members; the vector is the one most members' nodes share, with how many moved by it as the members count them when not all did. */
function effectsOf(members: readonly MemberV1[]): EffectV1[] {
  const kinds: EffectV1['kind'][] = ['shifted', 'resized', 'reflowed', 'painted', 'inherited']
  const out: EffectV1[] = []
  for (const kind of kinds) {
    const matching = members.flatMap((m) => m.effects.filter((e) => e.kind === kind))
    const nodes = matching.reduce((sum, e) => sum + e.nodes, 0)
    if (nodes === 0) continue
    const vectors = new Map<string, { vector: EffectV1['vector']; count: number }>()
    for (const effect of matching) {
      if (effect.vector === undefined) continue
      const key = `${String(effect.vector[0])},${String(effect.vector[1])}`
      const entry = vectors.get(key)
      const moved = effect.vectorNodes ?? effect.nodes
      if (entry === undefined) vectors.set(key, { vector: effect.vector, count: moved })
      else entry.count += moved
    }
    const top = [...vectors.entries()].sort(
      (a, b) => b[1].count - a[1].count || compareText(a[0], b[0])
    )[0]
    const vector = top?.[1].vector
    if (top === undefined || vector === undefined) out.push({ kind, nodes })
    else if (top[1].count === nodes) out.push({ kind, nodes, vector })
    else out.push({ kind, nodes, vector, vectorNodes: top[1].count })
  }
  return out
}

function compareScreenshots(a: ScreenshotV1, b: ScreenshotV1): number {
  return (
    compareText(a.project ?? '', b.project ?? '') ||
    compareText(a.file ?? '', b.file ?? '') ||
    (a.line ?? 0) - (b.line ?? 0) ||
    compareText(a.title, b.title) ||
    compareText(a.id, b.id)
  )
}

function compareCauses(a: CauseDraft, b: CauseDraft): number {
  return (
    Number(a.summary.kind === 'resized') - Number(b.summary.kind === 'resized') ||
    b.pixels - a.pixels ||
    b.screenshots - a.screenshots ||
    b.members.length - a.members.length ||
    compareText(a.key, b.key)
  )
}

/** One section the reporter appended to each shard's Markdown, as one section: the sentence once, every bullet in the reporter's order of project, file, line and title. */
async function mergedSection(
  paths: readonly string[],
  title: string,
  bullet: RegExp
): Promise<string> {
  let sentence: string | null = null
  const bullets = new Set<string>()
  for (const path of paths) {
    const text = await readFile(path.replace(/\.json$/, '.md'), 'utf8').catch(() => '')
    const lines = text.split('\n')
    const at = lines.findIndex((line) => HEADING.exec(line)?.[1] === title)
    if (at < 0) continue
    sentence ??= lines[at + 1] ?? ''
    for (const line of lines.slice(at + 2)) {
      if (!line.startsWith('- ')) break
      bullets.add(line)
    }
  }
  if (sentence === null || bullets.size === 0) return ''
  const sorted = [...bullets].sort((a, b) => {
    const x = bullet.exec(a)
    const y = bullet.exec(b)
    if (x === null || y === null)
      return Number(x === null) - Number(y === null) || compareText(a, b)
    return (
      compareText(x[4] ?? '', y[4] ?? '') ||
      compareText(x[2] ?? '', y[2] ?? '') ||
      Number(x[3]) - Number(y[3]) ||
      compareText(x[1] ?? '', y[1] ?? '') ||
      compareText(a, b)
    )
  })
  return `\n## ${title} (${String(sorted.length)})\n${sentence}\n${sorted.join('\n')}\n`
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function count(value: number, word: string): string {
  return `${String(value)} ${word}${value === 1 ? '' : 's'}`
}
