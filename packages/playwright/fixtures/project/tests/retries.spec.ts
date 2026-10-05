import { expect, test } from './fixtures'

const changed = process.env.WHYDIFF_FIXTURE_VARIANT === 'changed'

/** A row of three boxes; the changed run widens the gap between them. */
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

/** The row of the changed run with the first attempt's gap, then the retry's; the baseline run's gap is 4. */
function row(first: number, retry: number): string {
  if (!changed) return boxes(4)
  return boxes(test.info().retry === 0 ? first : retry)
}

test.describe.configure({ retries: 1 })

test.describe('a retry that times out before its screenshot', () => {
  test.beforeEach(async ({}, testInfo) => {
    if (testInfo.retry === 0) return
    testInfo.setTimeout(500)
    await new Promise((resolve) => setTimeout(resolve, 2000))
  })

  test('timed out', async ({ page }) => {
    await page.setContent(row(12, 12))
    await expect(page).toHaveScreenshot('timed-out.png')
  })
})

test('passed on retry', async ({ page }) => {
  await page.setContent(row(12, 4))
  await expect(page).toHaveScreenshot('flaky.png')
})

test('another difference on retry', async ({ page }) => {
  await page.setContent(row(12, 20))
  await expect(page).toHaveScreenshot('other.png')
})

test('a retry that reaches only the first screenshot', async ({ page }) => {
  await page.setContent(row(12, 12))
  await expect.soft(page).toHaveScreenshot('first.png')
  if (test.info().retry > 0) throw new Error('the retry ends here')
  await expect(page).toHaveScreenshot('second.png')
})
