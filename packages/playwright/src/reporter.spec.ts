import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import type { FullConfig, TestCase, TestResult } from '@playwright/test/reporter'
import { PNG } from 'pngjs'

import type { AnnotationLike, ReportedAttachment, StepLike } from './attachments.js'
import { POINTER } from './cap.js'
import WhydiffReporter from './reporter.js'

const NO_REPORTERS: FullConfig['reporter'] = []

const causes = (file: string): URL =>
  new URL(`../../core/fixtures/causes/container-padding/${file}`, import.meta.url)

const step = (title: string, attachments: ReportedAttachment[] = [], error?: string): StepLike => ({
  category: 'expect',
  title,
  attachments,
  steps: [],
  ...(error === undefined ? {} : { error: { message: error } }),
})

describe('WhydiffReporter', () => {
  let dir: string
  let lines: string[]

  /** A 1000x800 PNG, white, with the band the container-padding golden changed painted black. */
  async function png(name: string, changed: boolean): Promise<string> {
    const image = new PNG({ width: 1000, height: 800 })
    image.data.fill(255)
    if (changed) {
      for (let y = 0; y < 60; y++) {
        for (let x = 0; x < 400; x++) image.data.set([0, 0, 0, 255], (y * 1000 + x) * 4)
      }
    }
    const path = join(dir, name)
    await writeFile(path, PNG.sync.write(image))
    return path
  }

  function testCase(title: string, line: number): TestCase {
    return {
      id: title,
      titlePath: () => ['', 'chromium', 'card.spec.ts', title],
      location: { file: '/repo/tests/card.spec.ts', line, column: 1 },
      parent: { project: () => ({ name: 'chromium' }) },
    } as unknown as TestCase // only these fields are read
  }

  const result = (
    attachments: ReportedAttachment[],
    steps: StepLike[] = [],
    annotations: AnnotationLike[] = []
  ): TestResult => ({ attachments, steps, annotations }) as unknown as TestResult // only these fields are read

  async function run(shard: FullConfig['shard']): Promise<void> {
    const expected = await png('expected.png', false)
    const actual = await png('actual.png', true)
    const images = (name: string): ReportedAttachment[] => [
      { name: `${name}-expected.png`, contentType: 'image/png', path: expected },
      { name: `${name}-actual.png`, contentType: 'image/png', path: actual },
    ]
    const diff = (name: string): ReportedAttachment => ({
      name: `${name}-diff.png`,
      contentType: 'image/png',
      path: actual,
    })
    const reporter = new WhydiffReporter({ outputDir: 'report' })
    reporter.onBegin({
      rootDir: '/repo/tests',
      configFile: join(dir, 'playwright.config.ts'),
      shard,
      reporter: NO_REPORTERS,
    } as FullConfig) // only these fields are read
    reporter.onTestEnd(
      testCase('padded card', 20),
      result([
        ...images('card'),
        { name: 'whydiff/card/markdown', contentType: 'text/markdown', body: Buffer.from('#') },
        {
          name: 'whydiff/card/snapshot-actual',
          contentType: 'application/json',
          path: causes('after.whydiff.json').pathname,
        },
        {
          name: 'whydiff/card/snapshot-expected',
          contentType: 'application/json',
          path: causes('before.whydiff.json').pathname,
        },
      ])
    )
    reporter.onTestEnd(
      testCase('card without baseline', 30),
      result([
        ...images('bare'),
        {
          name: 'whydiff/bare/snapshot-actual',
          contentType: 'application/json',
          path: causes('after.whydiff.json').pathname,
        },
      ])
    )
    reporter.onTestEnd(
      testCase('flaky card', 40),
      result([
        ...images('flaky'),
        {
          name: 'whydiff/flaky/snapshot-actual',
          contentType: 'application/json',
          path: '/missing',
        },
      ])
    )
    reporter.onTestEnd(
      testCase('flaky card', 40),
      result([], [step('Expect "toHaveScreenshot(flaky.png)"')])
    )
    reporter.onTestEnd(
      testCase('broken card', 50),
      result([
        ...images('broken'),
        {
          name: 'whydiff/broken/snapshot-actual',
          contentType: 'application/json',
          path: join(dir, 'missing.json'),
        },
        {
          name: 'whydiff/broken/snapshot-expected',
          contentType: 'application/json',
          path: join(dir, 'missing.json'),
        },
      ])
    )
    const slow = [...images('slow'), diff('slow')]
    reporter.onTestEnd(
      testCase('slow card', 60),
      result(
        slow,
        [step('Expect "toHaveScreenshot(slow.png)"', slow, 'x')],
        [
          {
            type: 'whydiff',
            description:
              'slow: not explained: skipped after 61000 ms, over the budget of 60000 ms. Raise use.whydiff.budgetMs to keep it.',
          },
        ]
      )
    )
    const vanished = images('vanished').slice(0, 1)
    reporter.onTestEnd(
      testCase('vanished card', 70),
      result(
        vanished,
        [
          step(
            'Expect "toHaveScreenshot(vanished.png)"',
            vanished,
            "Error: \u001b[2mexpect(\u001b[22mlocator\u001b[2m).\u001b[22mtoHaveScreenshot(expected) failed\n\nLocator: locator('#gone')\nTimeout: 500ms\n  Timeout 500ms exceeded.\n\n  Snapshot: vanished.png"
          ),
        ],
        [
          {
            type: 'whydiff',
            description:
              'vanished: not explained: the assertion produced no actual image (expect(locator).toHaveScreenshot(expected) failed: Timeout 500ms exceeded.)',
          },
          { type: 'whydiff', description: 'vanish: not explained: another screenshot' },
        ]
      )
    )
    reporter.onTestEnd(
      testCase('fresh card', 80),
      result(
        [],
        [
          step(
            'Expect "toHaveScreenshot(fresh.png)"',
            [],
            "Error: A snapshot doesn't exist at /repo/snapshots/fresh.png."
          ),
        ]
      )
    )
    reporter.onTestEnd(
      testCase('half card', 90),
      result([
        ...images('half'),
        { name: 'whydiff/half/markdown', contentType: 'text/markdown', body: Buffer.from('#') },
      ])
    )
    await reporter.onEnd()
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'whydiff-reporter-'))
    vi.stubEnv('GITHUB_STEP_SUMMARY', '')
    lines = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line)
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(dir, { recursive: true, force: true })
  })

  it('explains the pairs, lists passed ones by title and pairs without a baseline under a note', async () => {
    await run(null)
    const report = JSON.parse(await readFile(join(dir, 'report', 'report.json'), 'utf8')) as {
      screenshots: { id: string; title: string; status: string; file: string; line: number }[]
      causes: { kind: string }[]
    } // the report format
    const id = expect.stringMatching(/^s[0-9a-z]{6}$/) as unknown as string // asymmetric matcher
    expect(report.screenshots.map((s) => [s.id, s.title, s.status, s.file, s.line])).toEqual([
      [id, 'padded card > card', 'changed', 'card.spec.ts', 20],
      [id, 'flaky card', 'identical', 'card.spec.ts', 40],
    ])
    const changed = report.screenshots[0]?.id ?? ''
    expect(report.causes).toHaveLength(1)
    const markdown = await readFile(join(dir, 'report', 'report.md'), 'utf8')
    expect(markdown).toMatch(
      /^# whydiff: 1 of 2 screenshots changed \| 1 cause \| 0 unexplained regions\n/
    )
    expect(markdown).toContain(
      [
        '',
        '## No baseline snapshot (1)',
        'No render-tree snapshot is stored next to the baseline PNG, so only the pixels are described; run with --update-snapshots, or let the assertion pass once with backfill on, to record one.',
        '- card without baseline > bare | card.spec.ts:30 | chromium | 1000x800 px, 24,000 differing, 1 region',
        '',
      ].join('\n')
    )
    expect(markdown.slice(markdown.indexOf('\n## Not explained')).split('\n')).toEqual([
      '',
      '## Not explained (5)',
      'Failed screenshots that neither their test nor this report could explain, each with the reason its whydiff annotation gives, else the error of its assertion.',
      expect.stringMatching(
        /^- broken card > broken \| card\.spec\.ts:50 \| chromium \| its files could not be read: ENOENT/
      ),
      '- slow card > slow | card.spec.ts:60 | chromium | skipped after 61000 ms, over the budget of 60000 ms. Raise use.whydiff.budgetMs to keep it.',
      '- vanished card > vanished | card.spec.ts:70 | chromium | the assertion produced no actual image (expect(locator).toHaveScreenshot(expected) failed: Timeout 500ms exceeded.)',
      "- fresh card | card.spec.ts:80 | chromium | A snapshot doesn't exist at /repo/snapshots/fresh.png.",
      '- half card > half | card.spec.ts:90 | chromium | its files could not be read: the actual snapshot or an image of the pair is not attached',
      '',
    ])
    expect(await readFile(join(dir, 'report', 'screenshots', `${changed}.md`), 'utf8')).toContain(
      `\nsource: card.spec.ts:20 | chromium | 1000x800 px, 24,000 changed pixels | ${changed}\n`
    )
    expect(lines).toEqual([
      expect.stringMatching(/^whydiff: broken card > broken skipped: /),
      'whydiff: half card > half skipped: the actual snapshot or an image of the pair is not attached',
      'whydiff: 1 of 2 screenshots changed, 1 more without a baseline snapshot, 5 more failed but not explained',
      'whydiff: 1 cause, 0 unexplained regions',
      `whydiff: ${relative(process.cwd(), join(dir, 'report', 'report.md'))}`,
    ])
  })

  it('writes the run page next to report.json and links it from every test with a failed screenshot', async () => {
    const images = [
      { name: 'card-expected.png', contentType: 'image/png', path: await png('e.png', false) },
      { name: 'card-actual.png', contentType: 'image/png', path: await png('a.png', true) },
    ]
    const failed = result([
      ...images,
      {
        name: 'whydiff/card/snapshot-actual',
        contentType: 'application/json',
        path: causes('after.whydiff.json').pathname,
      },
      {
        name: 'whydiff/card/snapshot-expected',
        contentType: 'application/json',
        path: causes('before.whydiff.json').pathname,
      },
    ])
    const passed = result([], [step('Expect "toHaveScreenshot(plain.png)"')])
    const reporter = new WhydiffReporter({ outputDir: 'report' })
    reporter.onBegin({
      rootDir: '/repo/tests',
      configFile: join(dir, 'playwright.config.ts'),
      shard: null,
      reporter: NO_REPORTERS,
    } as FullConfig) // only these fields are read
    reporter.onTestEnd(testCase('padded card', 20), failed)
    reporter.onTestEnd(testCase('plain card', 30), passed)
    await reporter.onEnd()
    const page = join(dir, 'report', 'report.html')
    expect(await readFile(page, 'utf8')).toMatch(
      /^<!doctype html>\n[\s\S]*<h1>1 of 2 screenshots changed<\/h1>/
    )
    expect(failed.attachments[0]).toEqual({
      name: 'whydiff/run',
      contentType: 'text/html',
      path: page,
    })
    expect(passed.attachments).toEqual([])
  })

  it('opens a run whose failed screenshots none was explained with how many failed, in every place the run is summed up', async () => {
    const file = join(dir, 'step-summary.md')
    vi.stubEnv('GITHUB_STEP_SUMMARY', file)
    const failing = (name: string): TestResult => {
      const images: ReportedAttachment[] = [
        { name: `${name}-expected.png`, contentType: 'image/png', path: join(dir, 'e.png') },
        { name: `${name}-actual.png`, contentType: 'image/png', path: join(dir, 'a.png') },
        { name: `${name}-diff.png`, contentType: 'image/png', path: join(dir, 'd.png') },
      ]
      return result(images, [
        step(
          `Expect "toHaveScreenshot(${name}.png)"`,
          images,
          'expect(page).toHaveScreenshot(expected) failed'
        ),
      ])
    }
    const reporter = new WhydiffReporter({ outputDir: 'report' })
    reporter.onBegin({ rootDir: dir, shard: null, reporter: NO_REPORTERS } as FullConfig) // only these fields are read
    reporter.onTestEnd(testCase('first card', 10), failing('first'))
    reporter.onTestEnd(testCase('second card', 20), failing('second'))
    await reporter.onEnd()
    const line = '2 failed screenshots, none explained'
    expect((await readFile(join(dir, 'report', 'report.md'), 'utf8')).split('\n', 3)).toEqual([
      `# whydiff: ${line}`,
      'compared: expected -> actual',
      'Each is listed below, under No baseline snapshot or Not explained, with what whydiff lacked to explain it.',
    ])
    expect(await readFile(join(dir, 'report', 'report.html'), 'utf8')).toContain(`<h1>${line}</h1>`)
    expect(lines[0]).toBe(`whydiff: ${line}`)
    expect((await readFile(file, 'utf8')).split('\n', 2)).toEqual(['## whydiff', `- ${line}`])
  })

  it('hands the workers a fresh run directory and its report directory, and takes both back at the end', async () => {
    const reporter = new WhydiffReporter({ outputDir: 'report' })
    reporter.onBegin({ rootDir: dir, shard: null, reporter: NO_REPORTERS } as FullConfig) // only these fields are read
    const run = process.env.WHYDIFF_RUN_DIR ?? ''
    expect(run.startsWith(join(tmpdir(), 'whydiff-'))).toBe(true)
    expect(existsSync(run)).toBe(true)
    expect(process.env.WHYDIFF_REPORT_DIR).toBe(join(dir, 'report'))
    await reporter.onEnd()
    expect(existsSync(run)).toBe(false)
    expect(process.env.WHYDIFF_RUN_DIR).toBeUndefined()
    expect(process.env.WHYDIFF_REPORT_DIR).toBeUndefined()
  })

  it('names the files of a shard after it', async () => {
    await run({ current: 1, total: 2 })
    expect(await readFile(join(dir, 'report', 'report.shard-1-of-2.md'), 'utf8')).toContain(
      '# whydiff: 1 of 2'
    )
    const [file = ''] = await readdir(join(dir, 'report', 'screenshots.shard-1-of-2'))
    expect(file).toMatch(/^s[0-9a-z]{6}\.md$/)
    expect(await readFile(join(dir, 'report', 'screenshots.shard-1-of-2', file), 'utf8')).toContain(
      `changed pixels | ${file.replace(/\.md$/, '')}\n`
    )
  })

  it("puts the run's page in place of what each test attached, a pointer or its own page, and its first line in place of the annotation that quoted it", async () => {
    const expected = await png('e.png', false)
    const actual = await png('a.png', true)
    /** A failed test whose card screenshot attached `body` and was annotated with `quoted`. */
    const ended = (body: string, quoted: string): TestResult =>
      result(
        [
          { name: 'card-expected.png', contentType: 'image/png', path: expected },
          { name: 'card-actual.png', contentType: 'image/png', path: actual },
          { name: 'whydiff/card/markdown', contentType: 'text/markdown', body: Buffer.from(body) },
          {
            name: 'whydiff/card/snapshot-actual',
            contentType: 'application/json',
            path: causes('after.whydiff.json').pathname,
          },
          {
            name: 'whydiff/card/snapshot-expected',
            contentType: 'application/json',
            path: causes('before.whydiff.json').pathname,
          },
        ],
        [],
        [
          { type: 'whydiff', description: 'card: something else' },
          { type: 'whydiff', description: quoted },
        ]
      )
    const pointed = `${POINTER}report/screenshots/s1abcde.md.`
    const past = ended(`${pointed}\nThe reporter writes it there when the run ends.\n`, pointed)
    // What the test wrote for the same pair explained alone, here the same as the run's line.
    const own = ended(
      '# whydiff: own card > card\n',
      "a <section>'s inner spacing grew by 24 px (c2k0l43)"
    )
    const markdownOf = (test: TestResult): ReportedAttachment | undefined =>
      test.attachments.find((a) => a.name === 'whydiff/card/markdown')
    const markdown = markdownOf(past)
    const reporter = new WhydiffReporter({ outputDir: 'report' })
    reporter.onBegin({
      rootDir: '/repo/tests',
      configFile: join(dir, 'p.config.ts'),
      shard: null,
      reporter: NO_REPORTERS,
    } as FullConfig) // only these fields are read
    reporter.onTestEnd(testCase('padded card', 20), past)
    reporter.onTestEnd(testCase('own card', 30), own)
    await reporter.onEnd()
    const pages = await readdir(join(dir, 'report', 'screenshots'))
    const written = await Promise.all(
      pages.map((page) => readFile(join(dir, 'report', 'screenshots', page), 'utf8'))
    )
    for (const test of [past, own]) {
      expect(written).toContain(markdownOf(test)?.body?.toString('utf8'))
      expect(test.annotations.map((a) => a.description)).toEqual([
        'card: something else',
        "a <section>'s inner spacing grew by 24 px (c2k0l43)",
      ])
    }
    expect(markdownOf(past)).toBe(markdown)
    expect(lines).toContain(
      'whydiff: 1 failed screenshot past use.whydiff.maxExplained explained when the run ended, not in its test'
    )
  })

  it("rewrites the page the test wrote next to its actual image with the run's, and writes none where there was none", async () => {
    const expected = await png('card-expected.png', false)
    const actual = await png('card-actual.png', true)
    const own = '# whydiff: own card > card\n'
    const copy = join(dir, 'card-whydiff.md')
    await writeFile(copy, own)
    const ended = (path: string): TestResult =>
      result(
        [
          { name: 'card-expected.png', contentType: 'image/png', path: expected },
          { name: 'card-actual.png', contentType: 'image/png', path },
          { name: 'whydiff/card/markdown', contentType: 'text/markdown', body: Buffer.from(own) },
          {
            name: 'whydiff/card/snapshot-actual',
            contentType: 'application/json',
            path: causes('after.whydiff.json').pathname,
          },
          {
            name: 'whydiff/card/snapshot-expected',
            contentType: 'application/json',
            path: causes('before.whydiff.json').pathname,
          },
        ],
        [],
        []
      )
    const written = ended(actual)
    const elsewhere = ended(await png('other-actual.png', true))
    const reporter = new WhydiffReporter({ outputDir: 'report' })
    reporter.onBegin({ rootDir: dir, shard: null, reporter: NO_REPORTERS } as FullConfig) // only these fields are read
    reporter.onTestEnd(testCase('padded card', 20), written)
    reporter.onTestEnd(testCase('other card', 30), elsewhere)
    await reporter.onEnd()
    const page = written.attachments
      .find((a) => a.name === 'whydiff/card/markdown')
      ?.body?.toString('utf8')
    expect(page).toMatch(/^What changed on this screen:\n/)
    expect(await readFile(copy, 'utf8')).toBe(page)
    expect(existsSync(join(dir, 'other-whydiff.md'))).toBe(false)
  })

  it('warns on the console and in the job summary when html runs before it, and not when it runs first', async () => {
    const file = join(dir, 'step-summary.md')
    vi.stubEnv('GITHUB_STEP_SUMMARY', file)
    const warning =
      "the html reporter runs before this one, so Playwright's HTML report keeps each test's own page; list @whydiff/playwright/reporter before html (npx whydiff init does it)"
    const begin = async (order: FullConfig['reporter']): Promise<void> => {
      const reporter = new WhydiffReporter({ outputDir: 'report' })
      reporter.onBegin({ rootDir: dir, shard: null, reporter: order } as FullConfig) // only these fields are read
      const images: ReportedAttachment[] = [
        { name: 'card-expected.png', contentType: 'image/png', path: join(dir, 'e.png') },
        { name: 'card-actual.png', contentType: 'image/png', path: join(dir, 'a.png') },
      ]
      const failed = step(
        'Expect "toHaveScreenshot(card.png)"',
        images,
        'expect(page).toHaveScreenshot(expected) failed'
      )
      reporter.onTestEnd(testCase('bare card', 10), result(images, [failed]))
      await reporter.onEnd()
    }
    await begin([
      ['list', undefined],
      ['html', { open: 'never' }],
      ['@whydiff/playwright/reporter', undefined],
    ])
    expect(lines).toContain(`whydiff: ${warning}`)
    expect((await readFile(file, 'utf8')).split('\n', 3)).toEqual([
      '## whydiff',
      "Warning: the html reporter runs before this one, so Playwright's HTML report keeps each test's own page; list `@whydiff/playwright/reporter` before `html` (`npx whydiff init` does it)",
      '',
    ])
    lines.length = 0
    await rm(file)
    await begin([
      ['@whydiff/playwright/reporter', undefined],
      ['html', { open: 'never' }],
    ])
    expect(lines.join('\n')).not.toContain('html reporter runs before')
    expect(await readFile(file, 'utf8')).not.toContain('Warning:')
  })

  it('appends a summary to GITHUB_STEP_SUMMARY when a screenshot failed, and nothing when none did', async () => {
    const file = join(dir, 'step-summary.md')
    await writeFile(file, '# earlier step\n')
    vi.stubEnv('GITHUB_STEP_SUMMARY', file)
    await run(null)
    const summary = await readFile(file, 'utf8')
    expect(summary).toMatch(
      /^# earlier step\n## whydiff\n- 1 of 2 screenshots changed, 1 more without a baseline snapshot, 5 more failed but not explained\n- 1 cause, 0 unexplained regions\n\n1 cause appears on the changed screenshot, 100% of changed pixels, [^\n]+:\n- a `<section>`'s inner spacing grew by 24 px, [^\n]+ \(c2k0l43\)\n\n/
    )
    expect(summary).toMatch(
      /\nThe whole run in `[^`]*\/report\/report\.md`; the page of each changed screenshot in `[^`]*\/report\/screenshots\/`\.\n$/
    )
    const quiet = join(dir, 'quiet.md')
    vi.stubEnv('GITHUB_STEP_SUMMARY', quiet)
    const reporter = new WhydiffReporter({ outputDir: 'quiet' })
    reporter.onBegin({ rootDir: dir, shard: null, reporter: NO_REPORTERS } as FullConfig) // only these fields are read
    reporter.onTestEnd(
      testCase('passing card', 10),
      result([], [step('Expect "toHaveScreenshot(a.png)"')])
    )
    await reporter.onEnd()
    expect(existsSync(quiet)).toBe(false)
  })
})
