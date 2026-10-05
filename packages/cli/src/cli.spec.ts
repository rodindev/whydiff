import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { PNG } from 'pngjs'

const execute = promisify(execFile)
const require = createRequire(import.meta.url)
const dist = new URL('../dist/main.js', import.meta.url).pathname
const pages = new URL('../fixtures/pages/', import.meta.url).pathname
const cliRoot = new URL('../', import.meta.url).pathname
const project = new URL('../../playwright/fixtures/project/', import.meta.url).pathname
const playwrightCli = require.resolve('@playwright/test/cli', { paths: [project] })

interface Run {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

interface ReportJson {
  readonly screenshots: readonly { readonly id: string; readonly title: string }[]
  readonly causes: readonly {
    readonly id: string
    readonly members: readonly { screenshot: string }[]
  }[]
  readonly unexplained: readonly { readonly id: string }[]
}

/** The built CLI as an agent runs it: no terminal, CI set, so every line is plain. */
async function whydiff(
  args: string[],
  cwd: string,
  env: Record<string, string | undefined> = {}
): Promise<Run> {
  try {
    const { stdout, stderr } = await execute(process.execPath, [dist, ...args], {
      cwd,
      env: { ...process.env, CI: '1', ...env },
      maxBuffer: 16 * 1024 * 1024,
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'stdout' in error && 'stderr' in error) {
      const code = 'code' in error && typeof error.code === 'number' ? error.code : -1
      return { code, stdout: String(error.stdout), stderr: String(error.stderr) }
    }
    throw error
  }
}

/** Runs the Playwright CLI in the fixture project, never into the job summary of a CI step that runs the specs; failing tests are expected. */
async function playwright(args: string[], env: Record<string, string>): Promise<void> {
  try {
    await execute(process.execPath, [playwrightCli, ...args], {
      cwd: project,
      env: { ...process.env, CI: '1', GITHUB_STEP_SUMMARY: '', ...env },
    })
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('stdout' in error)) throw error
  }
}

async function serve(dir: string): Promise<{ url: string; close(): Promise<void> }> {
  const server: Server = createServer((request, response) => {
    readFile(join(dir, new URL(request.url ?? '/', 'http://fixture').pathname))
      .then((text) => {
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end(text)
      })
      .catch(() => {
        response.writeHead(404)
        response.end()
      })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    url: `http://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve()
        })
      }),
  }
}

function readJson(text: string): ReportJson {
  return JSON.parse(text) as ReportJson // the report format
}

interface JsonSuite {
  readonly specs: readonly {
    readonly title: string
    readonly tests: readonly {
      readonly annotations: readonly { readonly type: string; readonly description?: string }[]
      readonly results: readonly { readonly errors: readonly { readonly message?: string }[] }[]
    }[]
  }[]
  readonly suites?: readonly JsonSuite[]
}

/** Each test of a Playwright JSON report: its whydiff annotations and the messages of its last attempt. */
function playwrightTests(
  text: string
): { title: string; annotations: string[]; messages: string[] }[] {
  const report = JSON.parse(text) as { suites: JsonSuite[] } // the JSON reporter's shape
  const visit = (
    suite: JsonSuite
  ): { title: string; annotations: string[]; messages: string[] }[] => [
    ...suite.specs.flatMap((spec) =>
      spec.tests.map((test) => ({
        title: spec.title,
        annotations: test.annotations.flatMap((a) =>
          a.type === 'whydiff' && a.description !== undefined ? [a.description] : []
        ),
        messages: (test.results.at(-1)?.errors ?? []).map((e) => e.message ?? ''),
      }))
    ),
    ...(suite.suites ?? []).flatMap(visit),
  ]
  return report.suites.flatMap(visit)
}

/** Screenshot ids and the cause's example depend on the run; this strips them. */
function normalized(markdown: string, report: ReportJson): string {
  return report.screenshots
    .reduce((text, s) => text.split(s.id).join('SID'), markdown)
    .split('\n')
    .filter((line) => !line.startsWith('- for example, '))
    .join('\n')
}

function sortedMembers(report: ReportJson): ReportJson {
  return {
    ...report,
    causes: report.causes.map((cause) => ({
      ...cause,
      members: [...cause.members].sort((a, b) => (a.screenshot < b.screenshot ? -1 : 1)),
    })),
  }
}

beforeAll(() => {
  if (!existsSync(dist)) throw new Error('build whydiff first: pnpm build')
})

describe('snap, diff and explain on a page', { timeout: 120_000 }, () => {
  let tmp: string
  let server: { url: string; close(): Promise<void> }

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'whydiff-cli-browser-'))
    server = await serve(pages)
  })

  afterAll(async () => {
    await server.close()
    await rm(tmp, { recursive: true, force: true })
  })

  it('snaps two states, diffs them, writes the same bytes twice and explains the cause and the region', async () => {
    const before = await whydiff(
      ['snap', `${server.url}/card-before.html`, '--name', 'before', '--viewport', '400x300'],
      tmp
    )
    expect(before.code).toBe(0)
    expect(before.stdout).toBe('.whydiff/snaps/before.png\n.whydiff/snaps/before.whydiff.json\n')
    expect(before.stderr).toMatch(/^opening http[^\n]+\nbefore: \d+ nodes, 400x300 px\n$/)
    const after = await whydiff(
      ['snap', `${server.url}/card-after.html`, '--name', 'after', '--viewport', '400x300'],
      tmp
    )
    expect(after.code).toBe(0)

    const diff = await whydiff(['diff', 'before', 'after'], tmp)
    expect(diff.code).toBe(0)
    expect(diff.stdout).toMatch(
      /^# whydiff: 1 of 1 screenshot changed \| 1 cause \| 1 unexplained region\ncompared: before -> after \| chromium [\d.]+ 400x300\n/
    )
    expect(diff.stdout).toContain('at `locator(\'#card\')` in "before -> after" (')
    expect(diff.stdout).toContain(
      '\n- `#card` from `<style> #1` (unlayered) changed its declaration of padding-left (was 0px, now 16px)\n- as a result, 1 element moved 16 px right\n- to restore it: change the rule where `<style> #1` comes from, or set padding-left back to 0px in your own stylesheet if a dependency injects it; whydiff cannot tell which\n'
    )
    expect(diff.stdout).toContain(
      ": 1 under `<canvas>`; around `locator('#chart')`; every region with its candidates: `npx whydiff explain s"
    )
    expect(diff.stdout).toBe(await readFile(join(tmp, 'whydiff-report', 'report.md'), 'utf8'))
    expect(diff.stderr).toMatch(
      /^analyzing 1 pair\n1 of 1 screenshot changed, 1 cause, 1 unexplained region in \d+ ms\nwhydiff-report\/report\.md\n$/
    )
    const json = await readFile(join(tmp, 'whydiff-report', 'report.json'), 'utf8')
    const report = readJson(json)
    const [screenshot] = report.screenshots
    const [cause] = report.causes
    const [region] = report.unexplained
    if (screenshot === undefined || cause === undefined || region === undefined) {
      throw new Error('the report lacks the screenshot, the cause or the region')
    }
    expect(
      await readFile(join(tmp, 'whydiff-report', 'screenshots', `${screenshot.id}.md`), 'utf8')
    ).toMatch(/(?:^|\n)# whydiff: before -> after \| 1 cause \| 1 unexplained region\n/)
    expect(await readFile(join(tmp, 'whydiff-report', 'report.html'), 'utf8')).toContain(
      `<article class="cause" id="${cause.id}">`
    )

    const again = await whydiff(
      ['diff', 'before', 'after', '--json', '--exit-code', '--out', 'second'],
      tmp
    )
    expect(again.code).toBe(1)
    expect(again.stdout).toBe(json)
    expect(await readFile(join(tmp, 'second', 'report.json'), 'utf8')).toBe(json)
    expect(await readFile(join(tmp, 'second', 'report.md'), 'utf8')).toBe(diff.stdout)

    const explained = await whydiff(['explain', cause.id, screenshot.id], tmp)
    expect(explained.code).toBe(0)
    expect(explained.stdout).toMatch(/^report: whydiff-report\/report\.json\n\n## /)
    expect(explained.stdout).toContain(
      `### members (1) by identical changes\n- 1 member on 1 screenshot: padding-left 0px -> 16px\n  - ${screenshot.id} | before -> after | locator('#card') | 2 elements\n`
    )
    expect(explained.stdout).toContain(
      `\n# whydiff: before -> after | 1 cause | 1 unexplained region\n`
    )

    const cropped = await whydiff(['explain', region.id], tmp)
    expect(cropped.code).toBe(0)
    const files = ['expected', 'actual', 'diff'].map(
      (kind) => `whydiff-report/crops/${region.id}-${kind}.png`
    )
    expect(cropped.stdout).toContain(`- crops: ${files.join(', ')} | 76x62 px each\n`)
    for (const file of files) {
      const png = PNG.sync.read(await readFile(join(tmp, file)))
      expect([png.width, png.height], file).toEqual([76, 62])
    }
    const diffCrop = PNG.sync.read(await readFile(join(tmp, files[2] ?? '')))
    const red = [...diffCrop.data].filter(
      (_, i) => i % 4 === 0 && diffCrop.data[i] === 255 && diffCrop.data[i + 1] === 0
    )
    expect(red.length).toBe(60 * 30)
  })

  it('fails with one line when the URL cannot be opened', async () => {
    const bad = await whydiff(['snap', 'http://127.0.0.1:1/', '--name', 'y'], tmp)
    expect(bad.code).toBe(2)
    expect(bad.stderr).toMatch(/^opening http:\/\/127\.0\.0\.1:1\/\nwhydiff: [^\n]+\n$/)
    expect(bad.stdout).toBe('')
  })
})

describe('whydiff over a Playwright run', { timeout: 300_000 }, () => {
  let tmp: string
  const at = (name: string): string => join(tmp, name)

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'whydiff-cli-run-'))
    const changed = { WHYDIFF_FIXTURE_VARIANT: 'changed' }
    await playwright(['test', '--project', 'reporter', '--update-snapshots'], {
      WHYDIFF_FIXTURE_SNAPSHOTS: at('snapshots-a'),
      WHYDIFF_OUT: at('run-a'),
      WHYDIFF_FIXTURE_OUTPUT: at('out-a'),
      WHYDIFF_FIXTURE_REPORT: at('a.json'),
    })
    await playwright(['test', '--project', 'reporter', '--update-snapshots'], {
      ...changed,
      WHYDIFF_FIXTURE_SNAPSHOTS: at('snapshots-b'),
      WHYDIFF_OUT: at('run-b'),
      WHYDIFF_FIXTURE_OUTPUT: at('out-b'),
      WHYDIFF_FIXTURE_REPORT: at('b.json'),
    })
    await rm(join(at('snapshots-a'), 'reporter.spec.ts', 'bare.whydiff.json'))
    const base = { ...changed, WHYDIFF_FIXTURE_SNAPSHOTS: at('snapshots-a') }
    await playwright(['test', '--project', 'reporter'], {
      ...base,
      WHYDIFF_FIXTURE_OUTPUT: at('test-results'),
      WHYDIFF_FIXTURE_REPORT: at('full.json'),
      WHYDIFF_FIXTURE_WHYDIFF_REPORT: at('full'),
    })
    for (const index of [1, 2]) {
      await playwright(['test', '--project', 'reporter', '--shard', `${String(index)}/2`], {
        ...base,
        WHYDIFF_FIXTURE_OUTPUT: at(`out-shard-${String(index)}`),
        WHYDIFF_FIXTURE_REPORT: at(`shard-${String(index)}.json`),
        WHYDIFF_FIXTURE_WHYDIFF_REPORT: at('shards'),
      })
    }
  }, 300_000)

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('diffs two two-run outputs by project, test id and ordinal', async () => {
    const result = await whydiff(['diff', 'run-a', 'run-b', '--out', 'two-run'], tmp)
    expect(result.code).toBe(0)
    expect(result.stderr).not.toContain('warning')
    expect(result.stdout).toMatch(
      /^# whydiff: 3 of 4 screenshots changed \| 1 cause \| 0 unexplained regions\n/
    )
    expect(result.stdout).toContain(
      "\n- for example, a `<div.banner>` is 16 px wider (was 300, now 316), at `locator('div.banner')` in "
    )
    const report = readJson(await readFile(join(tmp, 'two-run', 'report.json'), 'utf8'))
    expect(report.screenshots.map((s) => s.title)).toEqual([
      'header > header',
      'footer > footer',
      'stable > stable',
      'bare > bare',
    ])
  })

  it('diffs two Playwright snapshot directories by relative path', async () => {
    const result = await whydiff(['diff', 'snapshots-a', 'snapshots-b', '--out', 'dirs'], tmp)
    expect(result.code).toBe(0)
    expect(result.stderr).toContain(
      'warning: snapshots-b: reporter.spec.ts/bare has no counterpart\n'
    )
    expect(result.stderr).toContain(
      'warning: snapshots-a: reporter.spec.ts/bare.png has no .whydiff.json\n'
    )
    expect(result.stdout).toMatch(
      /^# whydiff: 2 of 3 screenshots changed \| 1 cause \| 0 unexplained regions\n/
    )
    const report = readJson(await readFile(join(tmp, 'dirs', 'report.json'), 'utf8'))
    expect(report.screenshots.map((s) => s.title)).toEqual([
      'reporter.spec.ts/footer',
      'reporter.spec.ts/header',
      'reporter.spec.ts/stable',
    ])
  })

  it('rebuilds the report from test-results as the reporter wrote it, except what Playwright keeps to itself', async () => {
    const result = await whydiff(['report', '--from', 'test-results', '--out', 'from'], tmp)
    expect(result.code).toBe(0)
    expect(result.stderr).toContain('rebuilding the report of 4 tests\n')
    expect(result.stderr).not.toContain('skipped')
    expect(result.stdout).toBe(await readFile(join(tmp, 'from', 'report.md'), 'utf8'))
    const full = await readFile(join(tmp, 'full', 'report.md'), 'utf8')
    expect(full).toMatch(
      /^# whydiff: 2 of 3 screenshots changed \| 1 cause \| 0 unexplained regions\n/
    )
    const rebuilt = readJson(await readFile(join(tmp, 'from', 'report.json'), 'utf8'))
    const reported = readJson(await readFile(join(tmp, 'full', 'report.json'), 'utf8'))
    // The passed screenshot, Playwright's test ids and the error of the test whydiff was off in exist
    // only inside the reporter; test-results name that test in Playwright's error context.
    expect(normalized(result.stdout, rebuilt)).toBe(
      normalized(full, reported)
        .replace('2 of 3 screenshots changed', '2 of 2 screenshots changed')
        .replace('Unchanged: 1 screenshot is pixel-identical and not listed.\n', '')
        .replace(
          /\| reporter \| expect\(page\)\.toHaveScreenshot\(expected\) failed: .*$/m,
          '| reporter | rebuilt from test-results, which keep no annotation that says why'
        )
    )
    expect(result.stdout).toContain(
      '\n- switched off > unexplained > unexplained | reporter.spec.ts:42 | reporter | '
    )
    expect(result.stdout).toContain('\n## No baseline snapshot (1)\n')
    expect(rebuilt.causes.map((c) => c.id)).toEqual(reported.causes.map((c) => c.id))
    const json = await whydiff(['report', '--from', 'test-results', '--out', 'from', '--json'], tmp)
    expect(json.stdout).toBe(await readFile(join(tmp, 'from', 'report.json'), 'utf8'))
  })

  it("prints in a failed assertion's message only ids the run's report explains, the test's own cause id among them", async () => {
    const report = readJson(await readFile(join(tmp, 'full', 'report.json'), 'utf8'))
    const tests = playwrightTests(await readFile(join(tmp, 'full.json'), 'utf8'))
    // The header's own page saw one banner, the run saw it on three: both name its rule, by one id.
    const header = tests.find((t) => t.title === 'header')
    const own = /\((c[0-9a-z]{6})\)$/.exec(header?.annotations[0] ?? '')?.[1]
    expect(own).toEqual(expect.any(String))
    expect(report.causes.map((c) => c.id)).toContain(own)
    const blocks = tests.flatMap(({ title, messages }) =>
      messages.flatMap((message) => {
        const start = message.indexOf('whydiff, expected -> actual:')
        if (start < 0) return []
        const end = message.indexOf('\n\n', start)
        return [{ title, block: message.slice(start, end < 0 ? undefined : end) }]
      })
    )
    expect(blocks.map((b) => b.title).sort()).toEqual(['bare', 'footer', 'header'])
    for (const { title, block } of blocks) {
      const ids = block.replace(/ --report \S+/g, '').match(/\b[csu][0-9a-z]{6}\b/g) ?? []
      if (ids.length > 0) {
        const explained = await whydiff(['explain', ...ids, '--report', 'full/report.json'], tmp)
        expect(explained.stderr, title).toBe('')
        expect(explained.code, title).toBe(0)
      }
      const command = /details when the run ends: npx whydiff (.+)$/m.exec(block)?.[1]
      if (title === 'bare') {
        expect(command, title).toBeUndefined()
        continue
      }
      const printed = await whydiff((command ?? '').split(' '), project)
      expect(printed.code, title).toBe(0)
      expect(printed.stdout, title).toContain(`${title} > ${title}`)
    }
  })

  it('merges two shards into the run report', async () => {
    const result = await whydiff(
      [
        'report',
        '--merge',
        'shards/report.shard-1-of-2.json',
        'shards/report.shard-2-of-2.json',
        '--out',
        'merged',
      ],
      tmp
    )
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('2 shards merged\nmerged/report.md\n')
    const full = await readFile(join(tmp, 'full', 'report.md'), 'utf8')
    expect(result.stdout).toBe(full)
    expect(await readFile(join(tmp, 'merged', 'report.md'), 'utf8')).toBe(full)
    // Members of one cause follow the screenshot order; the reporter orders them by its private screen key.
    expect(
      sortedMembers(readJson(await readFile(join(tmp, 'merged', 'report.json'), 'utf8')))
    ).toEqual(sortedMembers(readJson(await readFile(join(tmp, 'full', 'report.json'), 'utf8'))))
  })
})

describe('whydiff diff over two run directories on their own', { timeout: 300_000 }, () => {
  let tmp: string

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'whydiff-cli-two-run-'))
    const machine = join(tmp, 'machine')
    const run = (name: string, args: string[], env: Record<string, string>): Promise<void> =>
      playwright(['test', '--project', 'explicit', ...args], {
        WHYDIFF_FIXTURE_SNAPSHOTS: join(machine, 'snapshots'),
        WHYDIFF_FIXTURE_OUTPUT: join(machine, `${name}-results`),
        WHYDIFF_FIXTURE_REPORT: join(machine, `${name}.json`),
        WHYDIFF_OUT: join(tmp, name),
        ...env,
      })
    await run('before', ['--update-snapshots'], {})
    await run('after', [], { WHYDIFF_FIXTURE_VARIANT: 'changed' })
    await rm(machine, { recursive: true, force: true })
  }, 300_000)

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('reads the PNGs the runs carry, names the cause and lists the pair without one', async () => {
    const manifest = (await readFile(join(tmp, 'after', 'manifest.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { name: string; png: string | null }) // written by recordCapture
    expect(manifest.map((l) => [l.name, l.png !== null])).toEqual([
      ['card', true],
      ['backfill', true],
      ['stale', true],
      ['screenshot', false],
      ['fresh', true],
      ['bare', true],
      ['heavy', true],
    ])
    const result = await whydiff(['diff', 'before', 'after', '--out', 'report'], tmp)
    expect(result.code).toBe(0)
    expect(result.stderr).toMatch(
      /^warning: after: explicit\|[^|\n]+\|1 has no counterpart\nanalyzing 5 pairs\n2 of 5 screenshots changed, 1 cause, 0 unexplained regions in \d+ ms\nreport\/report\.md\n$/
    )
    expect(result.stdout).toMatch(
      /^# whydiff: 2 of 5 screenshots changed \| 1 cause \| 0 unexplained regions\ncompared: before -> after \| chromium [\d.]+ 800x600\n/
    )
    expect(result.stdout).toMatch(
      /\n## 2 `<div>` elements are 24 px wider, on all 2 changed screenshots, 100% of changed pixels \(`#card`, c[0-9a-z]+\)\n- for example, a `<div>` is 24 px wider \(was 200, now 224\), at `locator\('#card'\)` in "[^"\n]+" \(s[0-9a-z]+\)\n- `#card` from `<style> #1` \(unlayered\) changed its declaration of padding-left \(was 0px, now 24px\)\n/
    )
    expect(result.stdout).toContain(
      '\n- as a result, 2 elements moved 24 px right\n- to restore it: change the rule where `<style> #1` comes from, or set padding-left back to 0px in your own stylesheet if a dependency injects it; whydiff cannot tell which\n- all occurrences: `npx whydiff explain c'
    )
    expect(result.stdout).toMatch(
      /\n## No baseline snapshot \(1\)\nNo PNG was recorded [^\n]+\n- unnamed call > screenshot \| explicit\.spec\.ts:\d+ \| explicit \| no PNG in after\n$/
    )
    expect(result.stdout).toBe(await readFile(join(tmp, 'report', 'report.md'), 'utf8'))
    const report = readJson(await readFile(join(tmp, 'report', 'report.json'), 'utf8'))
    expect(report.screenshots.map((s) => s.title)).toEqual([
      'named failure > card',
      'backfill on a pass > backfill',
      'stale sidecar on a pass > stale',
      'no baseline snapshot > bare',
      'heavy page captured once > heavy',
    ])
  })
})

describe('init in a project', { timeout: 120_000 }, () => {
  it('writes a config and a fixtures file that Playwright loads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'whydiff-cli-init-'))
    try {
      await symlink(join(cliRoot, 'node_modules'), join(dir, 'node_modules'))
      await writeFile(join(dir, 'package.json'), '{ "type": "module" }\n')
      await writeFile(
        join(dir, 'playwright.config.ts'),
        "import { defineConfig } from '@playwright/test'\n\nexport default defineConfig({\n  testDir: './tests',\n  reporter: 'list',\n})\n"
      )
      await mkdir(join(dir, 'tests'))
      await writeFile(
        join(dir, 'tests', 'smoke.spec.ts'),
        "import { expect, test } from './fixtures'\n\ntest('smoke', async ({ page }) => {\n  await page.setContent('<p>hi</p>')\n  await expect(page).toHaveTitle('')\n})\n"
      )
      const result = await whydiff(['init', '--yes'], dir)
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('applied 3 edits\n')
      const { stdout } = await execute(process.execPath, [playwrightCli, 'test', '--list'], {
        cwd: dir,
        env: { ...process.env, CI: '1' },
      })
      expect(stdout).toContain('smoke.spec.ts')
      expect(stdout).toContain('Total: 1 test in 1 file')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('doctor in a project with playwright-core alone', { timeout: 120_000 }, () => {
  it("names the project's own playwright-core to install the headless shell with", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'whydiff-cli-doctor-'))
    try {
      await mkdir(join(dir, 'node_modules'))
      await symlink(
        join(cliRoot, 'node_modules', 'playwright-core'),
        join(dir, 'node_modules', 'playwright-core')
      )
      // pnpm sets NODE_PATH for the scripts it runs, and @playwright/test resolves from anywhere by it.
      const result = await whydiff(['doctor', '--json'], dir, {
        NODE_PATH: undefined,
        WHYDIFF_CHROMIUM: undefined,
        PLAYWRIGHT_BROWSERS_PATH: join(dir, 'browsers'),
      })
      const checks = JSON.parse(result.stdout) as { check: string; fix?: string }[] // doctor --json
      expect(checks.find((c) => c.check.startsWith('chromium-headless-shell'))?.fix).toBe(
        'npx playwright-core install chromium-headless-shell, or set WHYDIFF_CHROMIUM to a Chromium binary'
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
