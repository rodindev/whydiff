import { expect, test } from './fixtures'

test('another browser', async ({ page }) => {
  await page.setContent('<div style="width: 40px; height: 40px; background: #ff0000"></div>')
  await expect(page).toHaveScreenshot('browser.png')
})
