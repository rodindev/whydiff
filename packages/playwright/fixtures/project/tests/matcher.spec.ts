import { expect, test } from './fixtures'

const changed = process.env.WHYDIFF_FIXTURE_VARIANT === 'changed'

/** A grey card holding a red dot; the changed variant pads the card, which moves the dot. */
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

const CARD = card(changed ? 24 : 0)
const STABLE = card(0)

test('named failure', async ({ page }) => {
  await page.setContent(CARD)
  await expect(page).toHaveScreenshot('card.png')
})

test('unnamed calls', async ({ page }) => {
  await page.setContent(STABLE)
  await expect(page.locator('#card')).toHaveScreenshot()
  await expect(page.locator('.dot')).toHaveScreenshot()
})

test('negated on a mismatch', async ({ page }) => {
  await page.setContent(CARD)
  if (changed) await expect(page).not.toHaveScreenshot('negated.png')
  else await expect(page).toHaveScreenshot('negated.png')
})

test('soft failure keeps the test running', async ({ page }) => {
  await page.setContent(CARD)
  await expect.soft(page).toHaveScreenshot('soft.png')
  test.info().annotations.push({ type: 'reached' })
})

test('backfill on a pass', async ({ page }) => {
  await page.setContent(STABLE)
  await expect(page).toHaveScreenshot('backfill.png')
})

test.describe('without backfill', () => {
  test.use({ whydiff: { backfill: false } })

  test('no backfill on a pass', async ({ page }) => {
    await page.setContent(STABLE)
    await expect(page).toHaveScreenshot('no-backfill.png')
  })
})

test('missing baseline', async ({ page }) => {
  test.skip(!changed, 'the baseline is written by the second run')
  await page.setContent(STABLE)
  await expect(page).toHaveScreenshot('fresh.png')
})

test('no baseline snapshot', async ({ page }) => {
  await page.setContent(CARD)
  await expect(page).toHaveScreenshot('bare.png')
})

test('errored call', async ({ page }) => {
  await page.setContent(STABLE)
  await expect(page).toHaveScreenshot('no-extension')
})

test.describe('with a style path that does not exist', () => {
  test.use({ whydiff: { stylePath: './missing.css' } })

  test('injected failure on a mismatch', async ({ page }) => {
    await page.setContent(CARD)
    await expect(page).toHaveScreenshot('injected.png')
  })

  test('injected failure on a pass', async ({ page }) => {
    await page.setContent(STABLE)
    await expect(page).toHaveScreenshot('injected-pass.png')
  })
})

test.describe('switched off', () => {
  test.use({ whydiff: { enabled: false } })

  test('disabled', async ({ page }) => {
    await page.setContent(STABLE)
    await expect(page).toHaveScreenshot('disabled.png')
  })
})

test.describe('without attachments', () => {
  test.use({ whydiff: { attach: false } })

  test('unattached failure', async ({ page }) => {
    await page.setContent(CARD)
    await expect(page).toHaveScreenshot('unattached.png')
  })
})

test.describe('without a budget', () => {
  test.use({ whydiff: { budgetMs: 0 } })

  test('over budget', async ({ page }) => {
    await page.setContent(STABLE)
    await expect(page).toHaveScreenshot('over-budget.png')
  })
})

test('taller by a blank strip', async ({ page }) => {
  await page.setContent(`
    <style>
      body { margin: 0 }
      .ui-bar { height: 40px; background: #dddddd }
      .ui-space { height: ${changed ? 700 : 0}px }
    </style>
    <div class="ui-bar"></div><div class="ui-space"></div>
  `)
  await expect(page).toHaveScreenshot('taller.png', { fullPage: true })
})
