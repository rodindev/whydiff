import { expect as plain } from '@playwright/test'
import { whydiffCapture } from '@whydiff/playwright'

import { expect, test } from './fixtures'

const changed = process.env.WHYDIFF_FIXTURE_VARIANT === 'changed'

/** A row of three boxes; the changed variant widens the gap between them. */
function boxes(gap: number): string {
  return `
    <style>
      body { margin: 0 }
      .ui-row { display: flex; gap: ${gap}px; width: 300px; padding: 8px; background: #eeeeee }
      .ui-row b { width: 30px; height: 30px; background: #000088 }
    </style>
    <div class="ui-row"><b></b><b></b><b></b></div>
  `
}

const BOXES = boxes(changed ? 12 : 4)
const ROW = changed ? '.ui-missing' : '.ui-row'
// Short only where the locator is missing on purpose; writing the baseline gets the default.
const ROW_TIMEOUT = changed ? 500 : 5000

// Runs first in its worker, so its screenshots hold the run's one in-test explanation.
test('retried in a loop', async ({ page }) => {
  let attempt = 0
  await plain(async () => {
    attempt += 1
    await page.setContent(attempt < 4 ? BOXES : boxes(4))
    await expect(page).toHaveScreenshot('loop.png')
  }).toPass({ intervals: [0] })
  await page.setContent(BOXES)
  await expect.soft(page).toHaveScreenshot('after.png')
})

test('missing locator', async ({ page }) => {
  await page.setContent(BOXES)
  await expect(page.locator(ROW)).toHaveScreenshot('row.png', { timeout: ROW_TIMEOUT })
})

test('missing locator through the explicit call', async ({ page }) => {
  await page.setContent(BOXES)
  await plain.soft(page.locator(ROW)).toHaveScreenshot('explicit-row.png', { timeout: ROW_TIMEOUT })
  await whydiffCapture(page.locator(ROW), 'explicit-row.png', { timeout: ROW_TIMEOUT })
})

test('locator gone before the capture', async ({ page }) => {
  await page.setContent(boxes(4))
  await plain.soft(page.locator('.ui-row')).toHaveScreenshot('gone.png')
  await page.locator('.ui-row').evaluate((row) => {
    row.remove()
  })
  await whydiffCapture(page.locator('.ui-row'), 'gone.png')
})

test('baseline never written', async ({ page }) => {
  test.skip(!changed, 'the second run asserts against a baseline nobody wrote')
  await page.setContent(BOXES)
  await expect(page).toHaveScreenshot('never.png')
})

test.describe('without attachments', () => {
  test.use({ whydiff: { maxExplained: 1, attach: false } })

  test('unattached', async ({ page }) => {
    await page.setContent(BOXES)
    await expect(page).toHaveScreenshot('unattached.png')
  })
})

test('the run directory of the reporter', () => {
  test.info().annotations.push({ type: 'run-dir', description: process.env.WHYDIFF_RUN_DIR ?? '' })
})
