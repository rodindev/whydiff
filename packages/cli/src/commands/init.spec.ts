import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseArgs } from '../args.js'
import { run } from '../main.js'
import { fakeProcess } from '../testing.js'
import type { Ui } from '../ui.js'
import { addReporter, init, INIT_FLAGS, moveReporter, renderDiff, wrapFixtures } from './init.js'

const CONFIG = [
  "import { defineConfig } from '@playwright/test'",
  '',
  'export default defineConfig({',
  "  testDir: './e2e',",
  "  reporter: 'html',",
  '})',
  '',
].join('\n')

// The shape `npm init playwright` writes: semicolons, testDir './tests', the html reporter.
const FRESH_CONFIG = [
  "import { defineConfig, devices } from '@playwright/test';",
  '',
  'export default defineConfig({',
  "  testDir: './tests',",
  "  reporter: 'html',",
  "  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],",
  '});',
  '',
].join('\n')
const SHOT = [
  '',
  "test('card', async ({ page }) => {",
  "  await expect(page).toHaveScreenshot('card.png');",
  '});',
  '',
].join('\n')

async function file(path: string, text = ''): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
}

/** A fresh project: one spec to rewrite, one that keeps a type import and an extension, one without screenshots, one init cannot rewrite. */
async function freshProject(dir: string): Promise<void> {
  await file(join(dir, 'playwright.config.ts'), FRESH_CONFIG)
  await file(
    join(dir, 'tests', 'example.spec.ts'),
    `import { test, expect } from '@playwright/test';\n${SHOT}`
  )
  await file(
    join(dir, 'tests', 'shop', 'cart.spec.ts'),
    `import { test, expect, type Page } from '@playwright/test';\nimport { open } from '../helpers.js';\n${SHOT}`
  )
  await file(
    join(dir, 'tests', 'title.spec.ts'),
    "import { test, expect } from '@playwright/test';\n\ntest('title', async ({ page }) => {\n  await expect(page).toHaveTitle('app');\n});\n"
  )
  await file(
    join(dir, 'tests', 'wide.spec.ts'),
    `import { test as base, expect } from '@playwright/test';\n\nconst test = base.extend({});\n${SHOT}`
  )
}

describe('wrapFixtures', () => {
  it('wraps export const test with an expect re-exported from Playwright', () => {
    const text = [
      "import { test as base } from '@playwright/test'",
      '',
      'export const test = base.extend<{ user: string }>({',
      "  user: async ({}, use) => { await use('ada') },",
      '})',
      "export { expect } from '@playwright/test'",
      '',
    ].join('\n')
    expect(wrapFixtures(text)).toBe(
      [
        "import { test as base } from '@playwright/test'",
        "import { expect as baseExpect } from '@playwright/test'",
        "import { withWhydiff } from '@whydiff/playwright'",
        '',
        'const extendedTest = base.extend<{ user: string }>({',
        "  user: async ({}, use) => { await use('ada') },",
        '})',
        '',
        'export const { test, expect } = withWhydiff(extendedTest, baseExpect)',
        '',
      ].join('\n')
    )
  })

  it('wraps an expect declared or re-exported locally', () => {
    const declared =
      "import { test as base, expect as e } from '@playwright/test'\nexport const test = base\nexport const expect = e.extend({})\n"
    expect(wrapFixtures(declared)).toContain('withWhydiff(extendedTest, extendedExpect)')
    expect(wrapFixtures(declared)).toContain('const extendedExpect = e.extend({})')
    const local =
      "import { test as base, expect } from '@playwright/test'\nexport const test = base\nexport { expect }\n"
    expect(wrapFixtures(local)).toContain('withWhydiff(extendedTest, expect)')
    expect(wrapFixtures(local)).not.toContain('export { expect }')
  })

  it('inserts the imports after a multi-line import, or first without any', () => {
    const text = [
      'import {',
      '  test as base,',
      "} from '@playwright/test'",
      'export const test = base',
      "export { expect } from '@playwright/test'",
      '',
    ].join('\n')
    expect(wrapFixtures(text)).toBe(
      [
        'import {',
        '  test as base,',
        "} from '@playwright/test'",
        "import { expect as baseExpect } from '@playwright/test'",
        "import { withWhydiff } from '@whydiff/playwright'",
        'const extendedTest = base',
        '',
        'export const { test, expect } = withWhydiff(extendedTest, baseExpect)',
        '',
      ].join('\n')
    )
    expect(wrapFixtures('export const test = base\nexport { expect }\n')).toBe(
      "import { withWhydiff } from '@whydiff/playwright'\nconst extendedTest = base\n\nexport const { test, expect } = withWhydiff(extendedTest, expect)\n"
    )
  })

  it('leaves other shapes and an already wrapped file alone', () => {
    expect(wrapFixtures("export { test, expect } from '@playwright/test'\n")).toBeNull()
    expect(
      wrapFixtures(
        'export const test = base\nexport const expect = e\n'.replace(
          'export const expect',
          'export const assert'
        )
      )
    ).toBeNull()
    expect(
      wrapFixtures('export const { test, expect } = withWhydiff(base, baseExpect)\n')
    ).toBeNull()
  })
})

describe('addReporter', () => {
  it('turns a reporter name into a list with the whydiff reporter, before html', () => {
    expect(addReporter(CONFIG)).toContain(
      "  reporter: [['@whydiff/playwright/reporter'], ['html']],"
    )
    expect(addReporter('reporter: "list",')).toBe(
      'reporter: [["list"], [\'@whydiff/playwright/reporter\']],'
    )
  })

  it('puts the whydiff reporter before html in a list or a single tuple, else last, and fills an empty list', () => {
    expect(addReporter("reporter: [['html'], ['list', { printSteps: true }]],")).toBe(
      "reporter: [['@whydiff/playwright/reporter'], ['html'], ['list', { printSteps: true }]],"
    )
    expect(addReporter("reporter: [['list'], ['html', { open: 'never' }], ['json']],")).toBe(
      "reporter: [['list'], ['@whydiff/playwright/reporter'], ['html', { open: 'never' }], ['json']],"
    )
    expect(addReporter("reporter: [['list', { a: ['html'] }], ['dot']],")).toBe(
      "reporter: [['list', { a: ['html'] }], ['dot'], ['@whydiff/playwright/reporter']],"
    )
    expect(addReporter("reporter: ['html', { open: 'never' }],")).toBe(
      "reporter: [['@whydiff/playwright/reporter'], ['html', { open: 'never' }]],"
    )
    expect(addReporter("reporter: ['list'],")).toBe(
      "reporter: [['list'], ['@whydiff/playwright/reporter']],"
    )
    expect(addReporter('reporter: [],')).toBe("reporter: [['@whydiff/playwright/reporter']],")
    expect(addReporter("reporter: [['x', { a: ']' }]],")).toBe(
      "reporter: [['x', { a: ']' }], ['@whydiff/playwright/reporter']],"
    )
  })

  it('adds the entry after defineConfig({ when there is none', () => {
    expect(addReporter("export default defineConfig<Options>({\n  testDir: 'tests',\n})\n")).toBe(
      "export default defineConfig<Options>({\n  reporter: [['list'], ['@whydiff/playwright/reporter']],\n  testDir: 'tests',\n})\n"
    )
    expect(addReporter('module.exports = { testDir: "tests" }\n')).toBeNull()
  })
})

describe('moveReporter', () => {
  it('moves a whydiff reporter listed after html before it, the entries kept apart as they were', () => {
    expect(
      moveReporter(
        "reporter: [['list'], ['html', { open: 'never' }], ['@whydiff/playwright/reporter']],"
      )
    ).toBe("reporter: [['list'], ['@whydiff/playwright/reporter'], ['html', { open: 'never' }]],")
    expect(
      moveReporter(
        "  reporter: [\n    ['html'],\n    ['json'],\n    ['@whydiff/playwright/reporter', { outputDir: 'out' }],\n  ],\n"
      )
    ).toBe(
      "  reporter: [\n    ['@whydiff/playwright/reporter', { outputDir: 'out' }],\n    ['html'],\n    ['json'],\n  ],\n"
    )
  })

  it('leaves a whydiff reporter that comes before html, or a list without html, alone', () => {
    expect(moveReporter("reporter: [['@whydiff/playwright/reporter'], ['html']],")).toBeNull()
    expect(moveReporter("reporter: [['list'], ['@whydiff/playwright/reporter']],")).toBeNull()
  })
})

describe('renderDiff', () => {
  it('shows a new file as additions and a change with two lines of context', () => {
    expect(renderDiff({ path: 'a.ts', before: null, after: 'x\ny\n', why: '' })).toBe(
      '--- /dev/null\n+++ a.ts\n+x\n+y\n+\n'
    )
    expect(
      renderDiff({
        path: 'c.ts',
        before: '1\n2\n3\n4\n5\n6\n7\n',
        after: '1\n2\n3\nX\n5\n6\n7\n',
        why: '',
      })
    ).toBe('--- c.ts\n+++ c.ts\n 2\n 3\n-4\n+X\n 5\n 6\n')
  })
})

describe('init', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'whydiff-init-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('prints the diffs and applies nothing without a terminal, then applies them under --yes', async () => {
    await file(join(dir, 'playwright.config.ts'), CONFIG)
    const shown = fakeProcess(dir)
    expect(await run(['init'], shown)).toBe(0)
    expect(shown.text.stdout).toContain('--- /dev/null\n+++ e2e/fixtures.ts\n')
    expect(shown.text.stdout).toContain(
      '+export const { test, expect } = withWhydiff(base, baseExpect)'
    )
    expect(shown.text.stdout).toContain(
      "--- playwright.config.ts\n+++ playwright.config.ts\n export default defineConfig({\n   testDir: './e2e',\n-  reporter: 'html',\n+  reporter: [['@whydiff/playwright/reporter'], ['html']],\n })\n \n"
    )
    expect(shown.text.stdout).toContain(
      '+++ .gitattributes\n+*.whydiff.json -diff linguist-generated=true\n'
    )
    expect(shown.text.stdout).not.toContain('AGENTS.md')
    expect(shown.text.stderr).toBe(
      'nothing applied; run npx whydiff init --yes to apply the edits above\n'
    )
    expect(await readFile(join(dir, 'playwright.config.ts'), 'utf8')).toBe(CONFIG)

    const applied = fakeProcess(dir)
    expect(await run(['init', '--yes'], applied)).toBe(0)
    expect(applied.text.stderr).toBe('applied 3 edits\n')
    expect(await readFile(join(dir, 'playwright.config.ts'), 'utf8')).toContain(
      "reporter: [['@whydiff/playwright/reporter'], ['html']]"
    )
    expect(await readFile(join(dir, 'e2e', 'fixtures.ts'), 'utf8')).toBe(
      "import { expect as baseExpect, test as base } from '@playwright/test'\nimport { withWhydiff } from '@whydiff/playwright'\n\nexport const { test, expect } = withWhydiff(base, baseExpect)\n"
    )
    expect(await readFile(join(dir, '.gitattributes'), 'utf8')).toBe(
      '*.whydiff.json -diff linguist-generated=true\n'
    )
    expect(await readdir(dir)).not.toContain('AGENTS.md')

    const again = fakeProcess(dir)
    expect(await run(['init', '--yes'], again)).toBe(0)
    expect(again.text.stderr).toBe(
      'nothing to do: the project already uses withWhydiff and the reporter\n'
    )
  })

  it('creates the fixtures file next to a config without testDir, the directory Playwright runs the tests of', async () => {
    await file(join(dir, 'playwright.config.mjs'), "export default { reporter: 'html' }\n")
    await file(
      join(dir, 'tests', 'card.spec.mjs'),
      `import { test, expect } from '@playwright/test'\n${SHOT}`
    )
    const p = fakeProcess(dir)
    expect(await run(['init', '--yes'], p)).toBe(0)
    expect(p.text.stdout).toContain('--- /dev/null\n+++ fixtures.js\n')
    expect(await readFile(join(dir, 'fixtures.js'), 'utf8')).toContain(
      'export const { test, expect } = withWhydiff(base, baseExpect)'
    )
    expect(await readdir(join(dir, 'tests'))).toEqual(['card.spec.mjs'])
    expect(await readFile(join(dir, 'tests', 'card.spec.mjs'), 'utf8')).toBe(
      `import { test, expect } from '../fixtures.js'\n${SHOT}`
    )
  })

  it('wraps an existing fixtures file, appends to an existing .gitattributes and leaves AGENTS.md alone', async () => {
    await file(join(dir, 'playwright.config.mjs'), "export default { reporter: [['list']] }\n")
    await file(
      join(dir, 'tests', 'fixtures.js'),
      "import { test as base } from '@playwright/test'\nexport const test = base.extend({})\nexport { expect } from '@playwright/test'\n"
    )
    await file(join(dir, '.gitattributes'), '*.png binary')
    await file(join(dir, 'AGENTS.md'), '# Project\n')
    const p = fakeProcess(dir)
    expect(await run(['init', '--yes'], p)).toBe(0)
    expect(await readFile(join(dir, 'tests', 'fixtures.js'), 'utf8')).toBe(
      "import { test as base } from '@playwright/test'\nimport { expect as baseExpect } from '@playwright/test'\nimport { withWhydiff } from '@whydiff/playwright'\nconst extendedTest = base.extend({})\n\nexport const { test, expect } = withWhydiff(extendedTest, baseExpect)\n"
    )
    expect(await readFile(join(dir, 'playwright.config.mjs'), 'utf8')).toBe(
      "export default { reporter: [['list'], ['@whydiff/playwright/reporter']] }\n"
    )
    expect(await readFile(join(dir, '.gitattributes'), 'utf8')).toBe(
      '*.png binary\n*.whydiff.json -diff linguist-generated=true\n'
    )
    expect(await readFile(join(dir, 'AGENTS.md'), 'utf8')).toBe('# Project\n')
  })

  it('moves a whydiff reporter listed after html before it, as doctor asks', async () => {
    await file(
      join(dir, 'playwright.config.ts'),
      "export default {\n  reporter: [['html'], ['@whydiff/playwright/reporter']],\n}\n"
    )
    await file(
      join(dir, 'tests', 'fixtures.ts'),
      'export const { test, expect } = withWhydiff(base, baseExpect)\n'
    )
    await file(join(dir, '.gitattributes'), '*.whydiff.json -diff linguist-generated=true\n')
    const p = fakeProcess(dir)
    expect(await run(['init', '--yes'], p)).toBe(0)
    expect(p.text.stdout).toBe(
      "--- playwright.config.ts\n+++ playwright.config.ts\n export default {\n-  reporter: [['html'], ['@whydiff/playwright/reporter']],\n+  reporter: [['@whydiff/playwright/reporter'], ['html']],\n }\n \n"
    )
    expect(p.text.stderr).toBe('applied 1 edits\n')
    expect(await readFile(join(dir, 'playwright.config.ts'), 'utf8')).toBe(
      "export default {\n  reporter: [['@whydiff/playwright/reporter'], ['html']],\n}\n"
    )
  })

  it('points the specs that call toHaveScreenshot at the new fixtures file and lists the ones it cannot rewrite', async () => {
    await freshProject(dir)
    const shown = fakeProcess(dir)
    expect(await run(['init'], shown)).toBe(0)
    expect(shown.text.stdout).toContain(
      "--- tests/example.spec.ts\n+++ tests/example.spec.ts\n-import { test, expect } from '@playwright/test';\n+import { test, expect } from './fixtures';\n \n test('card', async ({ page }) => {\n"
    )
    expect(shown.text.stdout).toContain(
      "--- tests/shop/cart.spec.ts\n+++ tests/shop/cart.spec.ts\n-import { test, expect, type Page } from '@playwright/test';\n+import { type Page } from '@playwright/test';\n+import { test, expect } from '../fixtures.js';\n import { open } from '../helpers.js';\n"
    )
    expect(shown.text.stdout).not.toContain('title.spec.ts')
    expect(shown.text.stdout).not.toContain('wide.spec.ts')
    const skipped =
      '; take test and expect from tests/fixtures.ts by hand in tests/wide.spec.ts, whose import init cannot rewrite'
    expect(shown.text.stderr).toBe(
      `nothing applied; run npx whydiff init --yes to apply the edits above${skipped}\n`
    )

    const applied = fakeProcess(dir)
    expect(await run(['init', '--yes'], applied)).toBe(0)
    expect(applied.text.stderr).toBe(`applied 5 edits${skipped}\n`)
    expect(await readFile(join(dir, 'tests', 'example.spec.ts'), 'utf8')).toBe(
      `import { test, expect } from './fixtures';\n${SHOT}`
    )
    expect(await readFile(join(dir, 'tests', 'title.spec.ts'), 'utf8')).toContain(
      "import { test, expect } from '@playwright/test';"
    )
    expect(await readFile(join(dir, 'tests', 'wide.spec.ts'), 'utf8')).toContain(
      "import { test as base, expect } from '@playwright/test';"
    )

    const again = fakeProcess(dir)
    expect(await run(['init', '--yes'], again)).toBe(0)
    expect(again.text.stderr).toBe(
      `nothing to do: the project already uses withWhydiff and the reporter${skipped}\n`
    )
  })

  it('points the specs at a fixtures file that already calls withWhydiff, in their own quotes and with its extension', async () => {
    await file(
      join(dir, 'playwright.config.mjs'),
      "export default { reporter: [['@whydiff/playwright/reporter']] }\n"
    )
    await file(join(dir, '.gitattributes'), '*.whydiff.json -diff linguist-generated=true\n')
    await file(
      join(dir, 'e2e', 'fixtures.js'),
      'export const { test, expect } = withWhydiff(base, baseExpect)\n'
    )
    await file(
      join(dir, 'e2e', 'nested', 'a.spec.js'),
      `import {\n  expect,\n  test,\n} from "@playwright/test"\n${SHOT}`
    )
    const p = fakeProcess(dir)
    expect(await run(['init', '--yes'], p)).toBe(0)
    expect(p.text.stderr).toBe('applied 1 edits\n')
    expect(await readFile(join(dir, 'e2e', 'nested', 'a.spec.js'), 'utf8')).toBe(
      `import { expect, test } from "../fixtures.js"\n${SHOT}`
    )
  })

  it('leaves the fixtures and the specs alone on a release withWhydiff cannot run on, and says to call whydiffCapture', async () => {
    await freshProject(dir)
    await file(
      join(dir, 'node_modules', '@playwright', 'test', 'package.json'),
      '{"version":"1.60.0"}'
    )
    const warning =
      'warning: withWhydiff cannot run on @playwright/test 1.60.0; call whydiffCapture right after each toHaveScreenshot instead, as the @whydiff/playwright README shows under Two ways in\n'
    const p = fakeProcess(dir)
    expect(await run(['init', '--yes'], p)).toBe(0)
    expect(p.text.stdout).toContain('+++ playwright.config.ts\n')
    expect(p.text.stdout).toContain('+++ .gitattributes\n')
    expect(p.text.stdout).not.toContain('fixtures')
    expect(p.text.stdout).not.toContain('spec.ts')
    expect(p.text.stderr).toBe(`${warning}applied 2 edits\n`)
    expect(await readdir(join(dir, 'tests'))).not.toContain('fixtures.ts')

    const again = fakeProcess(dir)
    expect(await run(['init', '--yes'], again)).toBe(0)
    expect(again.text.stderr).toBe(
      `${warning}nothing to do: the project already runs the reporter\n`
    )
  })

  it('asks once for every spec, and not when the fixtures file they would import was declined', async () => {
    await freshProject(dir)
    const ask = async (declined: string): Promise<string[]> => {
      const asked: string[] = []
      const ui: Ui = {
        interactive: true,
        start: () => () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        note: () => undefined,
        confirm: (message) => {
          asked.push(message)
          return Promise.resolve(!message.startsWith(declined))
        },
        choose: () => Promise.resolve(null),
      }
      const args = parseArgs([], INIT_FLAGS, 'init')
      await init(args, { cwd: dir, env: {}, ui, out: () => undefined })
      return asked
    }
    expect(await ask('tests import')).toEqual([
      'tests import test and expect from tests/fixtures.ts: apply this edit to tests/fixtures.ts?',
      'the reporter writes whydiff-report: apply this edit to playwright.config.ts?',
      'snapshots next to baselines stay out of diffs: apply this edit to .gitattributes?',
    ])
    expect(await readFile(join(dir, 'tests', 'example.spec.ts'), 'utf8')).toContain(
      "from '@playwright/test';"
    )
    await rm(join(dir, 'playwright.config.ts'))
    await file(join(dir, 'playwright.config.ts'), FRESH_CONFIG)
    expect(await ask('nothing')).toEqual([
      'tests import test and expect from tests/fixtures.ts: apply this edit to tests/fixtures.ts?',
      'the reporter writes whydiff-report: apply this edit to playwright.config.ts?',
      'the specs that call toHaveScreenshot take test and expect from tests/fixtures.ts: apply these 2 edits?',
    ])
    expect(await readFile(join(dir, 'tests', 'example.spec.ts'), 'utf8')).toContain(
      "from './fixtures';"
    )
  })

  it('warns about a fixtures file it cannot rewrite and refuses a directory without a config', async () => {
    await file(join(dir, 'playwright.config.ts'), CONFIG)
    await file(join(dir, 'e2e', 'fixtures.ts'), "export { test, expect } from '@playwright/test'\n")
    const p = fakeProcess(dir)
    expect(await run(['init'], p)).toBe(0)
    expect(p.text.stderr).toContain(
      'warning: e2e/fixtures.ts exports test in a form init cannot rewrite'
    )
    expect(p.text.stdout).not.toContain('fixtures.ts')
    const empty = fakeProcess(await mkdtemp(join(tmpdir(), 'whydiff-empty-')))
    expect(await run(['init'], empty)).toBe(2)
    expect(empty.text.stderr).toContain('no playwright.config.* in this directory')
  })
})
