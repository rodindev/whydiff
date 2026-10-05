import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { parseSnapshot } from '@whydiff/core'

import { POINTER } from './cap.js'
import type { ManifestLine } from './output.js'
import { NO_BASELINE } from './pair.js'
import {
  attachmentText,
  only,
  pairAttachments,
  playwright,
  projectBrowsers,
  readTests,
  whydiffAnnotations,
  type Result,
  type Test,
} from './testing/project.js'

const dist = new URL('../dist/reporter.js', import.meta.url).pathname
const webkitInstalled = existsSync(projectBrowsers().webkit.executablePath())
// Far below the 30 s test timeout that a capture waiting on a missing element runs into.
const SHORT_MS = 10_000

describe('withWhydiff in a Playwright run', () => {
  let tmp: string
  let snapshots: string
  let written: string[]
  let first: Map<string, Test>
  let second: Map<string, Test>
  let manifest: ManifestLine[]
  let fullOutput: string

  beforeAll(async () => {
    if (!existsSync(dist)) throw new Error('build @whydiff/playwright first: pnpm build')
    tmp = await mkdtemp(join(tmpdir(), 'whydiff-matcher-'))
    snapshots = join(tmp, 'snapshots')
    const at = (name: string): string => join(tmp, name)
    const base = { WHYDIFF_FIXTURE_SNAPSHOTS: snapshots }
    const changed = { ...base, WHYDIFF_FIXTURE_VARIANT: 'changed' }
    const projects = ['matcher', 'reporter', ...(webkitInstalled ? ['webkit'] : [])]
    await playwright(['test', ...projects.flatMap((p) => ['--project', p]), '--update-snapshots'], {
      ...base,
      WHYDIFF_FIXTURE_OUTPUT: at('out-1'),
      WHYDIFF_FIXTURE_REPORT: at('first.json'),
    })
    first = await readTests(at('first.json'))
    written = (await readdir(join(snapshots, 'matcher.spec.ts'))).sort()
    for (const sidecar of [
      'matcher.spec.ts/negated',
      'matcher.spec.ts/backfill',
      'matcher.spec.ts/no-backfill',
      'matcher.spec.ts/bare',
      'reporter.spec.ts/bare',
    ]) {
      await rm(join(snapshots, `${sidecar}.whydiff.json`))
    }
    const shard = (index: number): Promise<string> =>
      playwright(['test', '--project', 'reporter', '--shard', `${String(index)}/2`], {
        ...changed,
        WHYDIFF_FIXTURE_OUTPUT: at(`out-shard-${String(index)}`),
        WHYDIFF_FIXTURE_REPORT: at(`shard-${String(index)}.json`),
        WHYDIFF_FIXTURE_WHYDIFF_REPORT: at('shards'),
        WHYDIFF_FIXTURE_BLOB: at(`blob-${String(index)}`),
      })
    await playwright(['test', '--project', 'matcher'], {
      ...changed,
      WHYDIFF_OUT: at('two-run'),
      WHYDIFF_FIXTURE_OUTPUT: at('out-2'),
      WHYDIFF_FIXTURE_REPORT: at('second.json'),
    })
    fullOutput = await playwright(['test', '--project', 'reporter'], {
      ...changed,
      WHYDIFF_FIXTURE_OUTPUT: at('out-full'),
      WHYDIFF_FIXTURE_REPORT: at('full.json'),
      WHYDIFF_FIXTURE_WHYDIFF_REPORT: at('full'),
    })
    await shard(1)
    await shard(2)
    second = await readTests(at('second.json'))
    manifest = (await readFile(at('two-run/manifest.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as ManifestLine) // written by recordCapture
    await mkdir(at('blobs'))
    for (const index of [1, 2]) {
      for (const zip of await readdir(at(`blob-${String(index)}`))) {
        await copyFile(join(at(`blob-${String(index)}`), zip), join(at('blobs'), zip))
      }
    }
    await playwright(['merge-reports', '--config', 'playwright.config.ts', at('blobs')], {
      WHYDIFF_FIXTURE_REPORT: at('merged.json'),
      WHYDIFF_FIXTURE_WHYDIFF_REPORT: at('merged'),
    })
  }, 300_000)

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  describe('baseline snapshots', () => {
    it('writes one next to every baseline under --update-snapshots, unnamed calls included', () => {
      expect(written).toEqual([
        'backfill.png',
        'backfill.whydiff.json',
        'bare.png',
        'bare.whydiff.json',
        'card.png',
        'card.whydiff.json',
        'disabled.png',
        'injected-pass.png',
        'injected.png',
        'negated.png',
        'negated.whydiff.json',
        'no-backfill.png',
        'no-backfill.whydiff.json',
        'over-budget.png',
        'soft.png',
        'soft.whydiff.json',
        'taller.png',
        'taller.whydiff.json',
        'unattached.png',
        'unattached.whydiff.json',
        'unnamed-calls-1.png',
        'unnamed-calls-1.whydiff.json',
        'unnamed-calls-2.png',
        'unnamed-calls-2.whydiff.json',
      ])
    })

    it('predicts the path of each unnamed call before the built-in runs', async () => {
      const read = async (name: string) =>
        parseSnapshot(await readFile(join(snapshots, 'matcher.spec.ts', name), 'utf8'))
      expect((await read('unnamed-calls-1.whydiff.json')).image).toMatchObject({ width: 200 })
      expect((await read('unnamed-calls-2.whydiff.json')).image).toMatchObject({ width: 40 })
      expect((await read('card.whydiff.json')).tool).not.toHaveProperty('capturedAfterMs')
    })

    it('backfills a missing one on a pass unless use.whydiff turns it off', () => {
      expect(existsSync(join(snapshots, 'matcher.spec.ts', 'backfill.whydiff.json'))).toBe(true)
      expect(existsSync(join(snapshots, 'matcher.spec.ts', 'no-backfill.whydiff.json'))).toBe(false)
    })

    it('writes one for a baseline the missing mode creates, and the test still fails', () => {
      const { result } = only(second, 'missing baseline')
      expect(result.status).toBe('failed')
      expect(result.errors[0]?.message).toMatch(/A snapshot doesn't exist at .*fresh\.png/)
      expect(existsSync(join(snapshots, 'matcher.spec.ts', 'fresh.whydiff.json'))).toBe(true)
    })

    it('does nothing when switched off or over the budget', () => {
      const { test } = only(first, 'over budget')
      expect(whydiffAnnotations(only(first, 'disabled').test)).toEqual([])
      expect(whydiffAnnotations(test)).toEqual([
        expect.stringMatching(
          /^over-budget\.png baseline snapshot not kept: skipped after \d+ ms, over the budget of 0 ms\./
        ),
      ])
    })
  })

  describe('a failed screenshot', () => {
    it('keeps the built-in verdict and adds the Markdown and both snapshots', async () => {
      const { result } = only(second, 'named failure')
      expect(result.status).toBe('failed')
      expect(result.errors[0]?.message).toContain('pixels (ratio')
      expect(result.attachments.map((a) => a.name)).toEqual(
        expect.arrayContaining(['card-expected.png', 'card-actual.png', 'card-diff.png'])
      )
      expect(pairAttachments(result)).toEqual([
        'whydiff/card/markdown text/markdown',
        'whydiff/card/snapshot-actual application/json',
        'whydiff/card/snapshot-expected application/json',
      ])
      const attached = result.attachments.find((a) => a.name === 'whydiff/card/markdown')
      expect(attached?.body).toEqual(expect.any(String))
      expect(attached?.path).toBeUndefined()
      const markdown = await attachmentText(result, 'whydiff/card/markdown')
      expect(markdown).toMatch(/\n# whydiff: named failure > card \| 1 cause \| 0 unexplained/)
      expect(markdown).toMatch(/\nsource: matcher\.spec\.ts:\d+ \| [^\n]+ \| s[0-9a-z]{6}\n/)
      await expect(markdown).toMatchFileSnapshot('../fixtures/golden/card-whydiff.md')
      const actual = parseSnapshot(await attachmentText(result, 'whydiff/card/snapshot-actual'))
      expect(actual.tool.capturedAfterMs).toBeGreaterThanOrEqual(0)
    })

    it('says what changed in one annotation and after the pixel count of the message, the status kept', () => {
      const { test, result } = only(second, 'named failure')
      const line = 'a <div> is 24 px wider (was 200, now 224) (c61lcoz)'
      expect(result.status).toBe('failed')
      expect(whydiffAnnotations(test)).toEqual([line])
      const message = stripVTControlCharacters(result.errors[0]?.message ?? '')
      expect(message.split('\n', 1)[0]).toMatch(/toHaveScreenshot\(expected\)/)
      expect(message).toContain(
        ' are different.\n\n  whydiff, expected -> actual:\n  - a <div> is 24 px wider (was 200, now 224)\n\n'
      )
      expect(message.indexOf('whydiff, expected')).toBeLessThan(message.indexOf('Call log:'))
      for (const title of ['backfill on a pass', 'unnamed calls', 'negated on a mismatch']) {
        expect(whydiffAnnotations(only(second, title).test)).toEqual([])
      }
    })

    it('says why a failed screenshot it finds unchanged is so, in its annotation, the message and the page', async () => {
      const { test, result } = only(second, 'taller by a blank strip')
      const line =
        'the screenshot was 800x600 px, now 800x740 px: the 480,000 pixels both cover are unchanged and the area only one covers is blank'
      expect(result.status).toBe('failed')
      expect(whydiffAnnotations(test)).toEqual([line])
      expect(stripVTControlCharacters(result.errors[0]?.message ?? '')).toContain(
        `\n\n  whydiff, expected -> actual:\n  - ${line}\n`
      )
      expect(await attachmentText(result, 'whydiff/taller/markdown')).toContain(
        `\nT${line.slice(1)}.\n`
      )
    })

    it('describes the pixels alone when no baseline snapshot exists', async () => {
      const { result } = only(second, 'no baseline snapshot')
      expect(pairAttachments(result)).toEqual([
        'whydiff/bare/markdown text/markdown',
        'whydiff/bare/snapshot-actual application/json',
      ])
      const markdown = await attachmentText(result, 'whydiff/bare/markdown')
      expect(markdown).toContain(`\n${NO_BASELINE}\n\n## Changed regions (`)
      expect(whydiffAnnotations(only(second, 'no baseline snapshot').test)).toEqual([NO_BASELINE])
      expect(result.errors[0]?.message).toContain(`\n  - ${NO_BASELINE}\n`)
    })

    it('keeps the test running under expect.soft', () => {
      const { test, result } = only(second, 'soft failure keeps the test running')
      expect(result.status).toBe('failed')
      expect(test.annotations.map((a) => a.type)).toContain('reached')
      expect(pairAttachments(result)).toContain('whydiff/soft/markdown text/markdown')
    })

    it('passes .not on a mismatch and writes nothing', () => {
      const { result } = only(second, 'negated on a mismatch')
      expect(result.status).toBe('passed')
      expect(pairAttachments(result)).toEqual([])
      expect(existsSync(join(snapshots, 'matcher.spec.ts', 'negated.whydiff.json'))).toBe(false)
    })

    it('writes the files but attaches nothing when use.whydiff.attach is false', async () => {
      const { result } = only(second, 'unattached failure')
      expect(result.status).toBe('failed')
      expect(pairAttachments(result)).toEqual([])
      const dir = await readdir(
        join(tmp, 'out-2', 'matcher-without-attachments-unattached-failure-matcher')
      )
      expect(dir).toEqual(
        expect.arrayContaining(['unattached-actual.whydiff.json', 'unattached-whydiff.md'])
      )
    })

    it('reports an errored call at the line of the test', () => {
      const { test, result } = only(second, 'errored call')
      expect(result.status).toBe('failed')
      expect(result.errors[0]?.message).toContain('Screenshot name "no-extension" must have')
      expect(result.errors[0]?.location?.file).toMatch(/matcher\.spec\.ts$/)
      expect(whydiffAnnotations(test)).toEqual([])
    })
  })

  describe('a capture that fails', () => {
    it('leaves the result of a failing assertion as the built-in made it', () => {
      const { test, result } = only(second, 'injected failure on a mismatch')
      expect(result.status).toBe('failed')
      expect(result.errors[0]?.message).toContain('pixels (ratio')
      expect(result.attachments.map((a) => a.name)).toEqual(
        expect.arrayContaining([
          'injected-expected.png',
          'injected-actual.png',
          'injected-diff.png',
        ])
      )
      expect(pairAttachments(result)).toEqual([])
      expect(whydiffAnnotations(test)).toContainEqual(
        expect.stringMatching(/^injected: not explained: ENOENT/)
      )
    })

    it('leaves a passing assertion passing and warns once per worker', () => {
      for (const run of [first, second]) {
        const { test, result } = only(run, 'injected failure on a pass')
        expect(result.status).toBe('passed')
        expect(whydiffAnnotations(test)).toContainEqual(
          expect.stringMatching(/^injected-pass\.png baseline snapshot not kept: ENOENT/)
        )
      }
      const warnings = [...first.values()]
        .flatMap((t) => t.results.flatMap((r) => r.stderr.map((s) => s.text ?? '')))
        .filter((text) => text.startsWith('whydiff: '))
      expect(warnings).toEqual([
        expect.stringMatching(/^whydiff: injected\.png baseline snapshot not kept: ENOENT/),
      ])
    })
  })

  it('records every call except an errored one in two-run mode, with the PNG the built-in compared', async () => {
    expect(manifest.map((l) => [l.title, l.name, l.snapshot !== null, l.png !== null])).toEqual([
      ['named failure', 'card', true, true],
      ['unnamed calls', 'screenshot', true, true],
      ['unnamed calls', 'screenshot', true, true],
      ['negated on a mismatch', 'negated', true, true],
      ['soft failure keeps the test running', 'soft', true, true],
      ['backfill on a pass', 'backfill', true, true],
      ['without backfill > no backfill on a pass', 'no-backfill', true, true],
      ['missing baseline', 'fresh', true, true],
      ['no baseline snapshot', 'bare', true, true],
      [
        'with a style path that does not exist > injected failure on a mismatch',
        'injected',
        false,
        true,
      ],
      [
        'with a style path that does not exist > injected failure on a pass',
        'injected-pass',
        false,
        true,
      ],
      ['without attachments > unattached failure', 'unattached', true, true],
      ['without a budget > over budget', 'over-budget', true, true],
      ['taller by a blank strip', 'taller', true, true],
    ])
    const recorded = (line: ManifestLine | undefined): Promise<Buffer> =>
      readFile(join(tmp, 'two-run', line?.png ?? ''))
    const actual = only(second, 'named failure').result.attachments.find(
      (a) => a.name === 'card-actual.png'
    )?.path
    if (actual === undefined) throw new Error('no actual attached')
    expect(await recorded(manifest[0])).toEqual(await readFile(actual))
    const unnamed = manifest.filter((l) => l.title === 'unnamed calls')
    for (const [index, line] of unnamed.entries()) {
      expect(await recorded(line)).toEqual(
        await readFile(join(snapshots, 'matcher.spec.ts', `unnamed-calls-${String(index + 1)}.png`))
      )
    }
  })

  it("records a failed call under the name of the built-in's images, which the run's reporter keys it by", () => {
    expect(manifest.map((l) => [l.title, l.failedName])).toEqual([
      ['named failure', 'card'],
      ['unnamed calls', undefined],
      ['unnamed calls', undefined],
      ['negated on a mismatch', undefined],
      ['soft failure keeps the test running', 'soft'],
      ['backfill on a pass', undefined],
      ['without backfill > no backfill on a pass', undefined],
      // The built-in wrote the baseline and passed the assertion; the test fails on its soft error.
      ['missing baseline', undefined],
      ['no baseline snapshot', 'bare'],
      ['with a style path that does not exist > injected failure on a mismatch', 'injected'],
      ['with a style path that does not exist > injected failure on a pass', undefined],
      ['without attachments > unattached failure', 'unattached'],
      ['without a budget > over budget', undefined],
      ['taller by a blank strip', 'taller'],
    ])
    for (const line of manifest.filter((l) => l.failedName !== undefined)) {
      const { result } = only(second, line.title.split(' > ').at(-1) ?? '')
      expect(result.attachments.map((a) => a.name)).toContain(`${line.failedName ?? ''}-actual.png`)
    }
  })

  it.skipIf(!webkitInstalled)('annotates a test in another browser once', () => {
    expect(whydiffAnnotations(only(first, 'another browser').test)).toEqual([
      'webkit screenshots are not explained: whydiff captures in Chromium only',
    ])
  })

  describe('the reporter', () => {
    const read = (dir: string, file: string): Promise<string> =>
      readFile(join(tmp, dir, file), 'utf8')

    it('clusters the run, lists passed screenshots and pairs without a baseline snapshot', async () => {
      const markdown = await read('full', 'report.md')
      expect(markdown).toMatch(
        /^# whydiff: 2 of 3 screenshots changed \| 1 cause \| 0 unexplained regions\n/
      )
      expect(markdown).toMatch(
        /\n## [^\n]+, on all 2 changed screenshots, 100% of changed pixels \(`\.banner`, c[0-9a-z]{6}\)\n/
      )
      expect(markdown).toContain(
        `\n## No baseline snapshot (1)\n${NO_BASELINE}\n- bare > bare | reporter.spec.ts:`
      )
      const files = await readdir(join(tmp, 'full', 'screenshots'))
      const pages = await Promise.all(files.map((file) => read('full', `screenshots/${file}`)))
      expect(pages.some((page) => page.includes('\n# whydiff: header > header |'))).toBe(true)
      expect(markdown).toMatch(
        /\n## Not explained \(1\)\n.+\n- switched off > unexplained > unexplained \| reporter\.spec\.ts:\d+ \| reporter \| expect\(page\)\.toHaveScreenshot\(expected\)(?: failed)?: [\d,]+ pixels \(ratio [\d.]+ of all image pixels\) are different\.\n$/
      )
      expect(fullOutput).toContain(
        'whydiff: 2 of 3 screenshots changed, 1 more without a baseline snapshot, 1 more failed but not explained\n'
      )
      expect(fullOutput).toContain('whydiff: 1 cause, 0 unexplained regions\n')
    })

    it('writes the same report from two merged shards as from one run', async () => {
      expect(await read('merged', 'report.md')).toBe(await read('full', 'report.md'))
      expect(await read('merged', 'report.json')).toBe(await read('full', 'report.json'))
    })

    it('names the files of an unmerged shard after it', async () => {
      const shards = (await readdir(join(tmp, 'shards'))).sort()
      expect(shards).toEqual(
        expect.arrayContaining([
          'report.shard-1-of-2.md',
          'report.shard-2-of-2.md',
          'report.shard-1-of-2.json',
        ])
      )
      expect(await read('shards', 'report.shard-2-of-2.md')).toMatch(/^# whydiff: /)
    })
  })
})

describe('a run with more failures than in-test explanations', () => {
  let tmp: string
  let snapshots: string
  let first: Map<string, Test>
  let second: Map<string, Test>
  let unreported: Map<string, Test>
  let report: string
  let screenshots: string[]
  let output: string

  beforeAll(async () => {
    if (!existsSync(dist)) throw new Error('build @whydiff/playwright first: pnpm build')
    tmp = await mkdtemp(join(tmpdir(), 'whydiff-run-'))
    snapshots = join(tmp, 'snapshots')
    const at = (name: string): string => join(tmp, name)
    const projects = ['--project', 'cap', '--project', 'overhead']
    await playwright(['test', ...projects, '--update-snapshots'], {
      WHYDIFF_FIXTURE_SNAPSHOTS: snapshots,
      WHYDIFF_FIXTURE_OUTPUT: at('out-1'),
      WHYDIFF_FIXTURE_REPORT: at('first.json'),
    })
    first = await readTests(at('first.json'))
    output = await playwright(['test', ...projects, '--workers', '2'], {
      WHYDIFF_FIXTURE_SNAPSHOTS: snapshots,
      WHYDIFF_FIXTURE_VARIANT: 'changed',
      WHYDIFF_FIXTURE_OUTPUT: at('out-2'),
      WHYDIFF_FIXTURE_REPORT: at('second.json'),
      WHYDIFF_FIXTURE_WHYDIFF_REPORT: at('report'),
    })
    second = await readTests(at('second.json'))
    await playwright(['test', '--project', 'cap', '--workers', '2'], {
      WHYDIFF_FIXTURE_SNAPSHOTS: snapshots,
      WHYDIFF_FIXTURE_VARIANT: 'changed',
      WHYDIFF_FIXTURE_OUTPUT: at('out-3'),
      WHYDIFF_FIXTURE_REPORT: at('unreported.json'),
    })
    unreported = await readTests(at('unreported.json'))
    report = await readFile(at('report/report.md'), 'utf8')
    const files = await readdir(at('report/screenshots'))
    screenshots = await Promise.all(
      files.map((file) => readFile(join(at('report/screenshots'), file), 'utf8'))
    )
  }, 300_000)

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('adds its own time to the test timeout, so a capture longer than the test passes', () => {
    for (const title of [
      'slow capture through the matcher',
      'slow capture through the explicit call',
    ]) {
      const { test, result } = only(first, title)
      expect(result.status).toBe('passed')
      expect(whydiffAnnotations(test)).toEqual([])
    }
    const sidecars = ['slow-matcher', 'slow-explicit'].map((name) =>
      existsSync(join(snapshots, 'overhead.spec.ts', `${name}.whydiff.json`))
    )
    expect(sidecars).toEqual([true, true])
  })

  it('opens no CDP session for a pass whose baseline snapshot exists', () => {
    for (const title of ['pass through the matcher', 'pass through the explicit call']) {
      expect(only(first, title).test.annotations).toContainEqual({
        type: 'cdp-sessions',
        description: '1',
      })
      const { test, result } = only(second, title)
      expect(result.status).toBe('passed')
      expect(test.annotations).toContainEqual({ type: 'cdp-sessions', description: '0' })
    }
  })

  it('keeps a passing assertion in a hook or a fixture teardown passing', () => {
    for (const run of [first, second]) {
      for (const title of ['pass in an afterEach hook', 'pass in a fixture teardown']) {
        const { test, result } = only(run, title)
        expect(result.status).toBe('passed')
        expect(whydiffAnnotations(test)).toEqual([])
      }
    }
  })

  it('explains one failure in its test across two workers and points the others to the report', async () => {
    const runs = ['first', 'second', 'third'].map((title) => only(second, title))
    const results = runs.map((r) => r.result)
    expect(results.map((r) => r.status)).toEqual(['failed', 'failed', 'failed'])
    expect(new Set(results.map((r) => r.parallelIndex)).size).toBe(2)
    for (const r of results) {
      expect(pairAttachments(r).map((a) => a.replace(/^whydiff\/\w+\//, ''))).toEqual([
        'markdown text/markdown',
        'snapshot-actual application/json',
        'snapshot-expected application/json',
      ])
      const markdown = r.attachments.find((a) => a.name.endsWith('/markdown'))
      expect(markdown?.body).toEqual(expect.any(String))
      expect(markdown?.path).toBeUndefined()
    }
    const texts = await Promise.all(results.map(markdownOf))
    expect(texts.filter((text) => text.startsWith('# whydiff: '))).toHaveLength(1)
    const pointers = texts.filter((text) => !text.startsWith('# whydiff: '))
    const pages = pointers.map((text) => pointedAt(text, join(tmp, 'report')))
    expect(pages.map((page) => page.split(' | ')[0]).sort()).toEqual(
      ['first', 'second', 'third']
        .filter((title) => !texts.some((text) => text.startsWith(`# whydiff: ${title} > `)))
        .map((title) => `# whydiff: ${title} > ${title}`)
    )
    const annotations = runs.map((r) => whydiffAnnotations(r.test))
    const pointing = (line: string): boolean => line.startsWith(POINTER)
    expect(annotations.map((a) => a.length)).toEqual([1, 1, 1])
    expect(annotations.flat().filter(pointing)).toEqual(
      pointers.map((text) => text.split('\n', 1)[0] ?? '')
    )
    expect(annotations.flat().filter((line) => !pointing(line))).toEqual([
      expect.stringMatching(
        /^the column-gap and row-gap properties of 1 element changed \(c[0-9a-z]{6}\)$/
      ),
    ])
    expect([...annotations.flat(), ...pointers].join('\n')).not.toMatch(/maxExplained|limit|used/)
  })

  it('explains every failure in its test when the run has no whydiff reporter', () => {
    const results = ['first', 'second', 'third'].map((title) => only(unreported, title).result)
    expect(results.map((r) => r.status)).toEqual(['failed', 'failed', 'failed'])
    expect(
      results.map((r) => pairAttachments(r).some((a) => a.endsWith('/markdown text/markdown')))
    ).toEqual([true, true, true])
  })

  it('explains all three in the report, the ones past the cap included', () => {
    expect(report).toMatch(
      /^# whydiff: 3 of 10 screenshots changed \| 1 cause \| 0 unexplained regions\n/
    )
    expect(report).toMatch(
      /, on all 3 changed screenshots, 100% of changed pixels \(`\.row`, c[0-9a-z]{6}\)\n/
    )
    expect(screenshots.map((page) => page.split(' | ')[0]).sort()).toEqual([
      '# whydiff: first > first',
      '# whydiff: second > second',
      '# whydiff: third > third',
    ])
  })

  it('lists a failure whose capture failed under Not explained with the reason, and counts it', () => {
    expect(report).toMatch(
      /\n## Not explained \(1\)\n.+\n- with a style path that does not exist > injected failure > injected \| cap\.spec\.ts:\d+ \| cap \| ENOENT: no such file or directory, open '.*missing\.css'\n$/
    )
    expect(output).toContain(
      'whydiff: 3 of 10 screenshots changed, 1 more failed but not explained\n'
    )
  })
})

describe('every failure of a run accounted for', () => {
  let tmp: string
  let snapshots: string
  let first: Map<string, Test>
  let second: Map<string, Test>
  let twoRun: Map<string, Test>
  let manifest: ManifestLine[]
  let report: string
  let output: string

  beforeAll(async () => {
    if (!existsSync(dist)) throw new Error('build @whydiff/playwright first: pnpm build')
    tmp = await mkdtemp(join(tmpdir(), 'whydiff-failures-'))
    snapshots = join(tmp, 'snapshots')
    const at = (name: string): string => join(tmp, name)
    await playwright(['test', '--project', 'failures', '--update-snapshots'], {
      WHYDIFF_FIXTURE_SNAPSHOTS: snapshots,
      WHYDIFF_FIXTURE_OUTPUT: at('out-1'),
      WHYDIFF_FIXTURE_REPORT: at('first.json'),
    })
    first = await readTests(at('first.json'))
    output = await playwright(['test', '--project', 'failures', '--update-snapshots=none'], {
      WHYDIFF_FIXTURE_SNAPSHOTS: snapshots,
      WHYDIFF_FIXTURE_VARIANT: 'changed',
      WHYDIFF_FIXTURE_OUTPUT: at('out-2'),
      WHYDIFF_FIXTURE_REPORT: at('second.json'),
      WHYDIFF_FIXTURE_WHYDIFF_REPORT: at('report'),
    })
    second = await readTests(at('second.json'))
    report = await readFile(at('report/report.md'), 'utf8')
    await playwright(
      ['test', '--project', 'failures', '--grep', 'missing locator', '--update-snapshots=none'],
      {
        WHYDIFF_FIXTURE_SNAPSHOTS: snapshots,
        WHYDIFF_FIXTURE_VARIANT: 'changed',
        WHYDIFF_OUT: at('two-run'),
        WHYDIFF_FIXTURE_OUTPUT: at('out-3'),
        WHYDIFF_FIXTURE_REPORT: at('two-run.json'),
      }
    )
    twoRun = await readTests(at('two-run.json'))
    manifest = (await readFile(at('two-run/manifest.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as ManifestLine) // written by recordCapture
  }, 300_000)

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('takes one in-test explanation for a toPass loop that fails three times', async () => {
    const { test, result } = only(second, 'retried in a loop')
    expect(result.status).toBe('failed')
    expect(whydiffAnnotations(test)).toEqual([
      'the column-gap and row-gap properties of 1 element changed (c2iwj2e)',
      expect.stringMatching(/^The explanation of this screenshot is in .+\/s[0-9a-z]{6}\.md\.$/),
    ])
    const names = ['loop', 'loop-1', 'loop-2', 'after']
    expect(pairAttachments(result).filter((a) => a.includes('/markdown '))).toEqual(
      names.map((name) => `whydiff/${name}/markdown text/markdown`)
    )
    const texts = await Promise.all(
      names.map((name) => attachmentText(result, `whydiff/${name}/markdown`))
    )
    expect(texts.slice(0, 3).map((text) => text.split(' | ')[0])).toEqual([
      '# whydiff: retried in a loop > loop',
      '# whydiff: retried in a loop > loop-1',
      '# whydiff: retried in a loop > loop-2',
    ])
    expect(pointedAt(texts[3] ?? '', join(tmp, 'report'))).toMatch(
      /^# whydiff: retried in a loop > after \| /
    )
  })

  it('lists every failure without an actual image with its reason, and counts it', () => {
    for (const title of ['missing locator', 'missing locator through the explicit call']) {
      const { test, result } = only(second, title)
      expect(result.status).toBe('failed')
      expect(result.duration).toBeLessThan(SHORT_MS)
      expect(pairAttachments(result)).toEqual([])
      expect(whydiffAnnotations(test)).toContainEqual(
        expect.stringMatching(
          /^(explicit-)?row: not explained: the assertion produced no actual image \((expect\(locator\)\.toHaveScreenshot\(expected\) failed: Timeout 500ms exceeded\.|Timed out 500ms waiting for expect\(locator\)\.toHaveScreenshot\(expected\))\)$/
        )
      )
    }
    expect(only(second, 'baseline never written').result.status).toBe('failed')
    const notExplained = report.slice(report.indexOf('\n## Not explained')).split('\n')
    expect(notExplained.slice(0, 2)).toEqual(['', '## Not explained (4)'])
    expect(notExplained.slice(3)).toEqual([
      expect.stringMatching(
        /^- missing locator > row \| failures\.spec\.ts:\d+ \| failures \| the assertion produced no actual image \((expect\(locator\)\.toHaveScreenshot\(expected\) failed: Timeout 500ms exceeded\.|Timed out 500ms waiting for expect\(locator\)\.toHaveScreenshot\(expected\))\)$/
      ),
      expect.stringMatching(
        /^- missing locator through the explicit call > explicit-row \| failures\.spec\.ts:\d+ \| failures \| the assertion produced no actual image \((expect\(locator\)\.toHaveScreenshot\(expected\) failed: Timeout 500ms exceeded\.|Timed out 500ms waiting for expect\(locator\)\.toHaveScreenshot\(expected\))\)$/
      ),
      expect.stringMatching(
        /^- baseline never written \| failures\.spec\.ts:\d+ \| failures \| A snapshot doesn't exist at .*never\.png\.$/
      ),
      expect.stringMatching(
        /^- without attachments > unattached > unattached \| failures\.spec\.ts:\d+ \| failures \| expect\(page\)\.toHaveScreenshot\(expected\)(?: failed)?: /
      ),
      '',
    ])
    expect(output).toMatch(
      /\nwhydiff: \d+ of \d+ screenshots? changed, 4 more failed but not explained\n/
    )
  })

  it('skips the capture of a locator that matches nothing in two-run mode, and the test still fails fast', () => {
    const reason =
      "locator('.ui-missing') matches no element, and whydiff does not wait for one. Make it match the one element the screenshot shows."
    for (const title of ['missing locator', 'missing locator through the explicit call']) {
      const { test, result } = only(twoRun, title)
      expect(result.status).toBe('failed')
      expect(result.duration).toBeLessThan(SHORT_MS)
      expect(whydiffAnnotations(test)).toEqual([
        `snapshot 1 not captured: ${reason}`,
        ...whydiffAnnotations(only(second, title).test),
      ])
    }
    expect(manifest.map((l) => [l.title, l.snapshot, l.error])).toEqual([
      ['missing locator', null, reason],
      ['missing locator through the explicit call', null, reason],
    ])
  })

  it('records no PNG for a failure without an actual image, through the matcher and the explicit call', () => {
    expect(manifest.map((l) => [l.title, l.png])).toEqual([
      ['missing locator', null],
      ['missing locator through the explicit call', null],
    ])
  })

  it("records a failure without an actual image under the name of its expected image, which the run's reporter keys it by", () => {
    expect(manifest.map((l) => [l.title, l.failedName])).toEqual([
      ['missing locator', 'row'],
      ['missing locator through the explicit call', 'explicit-row'],
    ])
    for (const line of manifest) {
      const names = only(twoRun, line.title).result.attachments.map((a) => a.name)
      expect(names).toContain(`${line.failedName ?? ''}-expected.png`)
      expect(names).not.toContain(`${line.failedName ?? ''}-actual.png`)
    }
  })

  it('skips the capture of a locator gone after the assertion, and the test keeps its pass', () => {
    for (const run of [first, second]) {
      const { test, result } = only(run, 'locator gone before the capture')
      expect(result.status).toBe('passed')
      expect(result.duration).toBeLessThan(SHORT_MS)
      expect(whydiffAnnotations(test)).toEqual([
        "gone.png baseline snapshot not kept: locator('.ui-row') matches no element, and whydiff does not wait for one. Make it match the one element the screenshot shows.",
      ])
    }
  })

  it('never claims an in-test explanation when use.whydiff.attach is false', async () => {
    const { test, result } = only(second, 'unattached')
    expect(result.status).toBe('failed')
    expect(pairAttachments(result)).toEqual([])
    expect(whydiffAnnotations(test)).toEqual([
      'the column-gap and row-gap properties of 1 element changed (c2iwj2e)',
    ])
    const markdown = await readFile(
      join(
        tmp,
        'out-2',
        'failures-without-attachments-unattached-failures',
        'unattached-whydiff.md'
      ),
      'utf8'
    )
    expect(markdown).toMatch(/^# whydiff: without attachments > unattached > unattached \| /)
  })

  it('hands the workers a run directory only the reporter creates, and removes it at the end', () => {
    const runDir = (run: Map<string, Test>): string =>
      only(run, 'the run directory of the reporter').test.annotations.find(
        (a) => a.type === 'run-dir'
      )?.description ?? ''
    expect(runDir(first)).toBe('')
    expect(runDir(second).startsWith(join(tmpdir(), 'whydiff-'))).toBe(true)
    expect(existsSync(runDir(second))).toBe(false)
  })
})

describe('a run whose tests are retried or time out', () => {
  let tmp: string
  let tests: Map<string, Test>
  let report: string
  let pages: string[]
  let output: string
  const at = (...names: string[]): string => join(tmp, ...names)

  beforeAll(async () => {
    if (!existsSync(dist)) throw new Error('build @whydiff/playwright first: pnpm build')
    tmp = await mkdtemp(join(tmpdir(), 'whydiff-attempts-'))
    const projects = ['--project', 'retries', '--project', 'timeouts']
    await playwright(['test', ...projects, '--update-snapshots'], {
      WHYDIFF_FIXTURE_SNAPSHOTS: at('snapshots'),
      WHYDIFF_FIXTURE_OUTPUT: at('out-1'),
      WHYDIFF_FIXTURE_REPORT: at('first.json'),
    })
    output = await playwright(['test', ...projects], {
      WHYDIFF_FIXTURE_SNAPSHOTS: at('snapshots'),
      WHYDIFF_FIXTURE_VARIANT: 'changed',
      WHYDIFF_FIXTURE_OUTPUT: at('out-2'),
      WHYDIFF_FIXTURE_REPORT: at('second.json'),
      WHYDIFF_FIXTURE_WHYDIFF_REPORT: at('report'),
    })
    tests = await readTests(at('second.json'))
    report = await readFile(at('report', 'report.md'), 'utf8')
    const files = (await readdir(at('report', 'screenshots'))).sort()
    pages = await Promise.all(
      files.map((file) => readFile(at('report', 'screenshots', file), 'utf8'))
    )
  }, 300_000)

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('runs each retried test twice, as the fixture means to', () => {
    const statuses = (title: string): string[] =>
      tests.get(title)?.results.map((r) => r.status) ?? []
    expect(
      [
        'timed out',
        'passed on retry',
        'another difference on retry',
        'a retry that reaches only the first screenshot',
      ].map(statuses)
    ).toEqual([
      ['failed', 'timedOut'],
      ['failed', 'passed'],
      ['failed', 'failed'],
      ['failed', 'failed'],
    ])
  })

  it('keeps every screenshot as the last attempt that failed it left it, those a retry passed or never reached included', () => {
    expect(report).toMatch(/^# whydiff: 5 of 5 screenshots changed \| 1 cause \| /)
    expect(output).toContain(
      'whydiff: 5 of 5 screenshots changed, 2 more failed but not explained\n'
    )
    expect(pages.map((page) => page.split(' | ')[0]).sort()).toEqual([
      '# whydiff: a retry that reaches only the first screenshot > first',
      '# whydiff: a retry that reaches only the first screenshot > second',
      '# whydiff: a retry that times out before its screenshot > timed out > timed-out',
      '# whydiff: another difference on retry > other',
      '# whydiff: passed on retry > flaky',
    ])
    const other = pages.find((page) => page.startsWith('# whydiff: another difference on retry'))
    expect(other).toContain('now 20px')
  })

  it('writes the run page back to the attempt the report took each screenshot from', async () => {
    /** The page an attempt wrote next to its actual image of `name`. */
    const copy = (title: string, retry: number, name: string): Promise<string> => {
      const actual = tests
        .get(title)
        ?.results[retry]?.attachments.find((a) => a.name === `${name}-actual.png`)?.path
      if (actual === undefined) throw new Error(`no actual image of ${name}`)
      return readFile(actual.replace(/-actual\.png$/, '-whydiff.md'), 'utf8')
    }
    const partial = 'a retry that reaches only the first screenshot'
    const written = await Promise.all([
      copy('timed out', 0, 'timed-out'),
      copy('passed on retry', 0, 'flaky'),
      copy('another difference on retry', 1, 'other'),
      copy(partial, 1, 'first'),
      copy(partial, 0, 'second'),
    ])
    expect(written.filter((text) => pages.includes(text))).toHaveLength(5)
    const superseded = await copy('another difference on retry', 0, 'other')
    expect(pages).not.toContain(superseded)
    expect(superseded).toContain('now 12px')
  })

  it("gives a screenshot the test's own timeout as the reason when the test timed out during it", () => {
    for (const title of [
      'timed out in its screenshot',
      'timed out in its screenshot through the explicit call',
    ]) {
      const { result } = only(tests, title)
      expect(result.status).toBe('timedOut')
      expect(result.errors.length).toBeGreaterThan(1)
    }
    expect(report.slice(report.indexOf('\n## Not explained')).split('\n').slice(3)).toEqual([
      expect.stringMatching(
        /^- timed out in its screenshot \| timeouts\.spec\.ts:\d+ \| timeouts \| Test timeout of 2000ms exceeded\.$/
      ),
      expect.stringMatching(
        /^- timed out in its screenshot through the explicit call \| timeouts\.spec\.ts:\d+ \| timeouts \| Test timeout of 2000ms exceeded\.$/
      ),
      '',
    ])
  })
})

/** The Markdown attachment of the first screenshot whydiff attached to a result. */
async function markdownOf(result: Result): Promise<string> {
  const name = result.attachments.find((a) => a.name.endsWith('/markdown'))?.name
  if (name === undefined) throw new Error('no Markdown attached')
  return attachmentText(result, name)
}

/** Checks the three lines a test past the run's cap of 1 holds in place of its Markdown and reads the page they point to. */
function pointedAt(text: string, reportDir: string): string {
  const [where = '', why, reassurance, end] = text.split('\n')
  const path = where.slice(POINTER.length, -1)
  expect(where).toBe(`${POINTER}${path}.`)
  // The path is relative to the config directory; on macOS a temporary one may sit behind /private.
  expect(path.endsWith(`/${basename(reportDir)}/screenshots/${basename(path)}`)).toBe(true)
  expect(basename(path)).toMatch(/^s[0-9a-z]{6}\.md$/)
  expect([why, reassurance, end]).toEqual([
    'The reporter writes it there when the run ends, because this project has more failed screenshots in the run than whydiff explains inside their tests.',
    'Nothing failed in whydiff.',
    '',
  ])
  return readFileSync(join(reportDir, 'screenshots', basename(path)), 'utf8')
}
