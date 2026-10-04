import { expect, test } from './fixtures'

const changed = process.env.WHYDIFF_FIXTURE_VARIANT === 'changed'

/** A blue banner with an icon; the changed variant pads it, the same change in every test. */
function banner(padding: number): string {
  return `
    <style>
      body { margin: 0 }
      .banner { display: flex; width: 300px; height: 40px; padding-left: ${padding}px; background: #ccccee }
      .banner i { width: 20px; height: 20px; background: #0000ff }
    </style>
    <div class="banner"><i></i></div>
  `
}

const BANNER = banner(changed ? 16 : 0)

test('header', async ({ page }) => {
  await page.setContent(BANNER)
  await expect(page).toHaveScreenshot('header.png')
})

test('footer', async ({ page }) => {
  await page.setContent(BANNER)
  await expect(page).toHaveScreenshot('footer.png')
})

test('stable', async ({ page }) => {
  await page.setContent(banner(0))
  await expect(page).toHaveScreenshot('stable.png')
})

test('bare', async ({ page }) => {
  await page.setContent(BANNER)
  await expect(page).toHaveScreenshot('bare.png')
})

test.describe('switched off', () => {
  test.use({ whydiff: { enabled: false } })

  test('unexplained', async ({ page }) => {
    await page.setContent(BANNER)
    await expect(page).toHaveScreenshot('unexplained.png')
  })
})
