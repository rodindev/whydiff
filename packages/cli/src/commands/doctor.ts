import { access, constants, readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

import { hasFlag, type FlagSpec, type ParsedArgs } from '../args.js'
import { EXIT_ERROR, MIN_NODE, MIN_PLAYWRIGHT, REPORT_DIR } from '../constants.js'
import type { Context } from '../context.js'
import { headlessShellPath } from '../io/browser.js'
import { screenshotSpecs } from '../io/specs.js'
import { walkFiles } from '../io/walk.js'
import { VERSION } from '../version.js'

/** Flags of `doctor`. */
export const DOCTOR_FLAGS: FlagSpec = { json: false, help: false }

/** One line of `doctor`: what was checked and, unless ok, what to do. */
export interface Check {
  readonly status: 'ok' | 'warn' | 'fail'
  readonly check: string
  readonly fix?: string
}

/** Config file names Playwright looks for, in its order. */
const CONFIG_NAMES: readonly string[] = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map(
  (ext) => `playwright.config.${ext}`
)

/** Where the tests and their baselines live, as the config names them; the config directory when it does not. */
interface ProjectDirs {
  readonly testDir: string
  readonly snapshotDir: string | null
}

/** How the project calls whydiff: `withWhydiff` around `test` and `expect`, `whydiffCapture` in its tests, or neither yet. */
type EntryPoint =
  | { readonly kind: 'matcher'; readonly file: string }
  | { readonly kind: 'explicit' }
  | { readonly kind: 'none' }

const SOURCE = /\.(?:[cm]?[jt]s|tsx|jsx)$/
const SNAPSHOT_DIR = /(?:-snapshots|__screenshots__)$/
const TEST_DIR_OPTION = /testDir:\s*(['"])([^'"]+)\1/
const SNAPSHOT_DIR_OPTION = /snapshotDir:\s*(['"])([^'"]+)\1/
const SIDECAR = '.whydiff.json'
const WHYDIFF_REPORTER = '@whydiff/playwright/reporter'
const HTML_REPORTER = /reporter:[\s\S]*?(['"`])html\1/
const PNG = /\.png$/i

/** Prints the versions it runs on, then checks the project for everything whydiff needs, one line per check; exit 2 on a failed one. */
export async function doctor(args: ParsedArgs, ctx: Context): Promise<number> {
  const config = await findConfig(ctx.cwd)
  const configText = config === null ? '' : await readFile(config, 'utf8')
  const dirs = projectDirs(ctx.cwd, configText)
  const entry = await findEntryPoint(ctx.cwd, dirs.testDir)
  const refused = await refusedPlaywright(ctx.cwd)
  const checks = [
    ...versionsChecks(process.versions.node),
    ...(await playwrightChecks(ctx.cwd, entry)),
    await chromiumCheck(ctx.cwd, ctx.env),
    ...configChecks(ctx.cwd, config, configText, entry, refused !== null),
    ...(await importChecks(ctx.cwd, dirs.testDir, entry)),
    await reportDirCheck(ctx.cwd),
    await sidecarCheck(dirs),
  ]
  ctx.out(
    hasFlag(args, 'json')
      ? `${JSON.stringify(checks, null, 2)}\n`
      : checks
          .map((c) => `${c.status.padEnd(4)} ${c.check}${c.fix === undefined ? '' : ` | ${c.fix}`}`)
          .join('\n') + '\n'
  )
  return checks.some((c) => c.status === 'fail') ? EXIT_ERROR : 0
}

/** The config file of the project, or null. */
export async function findConfig(cwd: string): Promise<string | null> {
  for (const name of CONFIG_NAMES) {
    const path = join(cwd, name)
    if (await exists(path)) return path
  }
  return null
}

function projectDirs(cwd: string, configText: string): ProjectDirs {
  const testDir = TEST_DIR_OPTION.exec(configText)?.[2]
  const snapshotDir = SNAPSHOT_DIR_OPTION.exec(configText)?.[2]
  return {
    testDir: testDir === undefined ? cwd : resolve(cwd, testDir),
    snapshotDir: snapshotDir === undefined ? null : resolve(cwd, snapshotDir),
  }
}

/** The matcher wins when a file calls it; the explicit call counts only in the tests. */
async function findEntryPoint(cwd: string, testDir: string): Promise<EntryPoint> {
  const wrapped = await findWithWhydiff(cwd)
  if (wrapped !== null) return { kind: 'matcher', file: wrapped }
  const explicit = await findCall(testDir, 'whydiffCapture(')
  return explicit === null ? { kind: 'none' } : { kind: 'explicit' }
}

/** The versions line, then a warning when Node is older than the floor of `engines`; exported for its tests. */
export function versionsChecks(node: string): Check[] {
  const versions: Check = {
    status: 'ok',
    check: `whydiff ${VERSION} on Node ${node}, ${process.platform}-${process.arch}`,
  }
  if (compareVersions(node, MIN_NODE) >= 0) return [versions]
  return [
    versions,
    {
      status: 'warn',
      check: `Node ${node} is older than ${MIN_NODE}`,
      fix: `use Node ${MIN_NODE} or later`,
    },
  ]
}

async function playwrightChecks(cwd: string, entry: EntryPoint): Promise<Check[]> {
  const version = packageVersion('@playwright/test', cwd)
  if (version === null) {
    return [
      { status: 'fail', check: '@playwright/test not installed', fix: 'npm i -D @playwright/test' },
    ]
  }
  if (compareVersions(version, MIN_PLAYWRIGHT) < 0) {
    return [
      {
        status: 'fail',
        check: `@playwright/test ${version} is older than ${MIN_PLAYWRIGHT}`,
        fix: `npm i -D @playwright/test@latest`,
      },
    ]
  }
  const excluded = await excludedPlaywright()
  if (excluded === null) {
    return [
      { status: 'ok', check: `@playwright/test ${version}` },
      {
        status: 'warn',
        check: '@whydiff/playwright not installed',
        fix: 'npm i -D @whydiff/playwright',
      },
    ]
  }
  if (entry.kind === 'explicit') {
    return [{ status: 'ok', check: `explicit call on @playwright/test ${version}` }]
  }
  if (excluded.includes(version)) {
    if (entry.kind === 'none') return [captureInstead(version)]
    return [
      {
        status: 'fail',
        check: `@playwright/test ${version} lets an override of toHaveScreenshot recurse and breaks every screenshot assertion`,
        fix: 'use 1.59 or earlier, or 1.61.1 or later',
      },
    ]
  }
  return [{ status: 'ok', check: `@playwright/test ${version} with @whydiff/playwright` }]
}

/** The installed `@playwright/test` release when `withWhydiff` cannot run on it, else null. */
export async function refusedPlaywright(cwd: string): Promise<string | null> {
  const version = packageVersion('@playwright/test', cwd)
  if (version === null) return null
  return (await excludedPlaywright())?.includes(version) === true ? version : null
}

/** What `doctor` and `init` say on a release `withWhydiff` cannot run on: call `whydiffCapture` instead. */
export function captureInstead(version: string): Check {
  return {
    status: 'warn',
    check: `withWhydiff cannot run on @playwright/test ${version}`,
    fix: 'call whydiffCapture right after each toHaveScreenshot instead, as the @whydiff/playwright README shows under Two ways in',
  }
}

async function excludedPlaywright(): Promise<readonly string[] | null> {
  try {
    return (await import('@whydiff/playwright')).EXCLUDED_PLAYWRIGHT
  } catch {
    return null
  }
}

async function chromiumCheck(
  cwd: string,
  env: Readonly<Record<string, string | undefined>>
): Promise<Check> {
  const override = env.WHYDIFF_CHROMIUM
  if (override !== undefined) {
    return (await exists(override))
      ? { status: 'ok', check: `chromium at ${override} (WHYDIFF_CHROMIUM)` }
      : {
          status: 'fail',
          check: `WHYDIFF_CHROMIUM points at ${override}, which does not exist`,
          fix: 'point WHYDIFF_CHROMIUM at a Chromium binary, or unset it',
        }
  }
  // npx finds only the bins linked into node_modules/.bin, and pnpm links those of direct dependencies alone.
  const cli = packageVersion('@playwright/test', cwd) === null ? 'playwright-core' : 'playwright'
  const fix = `npx ${cli} install chromium-headless-shell, or set WHYDIFF_CHROMIUM to a Chromium binary`
  let path: string | null
  try {
    path = headlessShellPath(cwd)
  } catch (error) {
    return { status: 'fail', check: error instanceof Error ? error.message : String(error), fix }
  }
  if (path === null) {
    return {
      status: 'warn',
      check: 'cannot tell which chromium this playwright-core launches headless',
      fix: 'update whydiff, or set WHYDIFF_CHROMIUM to a Chromium binary',
    }
  }
  return (await exists(path))
    ? { status: 'ok', check: `chromium-headless-shell at ${path}` }
    : { status: 'fail', check: `chromium-headless-shell not installed at ${path}`, fix }
}

function configChecks(
  cwd: string,
  config: string | null,
  configText: string,
  entry: EntryPoint,
  refused: boolean
): Check[] {
  if (config === null) {
    return [
      {
        status: 'fail',
        check: 'no playwright.config.* in this directory',
        fix: 'run npx whydiff doctor where the Playwright config is',
      },
    ]
  }
  const name = basename(config)
  const at = configText.indexOf(WHYDIFF_REPORTER)
  const html = HTML_REPORTER.exec(configText)
  const reporter: Check =
    at < 0
      ? {
          status: 'warn',
          check: `${name} has no ${WHYDIFF_REPORTER} entry`,
          fix: 'run npx whydiff init',
        }
      : html !== null && html.index + html[0].length < at
        ? {
            status: 'warn',
            check: `${name} lists the whydiff reporter after html, too late for the HTML report to show the run's explanations`,
            fix: `move ['${WHYDIFF_REPORTER}'] before ['html'] in reporter`,
          }
        : { status: 'ok', check: `${name} runs the whydiff reporter` }
  if (entry.kind === 'explicit') return [reporter]
  if (entry.kind === 'matcher') {
    return [reporter, { status: 'ok', check: `${relative(cwd, entry.file)} calls withWhydiff` }]
  }
  // The Playwright line already says to call whydiffCapture, the one way in on that release.
  if (refused) return [reporter]
  return [
    reporter,
    {
      status: 'warn',
      check: 'no file calls withWhydiff or whydiffCapture',
      fix: 'run npx whydiff init',
    },
  ]
}

/** Warns when specs that call `toHaveScreenshot` take `test` or `expect` from Playwright, past the `withWhydiff` file. */
async function importChecks(cwd: string, testDir: string, entry: EntryPoint): Promise<Check[]> {
  if (entry.kind !== 'matcher') return []
  const specs = await screenshotSpecs(testDir, entry.file)
  const plain = specs.filter((spec) => spec.plain)
  const [first] = plain
  if (first === undefined) return []
  return [
    {
      status: 'warn',
      check: `${String(plain.length)} of ${String(specs.length)} specs that call toHaveScreenshot take test or expect from @playwright/test, not ${relative(cwd, entry.file)}, so withWhydiff never sees their screenshots; first ${relative(cwd, first.path)}`,
      fix: 'run npx whydiff init, or change the import',
    },
  ]
}

/** The first source file under the project that calls `withWhydiff`, or null. */
export async function findWithWhydiff(cwd: string): Promise<string | null> {
  return findCall(cwd, 'withWhydiff(')
}

async function findCall(dir: string, call: string): Promise<string | null> {
  for (const file of (await filesUnder(dir)).filter((f) => SOURCE.test(f))) {
    if ((await readFile(file, 'utf8')).includes(call)) return file
  }
  return null
}

async function reportDirCheck(cwd: string): Promise<Check> {
  const dir = join(cwd, REPORT_DIR)
  const target = (await exists(dir)) ? dir : dirname(dir)
  try {
    await access(target, constants.W_OK)
    return { status: 'ok', check: `${REPORT_DIR} is writable` }
  } catch {
    return {
      status: 'fail',
      check: `${REPORT_DIR} is not writable`,
      fix: `fix the permissions of ${target}`,
    }
  }
}

/** Counts baseline PNGs under the test and snapshot directories and how many have a sidecar snapshot. */
async function sidecarCheck(dirs: ProjectDirs): Promise<Check> {
  const roots = dirs.snapshotDir === null ? [dirs.testDir] : [dirs.testDir, dirs.snapshotDir]
  const files = new Set<string>()
  for (const root of roots) for (const file of await filesUnder(root)) files.add(file)
  const sidecarDirs = new Set([...files].filter((f) => f.endsWith(SIDECAR)).map((f) => dirname(f)))
  const baselines = [...files].filter(
    (f) => PNG.test(f) && (underSnapshotDir(f) || sidecarDirs.has(dirname(f)))
  )
  const missing = baselines.filter((f) => !files.has(f.replace(PNG, SIDECAR)))
  const fix =
    'run the suite once with --update-snapshots, or let the tests pass once with backfill on'
  if (baselines.length === 0) return { status: 'warn', check: 'no baseline PNGs found', fix }
  if (missing.length > 0) {
    return {
      status: 'warn',
      check: `${String(missing.length)} of ${String(baselines.length)} baseline PNGs have no .whydiff.json next to them`,
      fix,
    }
  }
  return {
    status: 'ok',
    check: `${String(baselines.length)} of ${String(baselines.length)} baseline PNGs have a .whydiff.json next to them`,
  }
}

/** True when a directory on the way to the file is named `__screenshots__` or ends in `-snapshots`. */
function underSnapshotDir(file: string): boolean {
  return dirname(file)
    .split(sep)
    .some((segment) => SNAPSHOT_DIR.test(segment))
}

async function filesUnder(dir: string): Promise<string[]> {
  return (await exists(dir)) ? walkFiles(dir) : []
}

function packageVersion(name: string, cwd: string): string | null {
  const require = createRequire(join(cwd, 'package.json'))
  try {
    const manifest: unknown = require(`${name}/package.json`)
    if (typeof manifest === 'object' && manifest !== null && 'version' in manifest) {
      const { version } = manifest
      return typeof version === 'string' ? version : null
    }
    return null
  } catch {
    return null
  }
}

/** Numeric comparison of `major.minor.patch` versions; pre-release tags are ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] => v.split('-')[0]?.split('.').map(Number) ?? []
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) {
    const delta = (x[i] ?? 0) - (y[i] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false
  )
}
