import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { WhydiffError } from '@whydiff/core'

import { hasFlag, type FlagSpec, type ParsedArgs } from '../args.js'
import type { Context } from '../context.js'
import { screenshotSpecs } from '../io/specs.js'
import { walkFiles } from '../io/walk.js'
import { captureInstead, findConfig, findWithWhydiff, refusedPlaywright } from './doctor.js'

/** Flags of `init`. */
export const INIT_FLAGS: FlagSpec = { yes: false, help: false }

/** One file `init` would write: its current text (null when new) and the text after the edit. */
export interface Edit {
  readonly path: string
  readonly before: string | null
  readonly after: string
  readonly why: string
}

const REPORTER_NAME = '@whydiff/playwright/reporter'
const REPORTER = `['${REPORTER_NAME}']`
const HTML = /^\[\s*(['"`])html\1/
const IMPORT = "import { withWhydiff } from '@whydiff/playwright'"
const FIXTURES_FILE = /(?:^|[/\\])(?:[\w.-]*fixtures?)\.[cm]?[jt]s$/
const TEST_DIR = /testDir:\s*(['"])([^'"]+)\1/
const EXPORT_TEST = /^export const test\b/m
const EXPORT_EXPECT_FROM = /^export \{ expect \} from ['"]@playwright\/test['"];?\n/m
const EXPORT_EXPECT_LOCAL = /^export \{ expect \}\n/m
const EXPORT_EXPECT_CONST = /^export const expect\b/m
const IMPORT_STATEMENT = /^import\b[^;'"]*?['"][^'"]+['"];?[ \t]*\n/gm
const GITATTRIBUTES_LINE = '*.whydiff.json -diff linguist-generated=true'
const CONTEXT_LINES = 2

/** Specs pointed at the fixtures file, and those whose import of `test` or `expect` init leaves alone. */
interface ImportEdits {
  readonly edits: Edit[]
  readonly skipped: string
}

/** Proposes the fixtures, spec import and reporter edits as a diff; applies them on a yes, or with `--yes`. */
export async function init(args: ParsedArgs, ctx: Context): Promise<number> {
  const config = await findConfig(ctx.cwd)
  if (config === null) {
    throw new WhydiffError(
      'invalid-option',
      'no playwright.config.* in this directory. Run npx whydiff init where the Playwright config is, or npm init playwright@latest first.'
    )
  }
  const configText = await readFile(config, 'utf8')
  const refused = await refusedPlaywright(ctx.cwd)
  if (refused !== null) {
    const { check, fix = '' } = captureInstead(refused)
    ctx.ui.warn(`${check}; ${fix}`)
  }
  const fixtures = refused === null ? await fixturesEdit(ctx, config, configText) : null
  const imports: ImportEdits =
    refused === null ? await importEdits(ctx.cwd, configText, fixtures) : { edits: [], skipped: '' }
  const one = (edit: Edit | null): Edit[] => (edit === null ? [] : [edit])
  const groups = [
    one(fixtures),
    one(reporterEdit(ctx.cwd, config, configText)),
    imports.edits,
    one(await gitattributesEdit(ctx.cwd)),
  ].filter((group) => group.length > 0)
  if (groups.length === 0) {
    const done = refused === null ? 'uses withWhydiff and the reporter' : 'runs the reporter'
    ctx.ui.info(`nothing to do: the project already ${done}${imports.skipped}`)
    return 0
  }
  if (!ctx.ui.interactive) {
    const edits = groups.flat()
    ctx.out(edits.map(renderDiff).join('\n'))
    if (!hasFlag(args, 'yes')) {
      ctx.ui.info(
        `nothing applied; run npx whydiff init --yes to apply the edits above${imports.skipped}`
      )
      return 0
    }
    for (const edit of edits) await apply(ctx.cwd, edit)
    ctx.ui.info(`applied ${String(edits.length)} edits${imports.skipped}`)
    return 0
  }
  const applied: Edit[] = []
  for (const group of groups) {
    const [first] = group
    if (first === undefined) continue
    // The specs would import a fixtures file that was never written.
    if (group === imports.edits && fixtures !== null && !applied.includes(fixtures)) continue
    for (const edit of group) ctx.ui.note(edit.path, renderDiff(edit))
    const which =
      group.length === 1 ? `this edit to ${first.path}` : `these ${String(group.length)} edits`
    if (!(await ctx.ui.confirm(`${first.why}: apply ${which}?`))) continue
    for (const edit of group) {
      await apply(ctx.cwd, edit)
      applied.push(edit)
    }
  }
  const result =
    applied.length === 0 ? 'nothing applied' : `applied ${String(applied.length)} edits`
  ctx.ui.info(`${result}${imports.skipped}`)
  return 0
}

/** Creates `<testDir>/fixtures.<ext>`, or wraps an existing fixtures file that exports `test` and `expect`. */
async function fixturesEdit(
  ctx: Context,
  config: string,
  configText: string
): Promise<Edit | null> {
  if ((await findWithWhydiff(ctx.cwd)) !== null) return null
  const existing = await findFixturesFile(ctx)
  if (existing === null) {
    const ext = /\.[cm]?ts$/.test(config) ? 'ts' : 'js'
    const path = join(testDirOf(configText), `fixtures.${ext}`)
    return {
      path,
      before: null,
      after: [
        "import { expect as baseExpect, test as base } from '@playwright/test'",
        IMPORT,
        '',
        'export const { test, expect } = withWhydiff(base, baseExpect)',
        '',
      ].join('\n'),
      why: `tests import test and expect from ${path}`,
    }
  }
  const text = await readFile(join(ctx.cwd, existing), 'utf8')
  const wrapped = wrapFixtures(text)
  if (wrapped === null) {
    ctx.ui.warn(
      `${existing} exports test in a form init cannot rewrite; apply withWhydiff by hand, last: export const { test, expect } = withWhydiff(test, expect)`
    )
    return null
  }
  return { path: existing, before: text, after: wrapped, why: 'withWhydiff wraps test and expect' }
}

/** Points the specs under testDir that call `toHaveScreenshot` at the fixtures file when they take `test` or `expect` from `@playwright/test`. */
async function importEdits(
  cwd: string,
  configText: string,
  fixtures: Edit | null
): Promise<ImportEdits> {
  const wrapped = fixtures === null ? await findWithWhydiff(cwd) : join(cwd, fixtures.path)
  if (wrapped === null) return { edits: [], skipped: '' }
  const target = relative(cwd, wrapped)
  const testDir = resolve(cwd, testDirOf(configText))
  const specs = (await screenshotSpecs(testDir, wrapped)).filter((spec) => spec.plain)
  const edits = specs.flatMap((spec) =>
    spec.rewritten === null
      ? []
      : [
          {
            path: relative(cwd, spec.path),
            before: spec.text,
            after: spec.rewritten,
            why: `the specs that call toHaveScreenshot take test and expect from ${target}`,
          },
        ]
  )
  const skipped = specs.filter((spec) => spec.rewritten === null).map((s) => relative(cwd, s.path))
  return {
    edits,
    skipped:
      skipped.length === 0
        ? ''
        : `; take test and expect from ${target} by hand in ${skipped.join(', ')}, whose import init cannot rewrite`,
  }
}

/** The config's `testDir`, else the config's own directory, which is Playwright's default. */
function testDirOf(configText: string): string {
  return TEST_DIR.exec(configText)?.[2] ?? '.'
}

/** The one fixtures file of the project; on a terminal the user picks when several exist. */
async function findFixturesFile(ctx: Context): Promise<string | null> {
  const candidates = (await walkFiles(ctx.cwd))
    .filter((file) => FIXTURES_FILE.test(file))
    .map((file) => relative(ctx.cwd, file))
  const [first] = candidates
  if (first === undefined || candidates.length === 1) return first ?? null
  if (!ctx.ui.interactive) return first
  return ctx.ui.choose(
    'Which fixtures file do the tests import test and expect from?',
    candidates.map((value) => ({ value, label: value }))
  )
}

/** Rewrites `export const test = ...` plus an exported `expect` into one `withWhydiff` export. */
export function wrapFixtures(text: string): string | null {
  if (text.includes('withWhydiff')) return null
  if (!EXPORT_TEST.test(text)) return null
  let out = text.replace(EXPORT_TEST, 'const extendedTest')
  let expect: string
  if (EXPORT_EXPECT_FROM.test(out)) {
    out = out.replace(EXPORT_EXPECT_FROM, '')
    out = afterImports(out, "import { expect as baseExpect } from '@playwright/test'")
    expect = 'baseExpect'
  } else if (EXPORT_EXPECT_CONST.test(out)) {
    out = out.replace(EXPORT_EXPECT_CONST, 'const extendedExpect')
    expect = 'extendedExpect'
  } else if (EXPORT_EXPECT_LOCAL.test(out)) {
    out = out.replace(EXPORT_EXPECT_LOCAL, '')
    expect = 'expect'
  } else {
    return null
  }
  out = afterImports(out, IMPORT)
  return `${out.trimEnd()}\n\nexport const { test, expect } = withWhydiff(extendedTest, ${expect})\n`
}

/** The text with `line` inserted after its last import statement, or first when there is none. */
function afterImports(text: string, line: string): string {
  let end = 0
  for (const match of text.matchAll(IMPORT_STATEMENT)) end = match.index + match[0].length
  return `${text.slice(0, end)}${line}\n${text.slice(end)}`
}

/** Adds the reporter to the config's `reporter` entry, or adds the entry after `defineConfig({`. */
function reporterEdit(cwd: string, config: string, text: string): Edit | null {
  const listed = text.includes(REPORTER_NAME)
  const after = listed ? moveReporter(text) : addReporter(text)
  if (after === null) return null
  return {
    path: relative(cwd, config),
    before: text,
    after,
    why: listed
      ? "the whydiff reporter runs before html, so the HTML report shows the run's explanations"
      : 'the reporter writes whydiff-report',
  }
}

/** The config text with the whydiff reporter added, before `html` so the HTML report gets the run's explanations, else last; exported for its tests. */
export function addReporter(text: string): string | null {
  const key = /reporter:\s*/.exec(text)
  if (key === null) {
    const open = /defineConfig(?:<[^\n]*>)?\(\{[^\n]*\n/.exec(text)
    if (open === null) return null
    const at = open.index + open[0].length
    return `${text.slice(0, at)}  reporter: [['list'], ${REPORTER}],\n${text.slice(at)}`
  }
  const start = key.index + key[0].length
  const first = text[start]
  if (first === "'" || first === '"' || first === '`') {
    const end = text.indexOf(first, start + 1)
    if (end < 0) return null
    const name = `[${text.slice(start, end + 1)}]`
    const list = HTML.test(name) ? `[${REPORTER}, ${name}]` : `[${name}, ${REPORTER}]`
    return `${text.slice(0, start)}${list}${text.slice(end + 1)}`
  }
  if (first !== '[') return null
  const end = closingBracket(text, start)
  if (end < 0) return null
  const inner = text.slice(start + 1, end).trim()
  if (inner === '') return `${text.slice(0, start)}[${REPORTER}]${text.slice(end + 1)}`
  if (!inner.startsWith('[')) {
    const tuple = text.slice(start, end + 1)
    const list = HTML.test(tuple) ? `[${REPORTER}, ${tuple}]` : `[${tuple}, ${REPORTER}]`
    return `${text.slice(0, start)}${list}${text.slice(end + 1)}`
  }
  const html = entriesOf(text, start, end).find((e) => HTML.test(text.slice(e.start, e.end + 1)))
  if (html !== undefined)
    return `${text.slice(0, html.start)}${REPORTER}, ${text.slice(html.start)}`
  return `${text.slice(0, end)}, ${REPORTER}]${text.slice(end + 1)}`
}

/** The config text with a whydiff reporter listed after `html` moved before it, the entries kept apart as they were; null when it is not after html; exported for its tests. */
export function moveReporter(text: string): string | null {
  const key = /reporter:\s*\[/.exec(text)
  if (key === null) return null
  const start = key.index + key[0].length - 1
  const entries = entriesOf(text, start, closingBracket(text, start))
  const of = (e: Entry): string => text.slice(e.start, e.end + 1)
  const html = entries.findIndex((e) => HTML.test(of(e)))
  const own = entries.findIndex((e) => of(e).includes(REPORTER_NAME))
  const [first, previous, entry] = [entries[html], entries[own - 1], entries[own]]
  if (own <= html || first === undefined || previous === undefined || entry === undefined) {
    return null
  }
  const between = text.slice(previous.end + 1, entry.start)
  const removed = `${text.slice(0, previous.end + 1)}${text.slice(entry.end + 1)}`
  return `${removed.slice(0, first.start)}${of(entry)}${between}${removed.slice(first.start)}`
}

interface Entry {
  readonly start: number
  readonly end: number
}

/** The bracketed entries of the list between `open` and `close`, each from its `[` to its `]`; none when the list is unbalanced. */
function entriesOf(text: string, open: number, close: number): Entry[] {
  const entries: Entry[] = []
  for (let i = open + 1; i < close; i++) {
    if (text[i] !== '[') continue
    const end = closingBracket(text, i)
    if (end < 0) return []
    entries.push({ start: i, end })
    i = end
  }
  return entries
}

/** Index of the `]` matching the `[` at `open`, skipping quoted strings; -1 when unbalanced. */
function closingBracket(text: string, open: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < text.length; i++) {
    const ch = text[i] ?? ''
    if (quote !== null) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '[') depth++
    else if (ch === ']' && --depth === 0) return i
  }
  return -1
}

async function gitattributesEdit(cwd: string): Promise<Edit | null> {
  const before = await readFile(join(cwd, '.gitattributes'), 'utf8').catch(() => null)
  if (before?.includes('*.whydiff.json') === true) return null
  const head =
    before === null || before === '' || before.endsWith('\n') ? (before ?? '') : `${before}\n`
  return {
    path: '.gitattributes',
    before,
    after: `${head}${GITATTRIBUTES_LINE}\n`,
    why: 'snapshots next to baselines stay out of diffs',
  }
}

async function apply(cwd: string, edit: Edit): Promise<void> {
  const path = join(cwd, edit.path)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, edit.after)
}

/** A unified-style diff of one edit: the changed lines with two lines of context. */
export function renderDiff(edit: Edit): string {
  const before = edit.before === null ? [] : edit.before.split('\n')
  const after = edit.after.split('\n')
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++
  const from = Math.max(0, head - CONTEXT_LINES)
  const lines = [
    `--- ${edit.before === null ? '/dev/null' : edit.path}`,
    `+++ ${edit.path}`,
    ...before.slice(from, head).map((line) => ` ${line}`),
    ...before.slice(head, before.length - tail).map((line) => `-${line}`),
    ...after.slice(head, after.length - tail).map((line) => `+${line}`),
    ...after
      .slice(after.length - tail, after.length - tail + CONTEXT_LINES)
      .map((line) => ` ${line}`),
  ]
  return `${lines.join('\n')}\n`
}
