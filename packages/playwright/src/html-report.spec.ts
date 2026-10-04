import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Browser, Locator, Page } from '@playwright/test'
import { parseReport, type ReportV1 } from '@whydiff/core'

import { POINTER } from './cap.js'
import { NO_BASELINE } from './pair.js'
import { playwright, projectBrowsers, projectChromiumVersion } from './testing/project.js'

const dist = new URL('../dist/reporter.js', import.meta.url).pathname

describe("Playwright's HTML report of a run with whydiff", () => {
  let tmp: string
  let browser: Browser | undefined
  let report: ReportV1
  let outputs: { whydiffFirst: string; htmlFirst: string }

  const at = (name: string): string => join(tmp, name)

  /** The report of one run in a fresh tab, its test list filtered by `query`. */
  async function show<T>(run: string, query: string, read: (page: Page) => Promise<T>): Promise<T> {
    if (browser === undefined) throw new Error('chromium did not launch')
    const page = await browser.newPage()
    try {
      await page.goto(`file://${at(`html-${run}`)}/index.html#?q=${encodeURIComponent(query)}`)
      // The report renders once its data is unzipped, the search box and the filtered list together.
      await page.locator('.subnav-search-input').waitFor()
      return await read(page)
    } finally {
      await page.close()
    }
  }

  /** The rows the report's test list shows for a search, by test title. */
  function search(run: string, query: string): Promise<string[]> {
    return show(run, query, async (page) => {
      const titles = await page
        .locator('.test-file-test')
        .evaluateAll((rows) => rows.map((row) => row.querySelector('a')?.textContent ?? ''))
      return titles.sort()
    })
  }

  /** A test's page in the report: its annotations, the error text that holds whydiff's lines, and the text of one attachment. */
  function open(
    run: string,
    title: string,
    attachment: string
  ): Promise<{ annotations: string[]; error: string; attached: string }> {
    return show(run, '', async (page) => {
      await page.getByRole('link', { name: title, exact: true }).click()
      const name = page.getByText(attachment, { exact: true })
      await name.waitFor()
      const annotations = await page.locator('.test-case-annotation').allTextContents()
      const lines = page.getByText('whydiff, expected -> actual:')
      const error = (await lines.count()) === 0 ? '' : ((await lines.first().textContent()) ?? '')
      await name.click()
      const attached = (await page.locator('.attachment-body').first().textContent()) ?? ''
      return { annotations, error, attached }
    })
  }

  /** The tests a cause of the run report has members in, by title. */
  function testsOf(cause: string): string[] {
    const screenshots = report.causes.find((c) => c.id === cause)?.members.map((m) => m.screenshot)
    return report.screenshots
      .filter((s) => screenshots?.includes(s.id) === true)
      .map((s) => s.title.split(' > ')[0] ?? '')
      .sort()
  }

  beforeAll(async () => {
    if (!existsSync(dist)) throw new Error('build @whydiff/playwright first: pnpm build')
    tmp = await mkdtemp(join(tmpdir(), 'whydiff-html-'))
    const snapshots = at('snapshots')
    const named = ['cap', 'reporter', 'causes'].flatMap((name) => ['--project', name])
    const projects = [...named, '--workers', '2']
    await playwright(['test', ...projects, '--update-snapshots'], {
      WHYDIFF_FIXTURE_SNAPSHOTS: snapshots,
      WHYDIFF_FIXTURE_OUTPUT: at('out-base'),
      WHYDIFF_FIXTURE_REPORT: at('base.json'),
    })
    await rm(join(snapshots, 'reporter.spec.ts', 'bare.whydiff.json'))
    const changed = (run: string, env: Record<string, string>): Promise<string> =>
      playwright(['test', ...projects], {
        WHYDIFF_FIXTURE_SNAPSHOTS: snapshots,
        WHYDIFF_FIXTURE_VARIANT: 'changed',
        WHYDIFF_FIXTURE_OUTPUT: at(`out-${run}`),
        WHYDIFF_FIXTURE_REPORT: at(`${run}.json`),
        WHYDIFF_FIXTURE_WHYDIFF_REPORT: at(`whydiff-${run}`),
        WHYDIFF_FIXTURE_HTML: at(`html-${run}`),
        ...env,
      })
    outputs = {
      whydiffFirst: await changed('whydiff-first', {}),
      htmlFirst: await changed('html-first', { WHYDIFF_FIXTURE_HTML_FIRST: '1' }),
    }
    report = parseReport(await readFile(at('whydiff-whydiff-first/report.json'), 'utf8'))
    browser = await projectBrowsers().chromium.launch(
      process.env.WHYDIFF_CHROMIUM === undefined
        ? {}
        : { executablePath: process.env.WHYDIFF_CHROMIUM }
    )
  }, 300_000)

  afterAll(async () => {
    await browser?.close()
    await rm(tmp, { recursive: true, force: true })
  }, 60_000)

  it.skipIf(process.env.WHYDIFF_CHROMIUM !== undefined)(
    "reads the report with the headless shell of the project's own release, not the workspace's",
    async () => {
      expect(browser?.version()).toBe(await projectChromiumVersion())
    }
  )

  it("shows each failed screenshot's first line of what changed, with its cause, above the errors, and the lines in them", async () => {
    const [cause] = report.causes.filter((c) => testsOf(c.id).includes('header'))
    for (const title of ['header', 'footer']) {
      const { annotations, error } = await open('whydiff-first', title, `whydiff/${title}/markdown`)
      expect(annotations).toEqual([
        `whydiff: a <div.banner> is 16 px wider (was 300, now 316) (${cause?.id ?? ''})`,
      ])
      expect(error).toMatch(
        /are different\.\s+whydiff, expected -> actual:\s+- a <div\.banner> is 16 px wider \(was 300, now 316\)\s+details when the run ends: npx whydiff explain s[0-9a-z]{6} --report \S+\/report\.json\s/
      )
    }
    const { annotations } = await open('whydiff-first', 'bare', 'whydiff/bare/markdown')
    expect(annotations).toEqual([`whydiff: ${NO_BASELINE}`])
  })

  it('links the run page from each failed test below the annotation and the lines, which stay on the first screen', async () => {
    const top = async (locator: Locator): Promise<number> =>
      (await locator.first().boundingBox())?.y ?? Number.POSITIVE_INFINITY
    const seen = await show('whydiff-first', '', async (page) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.getByRole('link', { name: 'header', exact: true }).click()
      const run = page.getByRole('link', { name: 'whydiff/run', exact: true })
      await run.waitFor()
      return {
        annotation: await top(page.locator('.test-case-annotation')),
        lines: await top(page.getByText('whydiff, expected -> actual:')),
        run: await top(run),
        page: new URL((await run.getAttribute('href')) ?? '', page.url()).href,
      }
    })
    expect(seen.annotation).toBeLessThan(seen.lines)
    expect(seen.lines).toBeLessThan(900)
    expect(seen.run).toBeGreaterThan(seen.lines)
    const heading = await show('whydiff-first', '', async (page) => {
      await page.goto(seen.page)
      return page.locator('h1').textContent()
    })
    const { changed, compared } = report.summary.screenshots
    expect(heading).toBe(`${String(changed)} of ${String(compared)} screenshots changed`)
    const passed = await show('whydiff-first', '', async (page) => {
      await page.getByRole('link', { name: 'stable', exact: true }).click()
      await page.getByText('stable', { exact: true }).first().waitFor()
      return page.getByRole('link', { name: 'whydiff/run', exact: true }).count()
    })
    expect(passed).toBe(0)
  })

  it('lists the run page first among the attachments of a failed test', async () => {
    const names = [
      'whydiff/run',
      'whydiff/header/markdown',
      'whydiff/header/snapshot-actual',
      'whydiff/header/snapshot-expected',
      'error-context',
    ]
    const order = await show('whydiff-first', '', async (page) => {
      await page.getByRole('link', { name: 'header', exact: true }).click()
      await page.getByRole('link', { name: 'whydiff/run', exact: true }).waitFor()
      const tops = await Promise.all(
        names.map(async (name) => {
          const shown = page.getByText(name, { exact: true })
          const box = (await shown.count()) === 0 ? null : await shown.first().boundingBox()
          return { name, top: box?.y ?? -1 }
        })
      )
      return tops
        .filter((t) => t.top >= 0)
        .sort((a, b) => a.top - b.top)
        .map((t) => t.name)
    })
    expect(order[0]).toBe('whydiff/run')
  })

  it('finds every test of a cause by annot:<cause id>, the ones past the cap included', async () => {
    expect(report.causes).toHaveLength(2)
    for (const cause of report.causes) {
      expect(testsOf(cause.id).length).toBeGreaterThan(1)
      expect(await search('whydiff-first', `annot:${cause.id}`)).toEqual(testsOf(cause.id))
    }
  })

  it('warns in a run that lists html first, its reporter named by a path, and not in one that lists whydiff first', () => {
    const warning = 'whydiff: the html reporter runs before this one'
    expect(outputs.htmlFirst).toContain(warning)
    expect(outputs.whydiffFirst).not.toContain(warning)
  })

  it("puts the run's page in place of each pointer past the cap, unless html is listed first", async () => {
    const pages = await Promise.all(
      ['first', 'second', 'third'].map((title) =>
        open('whydiff-first', title, `whydiff/${title}/markdown`)
      )
    )
    for (const { attached } of pages) {
      expect(attached).toMatch(/^# whydiff: (?:first|second|third) > /)
    }
    const kept = await Promise.all(
      ['first', 'second', 'third'].map((title) =>
        open('html-first', title, `whydiff/${title}/markdown`)
      )
    )
    expect(kept.filter(({ attached }) => attached.startsWith(POINTER))).toHaveLength(2)
    const [cap] = report.causes.filter((c) => testsOf(c.id).includes('first'))
    const found = await search('html-first', `annot:${cap?.id ?? ''}`)
    expect(found.length).toBeLessThan(testsOf(cap?.id ?? '').length)
  })
})
