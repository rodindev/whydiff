import { expect, test, type Page } from '@playwright/test'
import { whydiffCapture } from '@whydiff/playwright'

const changed = process.env.WHYDIFF_FIXTURE_VARIANT === 'changed'

/** The matcher project's card: a grey card holding a red dot; the changed variant pads the card, which moves the dot. */
function card(padding: number): string {
  return `
    <style>
      body { margin: 0 }
      #card { width: 200px; height: 80px; padding-left: ${padding}px; background: #dddddd }
      .dot { width: 40px; height: 40px; background: #ff0000 }
    </style>
    <div id="card"><div class="dot"></div></div>
  `
}

/** A grid of styled cells, enough of them that one capture takes seconds and two overran the old budget. */
function grid(rows: number, cols: number): string {
  const lines: string[] = []
  for (let row = 0; row < rows; row++) {
    const cells: string[] = []
    for (let col = 0; col < cols; col++) {
      cells.push(`<span class="c${col % 7}" style="padding: ${col % 3}px">${row}:${col}</span>`)
    }
    lines.push(`<div class="r${row % 5}">${cells.join('')}</div>`)
  }
  return `
    <style>
      body { margin: 0; font: 10px/12px monospace }
      div { display: flex; flex-wrap: wrap; width: 780px; border-bottom: 1px solid #cccccc }
      .r0 { background: #fafafa } .r1 { background: #f0f0ff } .r2 { background: #fff0f0 }
      .r3 { background: #f0fff0 } .r4 { background: #fffff0 }
      span { margin: 1px; border: 1px solid #888888; color: #333333 }
      .c0 { color: #aa0000 } .c1 { font-weight: bold } .c2 { text-decoration: underline }
      .c3 { letter-spacing: 1px } .c4 { border-radius: 3px } .c5 { opacity: 0.9 } .c6 { background: #eeeeee }
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

const CARD = card(changed ? 24 : 0)
const STABLE = card(0)
const HEAVY = grid(1400, 20)

test('named failure', async ({ page }) => {
  await page.setContent(CARD)
  await expect.soft(page).toHaveScreenshot('card.png')
  await whydiffCapture(page, 'card.png')
})

test('backfill on a pass', async ({ page }) => {
  await page.setContent(STABLE)
  await expect.soft(page).toHaveScreenshot('backfill.png')
  await whydiffCapture(page, 'backfill.png')
})

test('stale sidecar on a pass', async ({ page }) => {
  await page.setContent(STABLE)
  await expect.soft(page).toHaveScreenshot('stale.png')
  await whydiffCapture(page, 'stale.png')
})

test('unnamed call', async ({ page }) => {
  await page.setContent(STABLE)
  await expect.soft(page.locator('#card')).toHaveScreenshot()
  await whydiffCapture(page.locator('#card'))
})

test('missing baseline', async ({ page }) => {
  test.skip(!changed, 'the baseline is written by the second run')
  await page.setContent(STABLE)
  await expect.soft(page).toHaveScreenshot('fresh.png')
  await whydiffCapture(page, 'fresh.png')
})

test('no baseline snapshot', async ({ page }) => {
  await page.setContent(CARD)
  await expect.soft(page).toHaveScreenshot('bare.png')
  await whydiffCapture(page, 'bare.png')
})

test('injected failure on a mismatch', async ({ page }) => {
  await page.setContent(CARD)
  await expect.soft(page).toHaveScreenshot('injected.png')
  await whydiffCapture(page, 'injected.png')
})

test('injected failure on a pass', async ({ page }) => {
  await page.setContent(STABLE)
  await expect.soft(page).toHaveScreenshot('injected-pass.png')
  await whydiffCapture(page, 'injected-pass.png')
})

test('heavy page captured once', async ({ page }) => {
  await page.setContent(HEAVY)
  const sessions = countSessions(page)
  await expect.soft(page).toHaveScreenshot('heavy.png')
  await whydiffCapture(page, 'heavy.png')
  test.info().annotations.push({ type: 'cdp-sessions', description: String(sessions()) })
})

test('over budget', async ({ page }) => {
  await page.setContent(STABLE)
  await expect.soft(page).toHaveScreenshot('over-budget.png')
  await whydiffCapture(page, 'over-budget.png')
})
