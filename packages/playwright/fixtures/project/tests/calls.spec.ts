import { expect, test } from '@playwright/test'
import { whydiffCapture } from '@whydiff/playwright'

const PAGE = `
  <style>body { margin: 0 } .box { width: 40px; height: 40px; background: #ff0000 }</style>
  <div class="box" id="first"></div>
  <div class="box" id="second" style="background: #0000ff"></div>
`

test('named page screenshot', async ({ page }) => {
  await page.setContent(PAGE)
  await expect.soft(page).toHaveScreenshot('home.png', { fullPage: true })
  await whydiffCapture(page, 'home.png', { fullPage: true })
})

test('anonymous locator screenshots', async ({ page }) => {
  await page.setContent(PAGE)
  await expect.soft(page.locator('#first')).toHaveScreenshot({ animations: 'allow' })
  await whydiffCapture(page.locator('#first'), { animations: 'allow' })
  await expect.soft(page.locator('#second')).toHaveScreenshot(['nested', 'second.png'])
  await whydiffCapture(page.locator('#second'), ['nested', 'second.png'])
})

test('a locator that matches twice is reported, not thrown', async ({ page }) => {
  await page.setContent(PAGE)
  await whydiffCapture(page.locator('.box'), 'boxes.png', { clip: { x: 0, y: 0, width: 10, height: 10 } })
})
