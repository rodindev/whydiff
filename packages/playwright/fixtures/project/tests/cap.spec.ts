import { expect, test } from './fixtures'

const changed = process.env.WHYDIFF_FIXTURE_VARIANT === 'changed'

/** A row of three boxes; the changed variant widens the gap between them, the same change in every test. */
function boxes(gap: number): string {
  return `
    <style>
      body { margin: 0 }
      .row { display: flex; gap: ${gap}px; width: 300px; padding: 8px; background: #eeeeee }
      .row b { width: 30px; height: 30px; background: #008800 }
    </style>
    <div class="row"><b></b><b></b><b></b></div>
  `
}

const BOXES = boxes(changed ? 12 : 4)

test('first', async ({ page }) => {
  await page.setContent(BOXES)
  await expect(page).toHaveScreenshot('first.png')
})

test('second', async ({ page }) => {
  await page.setContent(BOXES)
  await expect(page).toHaveScreenshot('second.png')
})

test('third', async ({ page }) => {
  await page.setContent(BOXES)
  await expect(page).toHaveScreenshot('third.png')
})

test.describe('with a style path that does not exist', () => {
  test.use({ whydiff: { maxExplained: 1, stylePath: './missing.css' } })

  test('injected failure', async ({ page }) => {
    await page.setContent(BOXES)
    await expect(page).toHaveScreenshot('injected.png')
  })
})
