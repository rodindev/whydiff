import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listTestResults, runSides } from './runs.js'

const SHA = 'a'.repeat(40)
const MARKDOWN = [
  'What changed on this screen:',
  '- a `<div>` is 24 px wider (was 200, now 224) (c1dsr5a)',
  '',
  '# whydiff: without attachments > named failure > card | 1 cause | 0 unexplained regions',
  'compared: expected -> actual',
  'source: tests/matcher.spec.ts:20 | matcher | 800x600 px, 1,920 changed pixels | s1eeet9',
  '',
].join('\n')
// A page whose screen has no observed element opens with its header.
const HEADER_FIRST = MARKDOWN.split('\n').slice(3).join('\n')
const POINTER = [
  'The explanation of this screenshot is in whydiff-report/screenshots/s1eeet9.md.',
  'It is there because this run reached its in-test limit of 1, use.whydiff.maxExplained.',
  'Nothing failed in whydiff.',
  '',
].join('\n')
const PIXELS_ONLY = [
  '# whydiff: bare > bare | no baseline snapshot',
  'compared: expected -> actual',
  'source: tests/matcher.spec.ts:34 | matcher | 800x600 px, 640 changed pixels',
  '',
].join('\n')

async function testDir(root: string, name: string, files: Record<string, string>): Promise<void> {
  for (const [file, text] of Object.entries(files)) {
    await mkdir(join(root, name, file, '..'), { recursive: true })
    await writeFile(join(root, name, file), text)
  }
}

interface Line {
  readonly ordinal: number
  readonly retry?: number
  readonly testId?: string
  readonly name?: string
  readonly failedName?: string
  readonly repeat?: number
  readonly snapshot: string | null
  readonly screenshot: string | null
  readonly png: string | null
}

/** The key the run's reporter gives a screenshot of `tests/a.spec.ts` in project chromium. */
function reported(title: string): string {
  return ['chromium', 'tests/a.spec.ts', title].join('\x1e')
}

async function manifest(dir: string, lines: readonly Line[]): Promise<void> {
  const full = lines.map((line) => ({
    project: 'chromium',
    testId: 't1',
    title: 'test t1',
    file: 'tests/a.spec.ts',
    line: 7,
    name: 'card',
    retry: 0,
    receiver: 'page',
    ...line,
  }))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'manifest.jsonl'), full.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

describe('runSides', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'whydiff-runs-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('takes the recorded png, and none where the run recorded none, its baseline here or not', async () => {
    const baseline = join(dir, 'baseline.png')
    await writeFile(baseline, '')
    await manifest(join(dir, 'run'), [
      {
        ordinal: 1,
        snapshot: 'chromium/t1/1-card.whydiff.json',
        screenshot: baseline,
        png: 'chromium/t1/1-card.png',
      },
      { ordinal: 2, snapshot: 'chromium/t1/2-card.whydiff.json', screenshot: baseline, png: null },
      {
        ordinal: 3,
        snapshot: 'chromium/t1/3-card.whydiff.json',
        screenshot: join(dir, 'gone.png'),
        png: null,
      },
      { ordinal: 4, snapshot: 'chromium/t1/4-card.whydiff.json', screenshot: null, png: null },
      { ordinal: 5, snapshot: null, screenshot: baseline, png: 'chromium/t1/5-card.png' },
    ])
    const sides = await runSides(join(dir, 'run'))
    expect([...sides.values()].map((side) => [side.key, side.png])).toEqual([
      ['chromium|t1|1', join(dir, 'run', 'chromium/t1/1-card.png')],
      // A run that took no screenshot records none; the baseline is not what it saw.
      ['chromium|t1|2', null],
      ['chromium|t1|3', null],
      ['chromium|t1|4', null],
    ])
    expect(sides.get('chromium|t1|1')).toEqual({
      key: 'chromium|t1|1',
      title: 'test t1 > card',
      file: 'tests/a.spec.ts',
      line: 7,
      project: 'chromium',
      snapshot: join(dir, 'run', 'chromium/t1/1-card.whydiff.json'),
      png: join(dir, 'run', 'chromium/t1/1-card.png'),
    })
  })

  it('lets the last retry of an ordinal win', async () => {
    await manifest(join(dir, 'run'), [
      {
        ordinal: 1,
        retry: 1,
        snapshot: 'chromium/t1/1-card-retry1.whydiff.json',
        screenshot: null,
        png: 'chromium/t1/1-card-retry1.png',
      },
      { ordinal: 1, snapshot: 'chromium/t1/1-card.whydiff.json', screenshot: null, png: null },
    ])
    const sides = await runSides(join(dir, 'run'))
    expect(sides.get('chromium|t1|1')?.png).toBe(join(dir, 'run', 'chromium/t1/1-card-retry1.png'))
  })

  it("keys the id of a screenshot that failed as the run's reporter does, by the name the built-in gave its images", async () => {
    await manifest(join(dir, 'run'), [
      {
        ordinal: 1,
        name: 'home_page',
        failedName: 'home-page',
        repeat: 0,
        snapshot: '1.whydiff.json',
        screenshot: null,
        png: null,
      },
      {
        ordinal: 2,
        name: 'screenshot',
        failedName: 'test-t1-1',
        repeat: 0,
        snapshot: '2.whydiff.json',
        screenshot: null,
        png: null,
      },
      {
        ordinal: 1,
        testId: 't1-repeat2',
        failedName: 'card',
        repeat: 2,
        snapshot: '3.whydiff.json',
        screenshot: null,
        png: null,
      },
    ])
    const sides = await runSides(join(dir, 'run'))
    expect([...sides.values()].map((side) => [side.key, side.screen, side.title])).toEqual([
      ['chromium|t1|1', reported('test t1 > home-page'), 'test t1 > home-page'],
      ['chromium|t1|2', reported('test t1 > test-t1-1'), 'test t1 > test-t1-1'],
      ['chromium|t1-repeat2|1', reported('test t1 > card (repeat:2)'), 'test t1 > card'],
    ])
  })

  it('keeps the name of a failed attempt when a retry passed, and the files of the retry', async () => {
    await manifest(join(dir, 'run'), [
      {
        ordinal: 1,
        retry: 1,
        name: 'home_page',
        repeat: 0,
        snapshot: '1-retry1.whydiff.json',
        screenshot: null,
        png: '1-retry1.png',
      },
      {
        ordinal: 1,
        name: 'home_page',
        failedName: 'home-page',
        repeat: 0,
        snapshot: '1.whydiff.json',
        screenshot: null,
        png: '1.png',
      },
    ])
    const sides = await runSides(join(dir, 'run'))
    expect(sides.get('chromium|t1|1')).toMatchObject({
      screen: reported('test t1 > home-page'),
      title: 'test t1 > home-page',
      png: join(dir, 'run', '1-retry1.png'),
    })
  })

  it('keeps the key of 0.1 as the id of a screenshot that passed, in a line 0.1 recorded too', async () => {
    await manifest(join(dir, 'run'), [
      {
        ordinal: 1,
        name: 'home_page',
        repeat: 0,
        snapshot: '1.whydiff.json',
        screenshot: null,
        png: null,
      },
      { ordinal: 2, name: 'home_page', snapshot: '2.whydiff.json', screenshot: null, png: null },
    ])
    const sides = await runSides(join(dir, 'run'))
    expect([...sides.values()].map((side) => [side.key, side.screen, side.title])).toEqual([
      ['chromium|t1|1', undefined, 'test t1 > home_page'],
      ['chromium|t1|2', undefined, 'test t1 > home_page'],
    ])
  })
})

describe('listTestResults', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'whydiff-results-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('rebuilds the attachments from the copies Playwright made and the identity from the Markdown whydiff wrote', async () => {
    await writeFile(join(dir, '.last-run.json'), '{}')
    await testDir(dir, 'matcher-named-failure-matcher', {
      'card-whydiff.md': MARKDOWN,
      [`attachments/whydiff-card-snapshot-actual-${SHA}.json`]: '{}',
      [`attachments/whydiff-card-snapshot-expected-${SHA}.json`]: '{}',
      [`attachments/trace-${SHA}.zip`]: '',
      'card-expected.png': '',
      'card-actual.png': '',
      'card-diff.png': '',
      'card-actual.whydiff.json': '{}',
      'error-context.md': '',
    })
    await testDir(dir, 'matcher-named-failure-matcher-retry1', {
      'card-whydiff.md': HEADER_FIRST,
      [`attachments/whydiff-card-actual-${SHA}.json`]: '{}',
      'card-actual.png': '',
    })
    await testDir(dir, 'matcher-bare-matcher', {
      'bare-whydiff.md': PIXELS_ONLY,
      [`attachments/whydiff-bare-snapshot-actual-${SHA}.json`]: '{}',
      'bare-expected.png': '',
      'bare-actual.png': '',
    })
    await testDir(dir, 'matcher-passed-matcher', { 'trace.zip': '' })
    const { runs, skipped } = await listTestResults(dir)
    expect(skipped).toBe(0)
    expect(runs.map((r) => r.identity)).toEqual([
      {
        project: 'matcher',
        testId: 'matcher-bare-matcher',
        titles: ['bare'],
        file: 'tests/matcher.spec.ts',
        line: 34,
        repeat: 0,
      },
      {
        project: 'matcher',
        testId: 'matcher-named-failure-matcher',
        titles: ['without attachments > named failure'],
        file: 'tests/matcher.spec.ts',
        line: 20,
        repeat: 0,
      },
      {
        project: 'matcher',
        testId: 'matcher-named-failure-matcher',
        titles: ['without attachments > named failure'],
        file: 'tests/matcher.spec.ts',
        line: 20,
        repeat: 0,
      },
    ])
    const first = runs[1]
    expect(first?.attachments.map((a) => [a.name, a.contentType])).toEqual([
      ['whydiff/card/snapshot-actual', 'application/json'],
      ['whydiff/card/snapshot-expected', 'application/json'],
      ['whydiff/card/markdown', 'text/markdown'],
      ['card-actual.png', 'image/png'],
      ['card-diff.png', 'image/png'],
      ['card-expected.png', 'image/png'],
    ])
    expect(first?.attachments[0]?.path).toBe(
      join(
        dir,
        'matcher-named-failure-matcher',
        'attachments',
        `whydiff-card-snapshot-actual-${SHA}.json`
      )
    )
    expect(first?.attachments[2]?.path).toBe(
      join(dir, 'matcher-named-failure-matcher', 'card-whydiff.md')
    )
    expect(runs[2]?.attachments.map((a) => a.name)).toEqual([
      'whydiff/card/markdown',
      'card-actual.png',
    ])
  })

  it('lists the attempts of a test in the order they ran, the tenth retry after the second', async () => {
    const attempts = ['', '-retry1', '-retry10', '-retry2'].map((suffix) => `matcher-card${suffix}`)
    for (const name of attempts) await testDir(dir, name, { 'card-whydiff.md': MARKDOWN })
    const { runs } = await listTestResults(dir)
    expect(runs.map((r) => r.attachments[0]?.path)).toEqual(
      ['', '-retry1', '-retry2', '-retry10'].map((suffix) =>
        join(dir, `matcher-card${suffix}`, 'card-whydiff.md')
      )
    )
  })

  it('folds the retries of a test into it and keeps each repeat a test of its own, as Playwright names their directories', async () => {
    for (const suffix of ['', '-retry1', '-repeat1', '-retry1-repeat1']) {
      await testDir(dir, `matcher-card-matcher${suffix}`, { 'card-whydiff.md': MARKDOWN })
    }
    const { runs } = await listTestResults(dir)
    expect(runs.map((r) => [r.identity.testId, r.identity.repeat])).toEqual([
      ['matcher-card-matcher', 0],
      ['matcher-card-matcher-repeat1', 1],
      ['matcher-card-matcher', 0],
      ['matcher-card-matcher-repeat1', 1],
    ])
  })

  it("finds the project of a repeat's error context past its suffixes, and counts a skipped test once however often it ran", async () => {
    const context = [
      '# Test info',
      '',
      '- Name: tests/matcher.spec.ts >> past the limit >> capped one',
      '- Location: tests/matcher.spec.ts:41:3',
      '',
    ].join('\n')
    await testDir(dir, 'matcher-named-failure-matcher', { 'card-whydiff.md': MARKDOWN })
    await testDir(dir, 'matcher-capped-one-matcher-retry1-repeat2', {
      'card-whydiff.md': POINTER,
      'error-context.md': context,
    })
    for (const suffix of ['', '-retry1']) {
      await testDir(dir, `matcher-off-matcher${suffix}`, { 'card-diff.png': '' })
    }
    const { runs, skipped } = await listTestResults(dir)
    expect(runs.map((r) => [r.identity.project, r.identity.testId, r.identity.repeat])).toEqual([
      ['matcher', 'matcher-named-failure-matcher', 0],
      ['matcher', 'matcher-capped-one-matcher-repeat2', 2],
    ])
    expect(skipped).toBe(1)
  })

  it('reads a title and a file out of the code spans that keep their markup', async () => {
    await testDir(dir, 'matcher-marked-matcher', {
      'card-whydiff.md': [
        '# whydiff: `renders <ui-card> > card` | 1 cause | 0 unexplained regions',
        'compared: expected -> actual',
        'source: `tests/__main__/card.spec.ts`:7 | matcher | 800x600 px, 640 changed pixels | s1eeet9',
        '',
      ].join('\n'),
      'card-actual.png': '',
    })
    const { runs } = await listTestResults(dir)
    expect(runs.map((r) => r.identity)).toEqual([
      {
        project: 'matcher',
        testId: 'matcher-marked-matcher',
        titles: ['renders <ui-card>'],
        file: 'tests/__main__/card.spec.ts',
        line: 7,
        repeat: 0,
      },
    ])
  })

  it('skips a test whose Markdown header it cannot read, and counts it', async () => {
    await testDir(dir, 'matcher-odd-matcher', {
      'card-whydiff.md': '# something else\n',
      'card-actual.png': '',
    })
    expect(await listTestResults(dir)).toEqual({ runs: [], skipped: 1 })
  })

  it('reads the test from a description past a pointer to the run report', async () => {
    await testDir(dir, 'matcher-named-failure-matcher', {
      'banner-whydiff.md': POINTER,
      'card-whydiff.md': MARKDOWN,
      [`attachments/whydiff-banner-snapshot-actual-${SHA}.json`]: '{}',
      'banner-actual.png': '',
    })
    const { runs } = await listTestResults(dir)
    expect(runs.map((r) => r.identity.titles)).toEqual([['without attachments > named failure']])
    expect(runs[0]?.attachments.map((a) => a.name)).toEqual([
      'whydiff/banner/snapshot-actual',
      'whydiff/banner/markdown',
      'whydiff/card/markdown',
      'banner-actual.png',
    ])
  })

  it('counts a test with only pointers, or with a failed screenshot and no whydiff files, as skipped', async () => {
    await testDir(dir, 'matcher-capped-matcher', {
      'card-whydiff.md': POINTER,
      [`attachments/whydiff-card-snapshot-actual-${SHA}.json`]: '{}',
    })
    await testDir(dir, 'matcher-off-matcher', { 'card-actual.png': '', 'card-diff.png': '' })
    await testDir(dir, 'matcher-fresh-matcher', { 'fresh-actual.png': '' })
    expect(await listTestResults(dir)).toEqual({ runs: [], skipped: 2 })
  })

  it("reads a test whose pages only point to the run report from Playwright's error context, not from its directory name", async () => {
    const context = (name: string, line: number): string =>
      [
        '# Test info',
        '',
        `- Name: tests/matcher.spec.ts >> past the limit >> ${name}`,
        `- Location: e2e/tests/matcher.spec.ts:${String(line)}:3`,
        '',
      ].join('\n')
    await testDir(dir, 'matcher-named-failure-matcher', { 'card-whydiff.md': MARKDOWN })
    await testDir(dir, 'matcher-past-th-a1b2c-limit-capped-one-matcher-retry1', {
      'card-whydiff.md': POINTER,
      [`attachments/whydiff-card-snapshot-actual-${SHA}.json`]: '{}',
      'error-context.md': context('capped one', 41),
    })
    await testDir(dir, 'matcher-past-th-d3e4f-limit-capped-two-firefox', {
      'card-whydiff.md': POINTER,
      'error-context.md': context('capped two', 52),
    })
    const { runs, skipped } = await listTestResults(dir)
    expect(runs.map((r) => r.identity).slice(1)).toEqual([
      {
        project: 'matcher',
        testId: 'matcher-past-th-a1b2c-limit-capped-one-matcher',
        titles: ['past the limit', 'capped one'],
        file: 'tests/matcher.spec.ts',
        line: 41,
        repeat: 0,
      },
    ])
    expect(runs[1]?.attachments.map((a) => a.name)).toEqual([
      'whydiff/card/snapshot-actual',
      'whydiff/card/markdown',
    ])
    expect(skipped).toBe(1)
  })

  it('reads a test past the limit in a run whose one project has no name, as the default config runs', async () => {
    await testDir(dir, 'matcher-named-failure', {
      'card-whydiff.md': MARKDOWN.replace('| matcher |', '|  |'),
    })
    await testDir(dir, 'matcher-past-th-a1b2c-limit-capped-one', {
      'card-whydiff.md': POINTER,
      'error-context.md': [
        '# Test info',
        '',
        '- Name: tests/matcher.spec.ts >> past the limit >> capped one',
        '- Location: tests/matcher.spec.ts:41:3',
        '',
      ].join('\n'),
    })
    const { runs, skipped } = await listTestResults(dir)
    expect(runs.map((r) => r.identity)).toEqual([
      {
        project: '',
        testId: 'matcher-named-failure',
        titles: ['without attachments > named failure'],
        file: 'tests/matcher.spec.ts',
        line: 20,
        repeat: 0,
      },
      {
        project: '',
        testId: 'matcher-past-th-a1b2c-limit-capped-one',
        titles: ['past the limit', 'capped one'],
        file: 'tests/matcher.spec.ts',
        line: 41,
        repeat: 0,
      },
    ])
    expect(skipped).toBe(0)
  })

  it('reads a page whose source line names no project, as a test of the unnamed project writes it', async () => {
    await testDir(dir, 'matcher-named-failure', {
      'card-whydiff.md': MARKDOWN.replace('| matcher |', '|'),
    })
    const { runs } = await listTestResults(dir)
    expect(runs.map((r) => r.identity.project)).toEqual([''])
  })

  it('says for each failed screenshot that test-results keep no annotation', async () => {
    await testDir(dir, 'matcher-named-failure-matcher', {
      'card-whydiff.md': MARKDOWN,
      'card-diff.png': '',
      'banner-diff.png': '',
    })
    const { runs } = await listTestResults(dir)
    expect(runs[0]?.annotations).toEqual([
      {
        type: 'whydiff',
        description:
          'banner: not explained: rebuilt from test-results, which keep no annotation that says why',
      },
      {
        type: 'whydiff',
        description:
          'card: not explained: rebuilt from test-results, which keep no annotation that says why',
      },
    ])
  })

  it('reads the Markdown from the test directory, not from a copy Playwright made of it', async () => {
    await testDir(dir, 'matcher-copied-matcher', {
      [`attachments/whydiff-card-markdown-${SHA}.md`]: MARKDOWN,
      [`attachments/whydiff-card-snapshot-actual-${SHA}.json`]: '{}',
      'card-actual.png': '',
    })
    expect((await listTestResults(dir)).runs).toEqual([])
  })
})
