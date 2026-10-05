import { expect as baseExpect, test as base } from '@playwright/test'
import { whydiffCapture } from '@whydiff/playwright'

import { expect, test } from './fixtures'

const changed = process.env.WHYDIFF_FIXTURE_VARIANT === 'changed'

/** A grey panel holding a blue bar; the changed variant pads the panel, which moves the bar. */
function panel(padding: number): string {
  return `
    <style>
      body { margin: 0 }
      .ui-panel { width: 240px; height: 60px; padding-left: ${padding}px; background: #e0e0e0 }
      .ui-bar { width: 80px; height: 20px; background: #3366cc }
    </style>
    <div class="ui-panel"><div class="ui-bar"></div></div>
  `
}

const PANEL = panel(changed ? 12 : 0)

test('unnamed call', async ({ page }) => {
  await page.setContent(PANEL)
  await expect(page.locator('.ui-panel')).toHaveScreenshot()
})

test('name the built-in rewrites', async ({ page }) => {
  await page.setContent(PANEL)
  await expect(page).toHaveScreenshot('ui_header.png')
})

test('name in segments', async ({ page }) => {
  await page.setContent(PANEL)
  await expect(page).toHaveScreenshot(['ui', 'panel.png'])
})

test('name used twice', async ({ page }) => {
  await page.setContent(PANEL)
  await expect.soft(page).toHaveScreenshot('ui-panel.png')
  await expect.soft(page).toHaveScreenshot('ui-panel.png')
})

test('unchanged', async ({ page }) => {
  await page.setContent(panel(0))
  await expect(page).toHaveScreenshot('ui-stable.png')
})

base('explicit calls', async ({ page }) => {
  await page.setContent(PANEL)
  await baseExpect.soft(page.locator('.ui-panel')).toHaveScreenshot()
  await whydiffCapture(page.locator('.ui-panel'))
  await baseExpect.soft(page).toHaveScreenshot('ui_footer.png')
  await whydiffCapture(page, 'ui_footer.png')
})
