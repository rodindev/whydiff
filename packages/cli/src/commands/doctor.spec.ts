import { mkdtempSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadChromium } from '../io/browser.js'
import { run } from '../main.js'
import { fakeProcess } from '../testing.js'
import { VERSION } from '../version.js'
import { compareVersions, versionsChecks, type Check } from './doctor.js'

const require = createRequire(import.meta.url)
const cliRoot = new URL('../../', import.meta.url).pathname
const versions = `whydiff ${VERSION} on Node ${process.versions.node}, ${process.platform}-${process.arch}`
const installShell =
  'npx playwright install chromium-headless-shell, or set WHYDIFF_CHROMIUM to a Chromium binary'
const shot =
  "\ntest('card', async ({ page }) => {\n  await expect(page).toHaveScreenshot('card.png')\n})\n"

// Playwright reads PLAYWRIGHT_BROWSERS_PATH once, when its registry loads: every doctor in this file
// looks for browsers here, and finds only what a test puts here.
const browsers = mkdtempSync(join(tmpdir(), 'whydiff-browsers-'))
vi.stubEnv('PLAYWRIGHT_BROWSERS_PATH', browsers)

afterAll(async () => {
  await rm(browsers, { recursive: true, force: true })
})

async function file(path: string, text = ''): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
}

describe('doctor', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'whydiff-doctor-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('prints the versions it runs on, then one line per check with the fix after a bar', async () => {
    await symlink(join(cliRoot, 'node_modules'), join(dir, 'node_modules'))
    await file(join(dir, 'playwright.config.ts'), "reporter: [['@whydiff/playwright/reporter']]")
    await file(
      join(dir, 'tests', 'fixtures.ts'),
      'export const { test, expect } = withWhydiff(base, baseExpect)'
    )
    await file(join(dir, 'tests', 'a.spec.ts-snapshots', 'one.png'))
    await file(join(dir, 'tests', 'a.spec.ts-snapshots', 'one.whydiff.json'))
    await file(join(dir, 'tests', 'a.spec.ts-snapshots', 'two.png'))
    await file(join(dir, 'public', 'logo.png'))
    const { version } = require('@playwright/test/package.json') as { version: string }
    const p = fakeProcess(dir, { WHYDIFF_CHROMIUM: process.execPath })
    expect(await run(['doctor'], p)).toBe(0)
    expect(p.text.stderr).toBe('')
    expect(p.text.stdout).toBe(
      [
        `ok   ${versions}`,
        `ok   @playwright/test ${version} with @whydiff/playwright`,
        `ok   chromium at ${process.execPath} (WHYDIFF_CHROMIUM)`,
        'ok   playwright.config.ts runs the whydiff reporter',
        'ok   tests/fixtures.ts calls withWhydiff',
        'ok   whydiff-report is writable',
        'warn 1 of 2 baseline PNGs have no .whydiff.json next to them | run the suite once with --update-snapshots, or let the tests pass once with backfill on',
        '',
      ].join('\n')
    )
  })

  it('fails without Playwright, without a config and with a missing Chromium, as JSON too', async () => {
    const p = fakeProcess(dir, { WHYDIFF_CHROMIUM: join(dir, 'missing') })
    expect(await run(['doctor', '--json'], p)).toBe(2)
    const checks = JSON.parse(p.text.stdout) as Check[]
    expect(checks[0]).toEqual({ status: 'ok', check: versions })
    // A machine with @playwright/test on NODE_PATH resolves it from an empty directory too.
    const [, playwright, ...rest] = checks
    expect(playwright).toEqual(
      resolvesGlobally('@playwright/test/package.json', dir)
        ? expect.objectContaining({ status: 'ok' })
        : {
            status: 'fail',
            check: '@playwright/test not installed',
            fix: 'npm i -D @playwright/test',
          }
    )
    expect(rest.map((c) => c.status)).toEqual(['fail', 'fail', 'ok', 'warn'])
    expect(rest[0]).toEqual({
      status: 'fail',
      check: `WHYDIFF_CHROMIUM points at ${join(dir, 'missing')}, which does not exist`,
      fix: 'point WHYDIFF_CHROMIUM at a Chromium binary, or unset it',
    })
    expect(rest[1]).toMatchObject({ check: 'no playwright.config.* in this directory' })
  })

  describe('the binary a headless launch starts', () => {
    // The matrix runner points WHYDIFF_MATRIX_PROJECT at a project installed with another release.
    const project = process.env.WHYDIFF_MATRIX_PROJECT ?? cliRoot
    let full: string
    let shell: string

    beforeAll(async () => {
      const chromium = await loadChromium(project)
      full = chromium.executablePath()
      // A launch that stops at a missing binary leaves two temporary directories behind; put them here.
      const tmp = process.env.TMPDIR
      vi.stubEnv('TMPDIR', browsers)
      const error = String(await chromium.launch().catch((e: unknown) => e))
      vi.stubEnv('TMPDIR', tmp)
      shell = /Executable doesn't exist at (.+)/.exec(error)?.[1] ?? error
    })

    beforeEach(async () => {
      await symlink(join(project, 'node_modules'), join(dir, 'node_modules'))
    })

    afterEach(async () => {
      await rm(browsers, { recursive: true, force: true })
      await mkdir(browsers)
    })

    it('fails without either build and names the shell that Playwright looks for', async () => {
      const p = fakeProcess(dir)
      await run(['doctor'], p)
      expect(p.text.stdout).toContain(
        `\nfail chromium-headless-shell not installed at ${shell} | ${installShell}\n`
      )
    })

    it('fails with only the full build, which a headless launch never starts', async () => {
      await file(full)
      const p = fakeProcess(dir)
      await run(['doctor'], p)
      expect(p.text.stdout).toContain(
        `\nfail chromium-headless-shell not installed at ${shell} | ${installShell}\n`
      )
    })

    it('passes with only the headless shell and names it', async () => {
      await file(shell)
      const p = fakeProcess(dir)
      await run(['doctor'], p)
      expect(p.text.stdout).toContain(`\nok   chromium-headless-shell at ${shell}\n`)
    })
  })

  it('warns on a Node older than the floor of engines, with the fix after a bar', () => {
    expect(versionsChecks('22.17.1')).toEqual([
      {
        status: 'ok',
        check: `whydiff ${VERSION} on Node 22.17.1, ${process.platform}-${process.arch}`,
      },
      {
        status: 'warn',
        check: 'Node 22.17.1 is older than 22.18.0',
        fix: 'use Node 22.18.0 or later',
      },
    ])
    expect(versionsChecks('22.18.0')).toEqual([expect.objectContaining({ status: 'ok' })])
  })

  it('warns when the playwright-core it finds keeps no browser registry where whydiff looks', async () => {
    for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
      await file(join(dir, 'node_modules', name, 'package.json'), '{}')
    }
    await file(join(dir, 'node_modules', 'playwright-core', 'index.js'))
    const p = fakeProcess(dir)
    await run(['doctor'], p)
    expect(p.text.stdout).toContain(
      '\nwarn cannot tell which chromium this playwright-core launches headless | update whydiff, or set WHYDIFF_CHROMIUM to a Chromium binary\n'
    )
  })

  it('warns when the config and the fixtures are not set up', async () => {
    await symlink(join(cliRoot, 'node_modules'), join(dir, 'node_modules'))
    await file(join(dir, 'playwright.config.js'), 'export default {}')
    const p = fakeProcess(dir, { WHYDIFF_CHROMIUM: process.execPath })
    expect(await run(['doctor'], p)).toBe(0)
    expect(p.text.stdout).toContain(
      'warn playwright.config.js has no @whydiff/playwright/reporter entry | run npx whydiff init\nwarn no file calls withWhydiff or whydiffCapture | run npx whydiff init\n'
    )
  })

  it('warns when specs that call toHaveScreenshot take test or expect from Playwright, past the withWhydiff file', async () => {
    await symlink(join(cliRoot, 'node_modules'), join(dir, 'node_modules'))
    await file(
      join(dir, 'playwright.config.ts'),
      "export default { testDir: './tests', reporter: [['@whydiff/playwright/reporter']] }"
    )
    await file(
      join(dir, 'tests', 'fixtures.ts'),
      'export const { test, expect } = withWhydiff(base, baseExpect)'
    )
    await file(join(dir, 'tests', 'a.spec.ts'), `import { test, expect } from './fixtures'${shot}`)
    await file(
      join(dir, 'tests', 'b.spec.ts'),
      `import { test, expect } from '@playwright/test'${shot}`
    )
    await file(
      join(dir, 'tests', 'c.spec.ts'),
      "import { test, expect } from '@playwright/test'\ntest('title', async ({ page }) => {\n  await expect(page).toHaveTitle('app')\n})\n"
    )
    await file(
      join(dir, 'tests', 'd.spec.ts'),
      `import { test as base, expect } from '@playwright/test'\nconst test = base.extend({})${shot}`
    )
    await file(
      join(dir, 'tests', 'self.spec.ts'),
      `import { test as base, expect as baseExpect } from '@playwright/test'\nconst { test, expect } = withWhydiff(base, baseExpect)${shot}`
    )
    const p = fakeProcess(dir, { WHYDIFF_CHROMIUM: process.execPath })
    expect(await run(['doctor'], p)).toBe(0)
    expect(p.text.stdout).toContain(
      '\nok   tests/fixtures.ts calls withWhydiff\nwarn 2 of 3 specs that call toHaveScreenshot take test or expect from @playwright/test, not tests/fixtures.ts, so withWhydiff never sees their screenshots; first tests/b.spec.ts | run npx whydiff init, or change the import\n'
    )
  })

  it('warns when the whydiff reporter comes after html, and not when it comes before', async () => {
    const order = async (reporter: string): Promise<string> => {
      await file(join(dir, 'playwright.config.ts'), `export default { reporter: ${reporter} }`)
      const p = fakeProcess(dir, { WHYDIFF_CHROMIUM: process.execPath })
      await run(['doctor'], p)
      return p.text.stdout.split('\n').find((line) => line.includes('playwright.config.ts')) ?? ''
    }
    expect(await order("[['html', { open: 'never' }], ['@whydiff/playwright/reporter']]")).toBe(
      "warn playwright.config.ts lists the whydiff reporter after html, too late for the HTML report to show the run's explanations | move ['@whydiff/playwright/reporter'] before ['html'] in reporter"
    )
    expect(await order("[['list'], ['@whydiff/playwright/reporter'], [\"html\"]]")).toBe(
      'ok   playwright.config.ts runs the whydiff reporter'
    )
    expect(await order("[['@whydiff/playwright/reporter'], ['dot']]")).toBe(
      'ok   playwright.config.ts runs the whydiff reporter'
    )
  })

  describe('the explicit call', () => {
    const config = [
      "import { defineConfig } from '@playwright/test'",
      'export default defineConfig({',
      "  testDir: './e2e',",
      "  snapshotDir: './baselines',",
      "  reporter: [['list'], ['@whydiff/playwright/reporter']],",
      '})',
    ].join('\n')
    const screenshots = (name: string): string =>
      join(dir, 'e2e', '__screenshots__', 'home.spec.ts', 'chromium', name)

    beforeEach(async () => {
      await file(
        join(dir, 'node_modules', '@playwright', 'test', 'package.json'),
        '{"version":"1.60.0"}'
      )
      await file(join(dir, 'playwright.config.ts'), config)
      await file(join(dir, 'e2e', 'home.spec.ts'), "await whydiffCapture(page, 'home.png')")
      await file(screenshots('home.png'))
      await file(screenshots('home.whydiff.json'))
      await file(screenshots('cart.png'))
      await file(join(dir, 'e2e', 'nested', 'deep.spec.ts-snapshots', 'deep.png'))
      await file(join(dir, 'e2e', 'nested', 'deep.spec.ts-snapshots', 'deep.whydiff.json'))
      await file(join(dir, 'baselines', 'home.spec.ts-snapshots', 'home-chromium-linux.png'))
      await file(join(dir, 'e2e', 'assets', 'logo.png'))
      await file(join(dir, 'public', 'hero.png'))
    })

    it('passes on a release the override refuses and counts baselines under __screenshots__ and snapshotDir', async () => {
      await file(
        join(dir, 'e2e', 'home.spec.ts'),
        "import { test, expect } from '@playwright/test'\nimport { whydiffCapture } from '@whydiff/playwright'\ntest('home', async ({ page }) => {\n  await expect.soft(page).toHaveScreenshot('home.png')\n  await whydiffCapture(page, 'home.png')\n})\n"
      )
      const p = fakeProcess(dir, { WHYDIFF_CHROMIUM: process.execPath })
      expect(await run(['doctor'], p)).toBe(0)
      expect(p.text.stdout).toBe(
        [
          `ok   ${versions}`,
          'ok   explicit call on @playwright/test 1.60.0',
          `ok   chromium at ${process.execPath} (WHYDIFF_CHROMIUM)`,
          'ok   playwright.config.ts runs the whydiff reporter',
          'ok   whydiff-report is writable',
          'warn 2 of 4 baseline PNGs have no .whydiff.json next to them | run the suite once with --update-snapshots, or let the tests pass once with backfill on',
          '',
        ].join('\n')
      )
    })

    it('gives way to withWhydiff, which that release fails on', async () => {
      await file(
        join(dir, 'e2e', 'fixtures.ts'),
        'export const { test, expect } = withWhydiff(base, baseExpect)'
      )
      const p = fakeProcess(dir, { WHYDIFF_CHROMIUM: process.execPath })
      expect(await run(['doctor'], p)).toBe(2)
      expect(p.text.stdout).toContain(
        'fail @playwright/test 1.60.0 lets an override of toHaveScreenshot recurse and breaks every screenshot assertion | use 1.59 or earlier, or 1.61.1 or later\n'
      )
      expect(p.text.stdout).toContain('\nok   e2e/fixtures.ts calls withWhydiff\n')
    })

    it('looks for the call in testDir only, and says to call whydiffCapture when there is none', async () => {
      await rm(join(dir, 'e2e', 'home.spec.ts'))
      await file(join(dir, 'scripts', 'demo.ts'), "await whydiffCapture(page, 'home.png')")
      const p = fakeProcess(dir, { WHYDIFF_CHROMIUM: process.execPath })
      expect(await run(['doctor'], p)).toBe(0)
      expect(p.text.stdout).toBe(
        [
          `ok   ${versions}`,
          'warn withWhydiff cannot run on @playwright/test 1.60.0 | call whydiffCapture right after each toHaveScreenshot instead, as the @whydiff/playwright README shows under Two ways in',
          `ok   chromium at ${process.execPath} (WHYDIFF_CHROMIUM)`,
          'ok   playwright.config.ts runs the whydiff reporter',
          'ok   whydiff-report is writable',
          'warn 2 of 4 baseline PNGs have no .whydiff.json next to them | run the suite once with --update-snapshots, or let the tests pass once with backfill on',
          '',
        ].join('\n')
      )
    })
  })
})

function resolvesGlobally(id: string, from: string): boolean {
  try {
    createRequire(join(from, 'package.json')).resolve(id)
    return true
  } catch {
    return false
  }
}

describe('compareVersions', () => {
  it('orders by major, minor and patch and ignores a pre-release tag', () => {
    expect(compareVersions('1.53.0', '1.53.0')).toBe(0)
    expect(compareVersions('1.52.9', '1.53.0')).toBeLessThan(0)
    expect(compareVersions('1.60.0-beta', '1.53.0')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
  })
})
