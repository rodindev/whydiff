import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, webkit, type ReporterDescription } from '@playwright/test'
import type { WhydiffUseOptions } from '@whydiff/playwright'

const env = process.env
const executablePath = env.WHYDIFF_CHROMIUM
const viewport = { width: 800, height: 600 }
const snapshotPathTemplate = `${env.WHYDIFF_FIXTURE_SNAPSHOTS ?? './snapshots'}/{testFilePath}/{arg}{ext}`
const reporter: ReporterDescription[] = [['json', { outputFile: env.WHYDIFF_FIXTURE_REPORT }]]
if (env.WHYDIFF_FIXTURE_WHYDIFF_REPORT !== undefined) {
  // Playwright resolves reporter names from outside this package, where its self-reference does not apply.
  const whydiff = fileURLToPath(import.meta.resolve('@whydiff/playwright/reporter'))
  reporter.push([whydiff, { outputDir: env.WHYDIFF_FIXTURE_WHYDIFF_REPORT }])
}
if (env.WHYDIFF_FIXTURE_HTML !== undefined) {
  const html: ReporterDescription = ['html', { open: 'never', outputFolder: env.WHYDIFF_FIXTURE_HTML }]
  // Ahead of the whydiff reporter only to show what the order changes.
  if (env.WHYDIFF_FIXTURE_HTML_FIRST === '1') reporter.unshift(html)
  else reporter.push(html)
}
if (env.WHYDIFF_FIXTURE_BLOB !== undefined) {
  reporter.push(['blob', { outputDir: env.WHYDIFF_FIXTURE_BLOB }])
}

export default defineConfig<{ whydiff: WhydiffUseOptions }>({
  testDir: './tests',
  outputDir: env.WHYDIFF_FIXTURE_OUTPUT ?? './test-results',
  workers: 1,
  reporter,
  use: {
    whydiff: { threshold: 0.35, maxDiffPixels: 0 },
    ...(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
  },
  projects: [
    { name: 'desktop', testMatch: 'calls.spec.ts', ignoreSnapshots: true, use: { viewport } },
    {
      name: 'matcher',
      testMatch: 'matcher.spec.ts',
      snapshotPathTemplate,
      use: { viewport, whydiff: {} },
    },
    {
      name: 'reporter',
      testMatch: 'reporter.spec.ts',
      fullyParallel: true,
      snapshotPathTemplate,
      use: { viewport, whydiff: {} },
    },
    {
      name: 'explicit',
      testMatch: 'explicit.spec.ts',
      grepInvert: /injected failure|over budget/,
      snapshotPathTemplate,
      use: { viewport, whydiff: {} },
    },
    {
      name: 'explicit-missing-style',
      testMatch: 'explicit.spec.ts',
      grep: /injected failure/,
      snapshotPathTemplate,
      use: { viewport, whydiff: { stylePath: './missing.css' } },
    },
    {
      name: 'explicit-budget',
      testMatch: 'explicit.spec.ts',
      grep: /over budget/,
      snapshotPathTemplate,
      use: { viewport, whydiff: { budgetMs: 1 } },
    },
    {
      name: 'cap',
      testMatch: 'cap.spec.ts',
      fullyParallel: true,
      snapshotPathTemplate,
      use: { viewport, whydiff: { maxExplained: 1 } },
    },
    {
      name: 'failures',
      testMatch: 'failures.spec.ts',
      snapshotPathTemplate,
      use: { viewport, whydiff: { maxExplained: 1 } },
    },
    {
      name: 'causes',
      testMatch: 'causes.spec.ts',
      snapshotPathTemplate,
      use: { viewport, whydiff: {} },
    },
    {
      name: 'overhead',
      testMatch: 'overhead.spec.ts',
      snapshotPathTemplate,
      use: { viewport, whydiff: {} },
    },
    {
      name: 'retries',
      testMatch: 'retries.spec.ts',
      snapshotPathTemplate,
      use: { viewport, whydiff: {} },
    },
    {
      name: 'timeouts',
      testMatch: 'timeouts.spec.ts',
      snapshotPathTemplate,
      use: { viewport, whydiff: {} },
    },
    ...(existsSync(webkit.executablePath())
      ? [
          {
            name: 'webkit',
            testMatch: 'browsers.spec.ts',
            snapshotPathTemplate,
            use: { browserName: 'webkit' as const, viewport, whydiff: {} },
          },
        ]
      : []),
  ],
})
