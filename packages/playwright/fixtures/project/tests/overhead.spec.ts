import { expect as plain, type Page } from '@playwright/test'
import { whydiffCapture } from '@whydiff/playwright'

import { expect, test } from './fixtures'

/** A grey card holding a red dot. */
const CARD = `
  <style>
    body { margin: 0 }
    #card { width: 200px; height: 80px; background: #dddddd }
    .dot { width: 40px; height: 40px; background: #ff0000 }
  </style>
  <div id="card"><div class="dot"></div></div>
`

/** Rows of plain cells: quick to load and to screenshot, seconds to capture. */
function grid(rows: number, cols: number): string {
  const lines: string[] = []
  for (let row = 0; row < rows; row++) {
    const cells: string[] = []
    for (let col = 0; col < cols; col++) cells.push(`<span>${row}:${col}</span>`)
    lines.push(`<div>${cells.join('')}</div>`)
  }
  return `
    <style>
      body { margin: 0; font: 10px/12px monospace }
      div { display: flex; flex-wrap: wrap; width: 780px }
    </style>
    ${lines.join('')}
  `
}

/** Counts the CDP sessions opened on the page's context from now on: one per whydiff capture. */
function countSessions(page: Page): () => number {
  const context = page.context()
  const open = context.newCDPSession.bind(context)
  let count = 0
  context.newCDPSession = (target) => {
    count += 1
    return open(target)
  }
  return () => count
}

const SLOW = grid(1000, 20)

test('slow capture through the matcher', async ({ page }) => {
  test.setTimeout(2000)
  await page.setContent(SLOW)
  await expect(page).toHaveScreenshot('slow-matcher.png')
})

test('slow capture through the explicit call', async ({ page }) => {
  test.setTimeout(2000)
  await page.setContent(SLOW)
  await plain.soft(page).toHaveScreenshot('slow-explicit.png')
  await whydiffCapture(page, 'slow-explicit.png')
})

test('pass through the matcher', async ({ page }) => {
  await page.setContent(CARD)
  const sessions = countSessions(page)
  await expect(page).toHaveScreenshot('pass-matcher.png')
  test.info().annotations.push({ type: 'cdp-sessions', description: String(sessions()) })
})

test('pass through the explicit call', async ({ page }) => {
  await page.setContent(CARD)
  const sessions = countSessions(page)
  await plain.soft(page).toHaveScreenshot('pass-explicit.png')
  await whydiffCapture(page, 'pass-explicit.png')
  test.info().annotations.push({ type: 'cdp-sessions', description: String(sessions()) })
})

test.describe('assertions in an afterEach hook', () => {
  test.afterEach(async ({ page }) => {
    await expect(page).toHaveScreenshot('after-each-matcher.png')
    await plain.soft(page).toHaveScreenshot('after-each-explicit.png')
    await whydiffCapture(page, 'after-each-explicit.png')
  })

  test('pass in an afterEach hook', async ({ page }) => {
    await page.setContent(CARD)
  })
})

/** Takes a screenshot of the page while its fixtures are torn down. */
const teardown = test.extend<{ shotOnTeardown: void }>({
  shotOnTeardown: [
    async ({ page }, use) => {
      await use()
      await expect(page).toHaveScreenshot('teardown.png')
    },
    { auto: true },
  ],
})

teardown('pass in a fixture teardown', async ({ page }) => {
  await page.setContent(CARD)
})

