import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { parseSnapshot } from '@whydiff/core'

import { stampOf, type FileStamp } from './outcome.js'
import type { ManifestLine } from './output.js'
import { NO_BASELINE } from './pair.js'
import {
  attachmentText,
  only,
  pairAttachments,
  playwright,
  project as fixtureProject,
  readTests,
  whydiffAnnotations,
  type Test,
} from './testing/project.js'

const run = promisify(execFile)
const require = createRequire(import.meta.url)
const project = new URL('../fixtures/project/', import.meta.url).pathname
const dist = new URL('../dist/index.js', import.meta.url).pathname

interface Report {
  readonly suites: readonly {
    readonly specs: readonly {
      readonly title: string
      readonly tests: readonly {
        readonly results: readonly { readonly status: string }[]
        readonly annotations: readonly { readonly type: string; readonly description?: string }[]
      }[]
    }[]
  }[]
}

describe('whydiffCapture in a Playwright run', { timeout: 120_000 }, () => {
  let out: string
  let manifest: ManifestLine[]
  let report: Report

  beforeAll(async () => {
    if (!existsSync(dist)) throw new Error('build @whydiff/playwright first: pnpm build')
    out = await mkdtemp(join(tmpdir(), 'whydiff-'))
    const reportFile = join(out, 'report.json')
    await run(
      process.execPath,
      [require.resolve('@playwright/test/cli'), 'test', '--project', 'desktop'],
      {
        cwd: project,
        env: { ...process.env, WHYDIFF_OUT: out, WHYDIFF_FIXTURE_REPORT: reportFile, CI: '1' },
      }
    )
    const lines = await readFile(join(out, 'manifest.jsonl'), 'utf8')
    manifest = lines
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as ManifestLine)
    report = JSON.parse(await readFile(reportFile, 'utf8')) as Report
  }, 120_000)

  afterAll(async () => {
    await rm(out, { recursive: true, force: true })
  })

  it('keeps every test passing', () => {
    const statuses = report.suites.flatMap((s) =>
      s.specs.flatMap((spec) => spec.tests.flatMap((t) => t.results.map((r) => r.status)))
    )
    expect(statuses).toEqual(['passed', 'passed', 'passed'])
  })

  it('writes one manifest line per call with the test and screenshot identity', () => {
    expect(
      manifest.map((l) => [l.title, l.ordinal, l.name, l.receiver, l.snapshot !== null])
    ).toEqual([
      ['named page screenshot', 1, 'home', 'page', true],
      ['anonymous locator screenshots', 1, 'screenshot', 'locator', true],
      ['anonymous locator screenshots', 2, 'nested-second', 'locator', true],
      ['a locator that matches twice is reported, not thrown', 1, 'boxes', 'locator', false],
    ])
    expect(manifest[0]?.screenshot).toMatch(
      /calls\.spec\.ts-snapshots[\\/]home-desktop-[a-z]+\.png$/
    )
    expect(manifest[1]?.screenshot).toBeNull()
    expect(manifest.every((l) => l.png === null)).toBe(true)
    expect(manifest.every((l) => l.project === 'desktop' && l.file === 'calls.spec.ts')).toBe(true)
  })

  it('stores parseable snapshots with the resolved comparison settings', async () => {
    const first = manifest[0]
    const snapshot = parseSnapshot(await readFile(join(out, first?.snapshot ?? ''), 'utf8'))
    expect(snapshot.compare).toEqual({
      threshold: 0.35,
      maxDiffPixels: 0,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    })
    expect(snapshot.image.fullPage).toBe(true)
    const locatorSnapshot = parseSnapshot(
      await readFile(join(out, manifest[1]?.snapshot ?? ''), 'utf8')
    )
    expect(locatorSnapshot.compare.animations).toBe('allow')
    expect(locatorSnapshot.image).toMatchObject({ width: 40, height: 40, origin: [0, 0] })
    expect(locatorSnapshot.nodes.find((n) => n.id === 'first')?.box).toEqual([0, 0, 40, 40])
  })

  it('turns a failed capture into an annotation and a manifest error', () => {
    const strict = report.suites
      .flatMap((s) => s.specs)
      .find((spec) => spec.title.startsWith('a locator'))
    const annotations = strict?.tests[0]?.annotations.filter((a) => a.type === 'whydiff') ?? []
    const reason =
      "locator('.box') matches 2 elements, and whydiff captures one. Make it match the one element the screenshot shows."
    expect(annotations.map((a) => a.description)).toEqual([`snapshot 1 not captured: ${reason}`])
    expect(manifest[3]?.error).toBe(reason)
  })
})

describe('whydiffCapture after the built-in ran', () => {
  let tmp: string
  let snapshots: string
  let written: string[]
  let first: Map<string, Test>
  let second: Map<string, Test>
  let third: Map<string, Test>
  let manifest: ManifestLine[]
  let report: string
  let staleAfterPass: string
  let staleAfterAll: string
  let staleAfterChanged: string
  let backfillStamps: (FileStamp | null)[]
  let heavyAfterPass: FileStamp | null
  let heavySidecar: string | null

  const results = join(fixtureProject, 'whydiff-results')
  const sidecar = (name: string): string =>
    join(snapshots, 'explicit.spec.ts', `${name}.whydiff.json`)
  const parse = (line: string): ManifestLine => JSON.parse(line) as ManifestLine // written by recordCapture

  beforeAll(async () => {
    if (!existsSync(dist)) throw new Error('build @whydiff/playwright first: pnpm build')
    await rm(results, { recursive: true, force: true })
    tmp = await mkdtemp(join(tmpdir(), 'whydiff-explicit-'))
    snapshots = join(tmp, 'snapshots')
    const at = (name: string): string => join(tmp, name)
    const projects = [
      '--project',
      'explicit',
      '--project',
      'explicit-missing-style',
      '--project',
      'explicit-budget',
    ]
    const run = (index: number, args: string[], env: Record<string, string>): Promise<string> =>
      playwright(['test', ...args], {
        WHYDIFF_FIXTURE_SNAPSHOTS: snapshots,
        WHYDIFF_FIXTURE_OUTPUT: at(`out-${String(index)}`),
        WHYDIFF_FIXTURE_REPORT: at(`${String(index)}.json`),
        ...env,
      })
    await run(1, [...projects, '--update-snapshots'], { WHYDIFF_OUT: at('two-run-1') })
    first = await readTests(at('1.json'))
    written = (await readdir(join(snapshots, 'explicit.spec.ts'))).sort()
    for (const name of ['backfill', 'bare', 'heavy', 'unnamed-call-1']) {
      await rm(sidecar(name), { force: true })
    }
    await writeFile(sidecar('stale'), '{}\n')
    await run(2, projects, {
      WHYDIFF_OUT: at('two-run-2'),
      WHYDIFF_FIXTURE_VARIANT: 'changed',
      WHYDIFF_FIXTURE_WHYDIFF_REPORT: at('report'),
    })
    second = await readTests(at('2.json'))
    manifest = (await readFile(at('two-run-2/manifest.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(parse)
    report = await readFile(at('report/report.md'), 'utf8')
    staleAfterPass = await readFile(sidecar('stale'), 'utf8')
    heavyAfterPass = await stampOf(sidecar('heavy'))
    heavySidecar = await readFile(sidecar('heavy'), 'utf8').catch(() => null)
    const backfilled = await stampOf(sidecar('backfill'))
    await run(3, ['--project', 'explicit', '--update-snapshots=all'], {})
    third = await readTests(at('3.json'))
    staleAfterAll = await readFile(sidecar('stale'), 'utf8')
    const afterAll = await stampOf(sidecar('backfill'))
    await writeFile(sidecar('stale'), '{}\n')
    await run(4, ['--project', 'explicit', '--update-snapshots'], {})
    staleAfterChanged = await readFile(sidecar('stale'), 'utf8')
    backfillStamps = [backfilled, afterAll, await stampOf(sidecar('backfill'))]
  }, 300_000)

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('keeps the baseline side of every baseline the built-in writes, unnamed calls included', () => {
    expect([...first.values()].map((t) => t.results.at(-1)?.status)).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
      'skipped',
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
    ])
    expect(written).toEqual([
      'backfill.png',
      'backfill.whydiff.json',
      'bare.png',
      'bare.whydiff.json',
      'card.png',
      'card.whydiff.json',
      'heavy.png',
      'heavy.whydiff.json',
      'injected-pass.png',
      'injected.png',
      'over-budget.png',
      'stale.png',
      'stale.whydiff.json',
      'unnamed-call-1.png',
      'unnamed-call-1.whydiff.json',
    ])
    expect(whydiffAnnotations(only(first, 'unnamed call').test)).toEqual([])
  })

  it('captures once per call, a page that takes seconds included, and shares the snapshot', async () => {
    for (const run of [first, second]) {
      const { test, result } = only(run, 'heavy page captured once')
      expect(result.status).toBe('passed')
      expect(whydiffAnnotations(test)).toEqual([])
      expect(test.annotations).toContainEqual({ type: 'cdp-sessions', description: '1' })
    }
    expect(heavyAfterPass).not.toBeNull()
    const line = manifest.find((l) => l.name === 'heavy')
    expect(await readFile(join(tmp, 'two-run-2', line?.snapshot ?? ''), 'utf8')).toBe(heavySidecar)
  })

  it('records the two-run file and manifest line only in two-run mode', () => {
    const attached = (run: Map<string, Test>): string[] =>
      only(run, 'heavy page captured once').result.attachments.map((a) => a.name)
    expect(attached(first)).toContain('whydiff/1-heavy')
    expect(attached(second)).toContain('whydiff/1-heavy')
    expect(attached(third)).not.toContain('whydiff/1-heavy')
    expect(existsSync(results)).toBe(false)
  })

  it('names the elapsed and the budget when a call is over it', () => {
    for (const run of [first, second]) {
      const { test, result } = only(run, 'over budget')
      expect(result.status).toBe('passed')
      expect(whydiffAnnotations(test)).toEqual([
        expect.stringMatching(
          /^over-budget\.png baseline snapshot not kept: skipped after \d+ ms, over the budget of 1 ms\. Raise use\.whydiff\.budgetMs to keep it\.$/
        ),
      ])
    }
    expect(existsSync(sidecar('over-budget'))).toBe(false)
  })

  it('explains a named failure with the Markdown and both snapshots, and the reporter lists it', async () => {
    const { result } = only(second, 'named failure')
    expect(result.status).toBe('failed')
    expect(result.errors[0]?.message).toContain('pixels (ratio')
    expect(pairAttachments(result)).toEqual([
      'whydiff/card/markdown text/markdown',
      'whydiff/card/snapshot-actual application/json',
      'whydiff/card/snapshot-expected application/json',
    ])
    const attached = result.attachments.find((a) => a.name === 'whydiff/card/markdown')
    expect(attached?.body).toEqual(expect.any(String))
    expect(attached?.path).toBeUndefined()
    const markdown = await attachmentText(result, 'whydiff/card/markdown')
    expect(markdown).toMatch(
      /^What changed on this screen:\n[^\n]+\n\n# whydiff: named failure > card \| 1 cause \| 0 unexplained regions\n/
    )
    expect(markdown).toContain(
      '\n- padding-left: was 0, now 24px; the children were laid out again\n'
    )
    const actual = parseSnapshot(await attachmentText(result, 'whydiff/card/snapshot-actual'))
    expect(actual.tool.capturedAfterMs).toBeGreaterThanOrEqual(0)
    expect(whydiffAnnotations(only(second, 'named failure').test)).toEqual([
      'a <div> is 24 px wider (was 200, now 224) (c1dsr5a)',
    ])
    // The built-in recorded its error before whydiffCapture ran, so the message stays its own.
    expect(result.errors[0]?.message).not.toContain('whydiff, expected -> actual')
    expect(report).toMatch(
      /^# whydiff: 1 of \d+ screenshots changed \| 1 cause \| 0 unexplained regions\n/
    )
    expect(report).toContain('in "named failure > card" (')
  })

  it('backfills a missing sidecar on a pass and leaves an existing one alone', () => {
    expect(only(second, 'backfill on a pass').result.status).toBe('passed')
    expect(existsSync(sidecar('backfill'))).toBe(true)
    expect(staleAfterPass).toBe('{}\n')
  })

  it('rewrites the sidecar under --update-snapshots, all or changed, only when the bytes differ', () => {
    expect(() => parseSnapshot(staleAfterAll)).not.toThrow()
    expect(() => parseSnapshot(staleAfterChanged)).not.toThrow()
    expect(backfillStamps[0]).not.toBeNull()
    expect(backfillStamps[1]).toEqual(backfillStamps[0])
    expect(backfillStamps[2]).toEqual(backfillStamps[0])
  })

  it('keeps no baseline side for an unnamed call that passed and says to name it', () => {
    const { test, result } = only(second, 'unnamed call')
    expect(result.status).toBe('passed')
    expect(whydiffAnnotations(test)).toEqual([
      'screenshot 1 baseline snapshot not kept: name the screenshot, whydiffCapture cannot tell which baseline an unnamed one that passed was compared with',
    ])
    expect(existsSync(sidecar('unnamed-call-1'))).toBe(false)
  })

  it('describes the pixels alone when no baseline snapshot exists', async () => {
    const { result } = only(second, 'no baseline snapshot')
    expect(result.status).toBe('failed')
    expect(pairAttachments(result)).toEqual([
      'whydiff/bare/markdown text/markdown',
      'whydiff/bare/snapshot-actual application/json',
    ])
    const markdown = await attachmentText(result, 'whydiff/bare/markdown')
    expect(markdown).toContain(`\n${NO_BASELINE}\n\n## Changed regions (`)
    expect(whydiffAnnotations(only(second, 'no baseline snapshot').test)).toEqual([NO_BASELINE])
    expect(whydiffAnnotations(only(second, 'backfill on a pass').test)).toEqual([])
    expect(report).toContain(
      `\n## No baseline snapshot (1)\n${NO_BASELINE}\n- no baseline snapshot > bare | explicit.spec.ts:`
    )
  })

  it('keeps the baseline side of a baseline the missing mode writes, and the test still fails', () => {
    const { result } = only(second, 'missing baseline')
    expect(result.status).toBe('failed')
    expect(result.errors[0]?.message).toMatch(/A snapshot doesn't exist at .*fresh\.png/)
    expect(existsSync(sidecar('fresh'))).toBe(true)
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
      expect(report).toMatch(
        /\n## Not explained \(1\)\n.+\n- injected failure on a mismatch > injected \| explicit\.spec\.ts:\d+ \| explicit-missing-style \| ENOENT: /
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
        expect.stringMatching(
          /^whydiff: over-budget\.png baseline snapshot not kept: skipped after/
        ),
      ])
    })
  })

  it('records every call in two-run mode, with the PNG the built-in compared', () => {
    expect(
      manifest.map((l) => [l.project, l.title, l.name, l.snapshot !== null, l.png !== null])
    ).toEqual([
      ['explicit', 'named failure', 'card', true, true],
      ['explicit', 'backfill on a pass', 'backfill', true, true],
      ['explicit', 'stale sidecar on a pass', 'stale', true, true],
      ['explicit', 'unnamed call', 'screenshot', true, false],
      ['explicit', 'missing baseline', 'fresh', true, true],
      ['explicit', 'no baseline snapshot', 'bare', true, true],
      ['explicit', 'heavy page captured once', 'heavy', true, true],
      ['explicit-missing-style', 'injected failure on a mismatch', 'injected', false, true],
      ['explicit-missing-style', 'injected failure on a pass', 'injected-pass', false, true],
      ['explicit-budget', 'over budget', 'over-budget', true, true],
    ])
  })

  it('copies the actual of a failure and the baseline of a pass next to the snapshot', async () => {
    const recorded = async (name: string): Promise<Buffer> => {
      const line = manifest.find((l) => l.name === name)
      if (line?.png === undefined || line.png === null) throw new Error(`no png for ${name}`)
      expect(line.png).toBe(`explicit/${line.testId}/1-${name}.png`)
      return readFile(join(tmp, 'two-run-2', line.png))
    }
    const { result } = only(second, 'named failure')
    const actual = result.attachments.find((a) => a.name === 'card-actual.png')?.path
    if (actual === undefined) throw new Error('no actual attached')
    expect(await recorded('card')).toEqual(await readFile(actual))
    expect(await recorded('backfill')).toEqual(
      await readFile(join(snapshots, 'explicit.spec.ts', 'backfill.png'))
    )
  })
})
