import { expect, test } from './fixtures'

const changed = process.env.WHYDIFF_FIXTURE_VARIANT === 'changed'

/** The banner of reporter.spec.ts above the row of cap.spec.ts, each changed as there: one screenshot under both causes. */
function both(padding: number, gap: number): string {
  return `
    <style>
      body { margin: 0 }
      .banner { display: flex; width: 300px; height: 40px; padding-left: ${padding}px; background: #ccccee }
      .banner i { width: 20px; height: 20px; background: #0000ff }
      .row { display: flex; gap: ${gap}px; width: 300px; padding: 8px; background: #eeeeee }
      .row b { width: 30px; height: 30px; background: #008800 }
    </style>
    <div class="banner"><i></i></div>
    <div class="row"><b></b><b></b><b></b></div>
  `
}

test('both', async ({ page }) => {
  await page.setContent(changed ? both(16, 12) : both(0, 4))
  await expect(page).toHaveScreenshot('both.png')
})
