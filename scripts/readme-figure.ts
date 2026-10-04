import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify, stripVTControlCharacters } from 'node:util'

const run = promisify(execFile)
const root = new URL('..', import.meta.url).pathname
const cliPackage = join(root, 'packages/cli')
const fixture = join(cliPackage, 'fixtures/readme')
const cli = join(cliPackage, 'dist/main.js')
const require = createRequire(join(cliPackage, 'package.json'))
const playwright = require.resolve('@playwright/test/cli')
const { chromium } = require('playwright-core') as { chromium: { launch(): Promise<Browser> } } // the part of playwright-core this script calls
const images = join(root, 'docs/images')
const PROJECT = ['playwright.config.ts', 'fixtures.ts', 'screens.spec.ts', 'serve.ts', 'pages']
const SCREEN = 'settings'
const SIDES = ['expected', 'actual', 'diff']
const EXPLAIN = /npx whydiff explain s[0-9a-z]+/
const CODE_SPAN = /`([^`]+)`/
// A CSS property such as padding-left, kept on one line.
const PROPERTY = /\b[a-z]+(?:-[a-z]+)+\b/g
// The figure is laid out at 960 px; the two reports are taken narrower, so their text stays
// readable at the width GitHub and npm show a README image, and at a lower scale, so they stay small.
const FIGURE = { viewport: { width: 960, height: 600 }, scale: 2 }
const REPORT = { viewport: { width: 880, height: 900 }, scale: 1.5 }
const MARGIN = 16
// Where the HTML report's error box is cut: Playwright's call log and stack follow.
const CALL_LOG = 'Call log:'
const DURATION = '.test-case-duration { visibility: hidden }'

interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface Page {
  goto(url: string): Promise<unknown>
  url(): string
  waitForSelector(selector: string): Promise<unknown>
  locator(selector: string): { first(): { boundingBox(): Promise<Rect | null> } }
  evaluate(expression: string): Promise<unknown>
  screenshot(options: {
    path: string
    fullPage?: boolean
    clip?: Rect
    style?: string
  }): Promise<unknown>
}

interface Browser {
  newPage(options: {
    viewport: { width: number; height: number }
    deviceScaleFactor: number
    colorScheme: string
  }): Promise<Page>
  close(): Promise<void>
}

interface Spec {
  readonly id: string
  readonly title: string
  readonly tests: readonly { results: readonly { errors: readonly { message?: string }[] }[] }[]
}

interface Suite {
  readonly specs: readonly Spec[]
  readonly suites?: readonly Suite[]
}

if (!existsSync(cli)) throw new Error('build the packages first: pnpm build')
// The project runs in a copy, so its reports land where a user's would and print no long paths.
const work = await mkdtemp(join(tmpdir(), 'whydiff-figure-'))
try {
  for (const entry of PROJECT)
    await cp(join(fixture, entry), join(work, entry), { recursive: true })
  await writeFile(join(work, 'package.json'), '{ "private": true, "type": "module" }\n')
  await symlink(join(cliPackage, 'node_modules'), join(work, 'node_modules'))
  await test('before', ['--update-snapshots'])
  await test('after', [])
  const spec = await failedSpec()
  const message = failureMessage(spec)
  const command = EXPLAIN.exec(message.join('\n'))?.[0]
  if (command === undefined)
    throw new Error(`no explain command in the message:\n${message.join('\n')}`)
  const { stdout } = await run(process.execPath, [cli, ...command.split(' ').slice(2)], {
    cwd: work,
  })
  const page = stdout.split('\n')
  const headline = page.find((line) => line.startsWith('## '))
  const rule = page.find((line) => /^- `[^`]+` from `/.test(line))
  if (headline === undefined || rule === undefined)
    throw new Error(`${command} printed:\n${stdout}`)
  const lines = [
    ...message.map((line, i) =>
      paragraph(
        line,
        message[i - 1] === '',
        i === 0 ? 'h' : line.trim().startsWith('- ') ? 'w' : ''
      )
    ),
    paragraph(`$ ${command}`, true, ''),
    paragraph(headline, false, 'w'),
    paragraph(rule, false, ''),
  ]
  const shots = await Promise.all(SIDES.map((side) => shot(`${SCREEN}-${side}.png`)))
  const template = await readFile(join(root, 'scripts/readme-figure.html'), 'utf8')
  const figure = join(work, 'figure.html')
  await writeFile(
    figure,
    template.replace('<!-- shots -->', shots.join('\n')).replace('<!-- lines -->', lines.join('\n'))
  )
  await mkdir(images, { recursive: true })
  const browser = await chromium.launch()
  const urls = {
    figure: pathToFileURL(figure).href,
    report: `${pathToFileURL(join(work, 'playwright-report/index.html')).href}#?testId=${spec.id}`,
    runPage: pathToFileURL(join(work, 'whydiff-report/report.html')).href,
  }
  try {
    for (const colorScheme of ['light', 'dark']) {
      const open = async (url: string, { viewport, scale }: typeof FIGURE): Promise<Page> => {
        const tab = await browser.newPage({ viewport, deviceScaleFactor: scale, colorScheme })
        await tab.goto(url)
        return tab
      }
      const png = (name: string): string => join(images, `${name}-${colorScheme}.png`)
      await figurePicture(await open(urls.figure, FIGURE), png('failed-screenshot'))
      await reportPicture(await open(urls.report, REPORT), png('playwright-report'))
      await runPagePicture(await open(urls.runPage, REPORT), png('run-page'))
    }
  } finally {
    await browser.close()
  }
  for (const name of (await readdir(images)).sort()) console.log(join(images, name))
} finally {
  await rm(work, { recursive: true, force: true })
}

// The before side records the baselines and their snapshots; the after side fails, as it should.
async function test(side: string, args: readonly string[]): Promise<void> {
  const env = { ...process.env, WHYDIFF_README_SIDE: side, GITHUB_STEP_SUMMARY: '' }
  await run(process.execPath, [playwright, 'test', ...args], { cwd: work, env }).catch(
    (error: unknown) => {
      if (side === 'before') throw error
    }
  )
}

async function failedSpec(): Promise<Spec> {
  const report = JSON.parse(await readFile(join(work, 'results.json'), 'utf8')) as {
    suites: Suite[]
  } // the JSON reporter's shape
  const specs = report.suites.flatMap(function specsOf(suite: Suite): Spec[] {
    return [...suite.specs, ...(suite.suites ?? []).flatMap(specsOf)]
  })
  const spec = specs.find((s) => s.title === SCREEN)
  if (spec === undefined) throw new Error(`no ${SCREEN} test in the JSON report`)
  return spec
}

// Playwright's first line and the lines whydiff added after its pixel count, without colours.
function failureMessage(spec: Spec): string[] {
  const text = spec.tests[0]?.results.at(-1)?.errors[0]?.message
  if (text === undefined) throw new Error(`the ${SCREEN} test did not fail`)
  const lines = stripVTControlCharacters(text).split('\n')
  const start = lines.findIndex((line) => line.trim().startsWith('whydiff, '))
  const end = lines.findIndex((line, i) => i > start && line.trim() === '')
  if (start < 0) throw new Error(`no whydiff lines in the message:\n${text}`)
  return [lines[0] ?? '', '', ...lines.slice(start, end < 0 ? undefined : end)]
}

async function figurePicture(page: Page, path: string): Promise<void> {
  await page.screenshot({ path, fullPage: true })
}

// The failed test's page from Playwright's bar at the top down to the whydiff lines of its error,
// where the call log begins; the test's duration, which changes with every run, is left out.
async function reportPicture(page: Page, path: string): Promise<void> {
  await page.waitForSelector('.test-error-view')
  const column = await box(page, '.test-case-column')
  const below = await page.evaluate(`(() => {
    const walker = document.createTreeWalker(document.querySelector('.test-error-view'), NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const at = node.data.indexOf(${JSON.stringify(CALL_LOG)})
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + ${String(CALL_LOG.length)})
      return range.getBoundingClientRect().top
    }
    return null
  })()`)
  if (typeof below !== 'number') throw new Error(`no ${CALL_LOG} line in the HTML report's error`)
  await clipped(page, path, column, 0, below - MARGIN / 2, DURATION)
}

// The run page from its title down to the end of the first cause.
async function runPagePicture(page: Page, path: string): Promise<void> {
  const header = await box(page, 'header')
  const cause = await box(page, '.cause')
  await clipped(page, path, header, header.y - MARGIN, cause.y + cause.height)
}

async function clipped(
  page: Page,
  path: string,
  column: Rect,
  top: number,
  bottom: number,
  style = ''
): Promise<void> {
  const x = Math.max(0, column.x - MARGIN)
  const y = Math.max(0, top)
  const width = Math.min(REPORT.viewport.width - x, column.width + 2 * MARGIN)
  await page.screenshot({ path, fullPage: true, clip: { x, y, width, height: bottom - y }, style })
}

async function box(page: Page, selector: string): Promise<Rect> {
  const rect = await page.locator(selector).first().boundingBox()
  if (rect === null) throw new Error(`no ${selector} on ${page.url()}`)
  return rect
}

async function shot(name: string): Promise<string> {
  const results = join(work, 'test-results')
  const path = (await readdir(results, { recursive: true })).find((file) => file.endsWith(name))
  if (path === undefined) throw new Error(`Playwright wrote no ${name}`)
  await cp(join(results, path), join(work, name))
  return `<figure class="shot"><img src="${name}" /><figcaption class="mono">${name}</figcaption></figure>`
}

// One line of the terminal block: its indent kept, a list item hanging, each code span shown as
// its highlighted content without the backticks, property names and the command marked.
function paragraph(line: string, gap: boolean, tone: string): string {
  if (line === '') return ''
  const indent = line.length - line.trimStart().length
  const text = line.trimStart()
  const hang = text.startsWith('- ') ? 2 : 0
  const html = escape(text)
    .split(CODE_SPAN)
    .map((part, i) =>
      i % 2 === 1 ? `<span class="k">${part}</span>` : part.replace(PROPERTY, '<em>$&</em>')
    )
    .join('')
    .replace(EXPLAIN, '<span class="k">$&</span>')
  const classes = [tone, gap ? 'gap' : ''].filter((c) => c !== '').join(' ')
  return `<p class="${classes}" style="padding-left: ${String(indent + hang)}ch; text-indent: -${String(hang)}ch">${html}</p>`
}

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
