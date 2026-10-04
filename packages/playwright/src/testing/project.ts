import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { BrowserType } from '@playwright/test'

const execute = promisify(execFile)
const require = createRequire(import.meta.url)

/** The fixture project, or the copy of it the matrix runner installed a release into. */
export const project: string =
  process.env.WHYDIFF_MATRIX_PROJECT ?? new URL('../../fixtures/project/', import.meta.url).pathname
const cli = require.resolve('@playwright/test/cli', { paths: [project] })
const entry = require.resolve('@playwright/test', { paths: [project] })

interface Attachment {
  readonly name: string
  readonly contentType: string
  readonly path?: string
  /** Base64, as the JSON reporter writes a body attachment. */
  readonly body?: string
}

export interface Result {
  readonly status: string
  readonly duration: number
  readonly parallelIndex: number
  readonly attachments: readonly Attachment[]
  readonly errors: readonly { readonly message?: string; readonly location?: { file: string } }[]
  readonly stderr: readonly { readonly text?: string }[]
}

export interface Test {
  readonly projectName: string
  readonly annotations: readonly { readonly type: string; readonly description?: string }[]
  readonly results: readonly Result[]
}

export interface ReleaseBrowsers {
  readonly chromium: BrowserType
  readonly webkit: BrowserType
}

interface BrowserBuilds {
  readonly browsers: readonly { readonly name: string; readonly browserVersion?: string }[]
}

interface Suite {
  readonly specs: readonly { readonly title: string; readonly tests: readonly Test[] }[]
  readonly suites?: readonly Suite[]
}

/** Every test of a JSON report by spec title; the titles of the fixture project are unique. */
export async function readTests(path: string): Promise<Map<string, Test>> {
  const report = JSON.parse(await readFile(path, 'utf8')) as { suites: Suite[] } // the JSON reporter's shape
  const tests = new Map<string, Test>()
  const visit = (suite: Suite): void => {
    for (const spec of suite.specs) for (const test of spec.tests) tests.set(spec.title, test)
    for (const child of suite.suites ?? []) visit(child)
  }
  report.suites.forEach(visit)
  return tests
}

/** Runs the Playwright CLI in the fixture project, never into the job summary of a CI step that runs the specs; failing tests are expected, the reports say which. */
export async function playwright(args: string[], env: Record<string, string>): Promise<string> {
  try {
    const { stdout } = await execute(process.execPath, [cli, ...args], {
      cwd: project,
      env: { ...process.env, CI: '1', GITHUB_STEP_SUMMARY: '', ...env },
    })
    return stdout
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'stdout' in error)
      return String(error.stdout)
    throw error
  }
}

/** The browsers of the release the fixture project runs, the only ones a matrix job installs. */
export function projectBrowsers(): ReleaseBrowsers {
  return require(entry) as ReleaseBrowsers // the release's CommonJS entry, which re-exports playwright-core's browser types
}

/** The Chromium version of that release, as its playwright-core's browsers.json records it. */
export async function projectChromiumVersion(): Promise<string> {
  const playwrightManifest = createRequire(entry).resolve('playwright/package.json')
  const core = createRequire(playwrightManifest).resolve('playwright-core/package.json')
  const text = await readFile(join(dirname(core), 'browsers.json'), 'utf8')
  const { browsers } = JSON.parse(text) as BrowserBuilds // playwright-core's list of the builds it downloads
  return browsers.find((b) => b.name === 'chromium')?.browserVersion ?? ''
}

/** The test with this title and its last result. */
export function only(tests: Map<string, Test>, title: string): { test: Test; result: Result } {
  const test = tests.get(title)
  const result = test?.results.at(-1)
  if (test === undefined || result === undefined) throw new Error(`no result for ${title}`)
  return { test, result }
}

export const whydiffAnnotations = (test: Test): string[] =>
  test.annotations.filter((a) => a.type === 'whydiff').map((a) => a.description ?? '')

/** Names and content types of the attachments whydiff adds for a failed screenshot. */
export const pairAttachments = (result: Result): string[] =>
  result.attachments
    .filter((a) => /^whydiff\/.+\//.test(a.name))
    .map((a) => `${a.name} ${a.contentType}`)

export async function attachmentText(result: Result, name: string): Promise<string> {
  const attachment = result.attachments.find((a) => a.name === name)
  if (attachment?.body !== undefined) return Buffer.from(attachment.body, 'base64').toString('utf8')
  if (attachment?.path === undefined) throw new Error(`no attachment ${name}`)
  return readFile(attachment.path, 'utf8')
}
