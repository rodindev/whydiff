import { expect as plain } from '@playwright/test'
import { whydiffCapture } from '@whydiff/playwright'

import { expect, test } from './fixtures'

const changed = process.env.WHYDIFF_FIXTURE_VARIANT === 'changed'

const BOXES = `
  <style>
    body { margin: 0 }
    .ui-row { display: flex; gap: 4px; width: 300px; padding: 8px; background: #eeeeee }
    .ui-row b { width: 30px; height: 30px; background: #000088 }
  </style>
  <div class="ui-row"><b></b><b></b><b></b></div>
`
// The changed run waits for a locator that never matches, longer than the test may run.
const ROW = changed ? '.ui-missing' : '.ui-row'
const SCREENSHOT_MS = 10_000
const TEST_MS = 2000

test.beforeEach(() => {
  if (changed) test.setTimeout(TEST_MS)
})

test('timed out in its screenshot', async ({ page }) => {
  await page.setContent(BOXES)
  await expect(page.locator(ROW)).toHaveScreenshot('slow.png', { timeout: SCREENSHOT_MS })
})

test('timed out in its screenshot through the explicit call', async ({ page }) => {
  await page.setContent(BOXES)
  await plain.soft(page.locator(ROW)).toHaveScreenshot('explicit-slow.png', {
    timeout: SCREENSHOT_MS,
  })
  await whydiffCapture(page.locator(ROW), 'explicit-slow.png', { timeout: SCREENSHOT_MS })
})
