import { expect, test } from './fixtures'

for (const screen of ['items', 'settings', 'usage']) {
  test(screen, async ({ page }) => {
    await page.goto(`/${screen}.html`)
    await expect(page).toHaveScreenshot(`${screen}.png`)
  })
}
