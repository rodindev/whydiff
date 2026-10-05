import { errors, type Locator, type Page } from 'playwright-core'

import { elementPng, waitFor } from './snap.js'

const TIMEOUT = new errors.TimeoutError('locator.screenshot: Timeout 30000ms exceeded.')

/** A locator whose screenshot fails with `error` while `count` elements match it. */
function failing(error: Error, count: number): Locator {
  const locator = {
    screenshot: () => Promise.reject(error),
    count: () => Promise.resolve(count),
  }
  return locator as unknown as Locator // only these two methods are called
}

describe('elementPng', () => {
  it('names the elements a selector matches when Playwright refuses to pick one', async () => {
    const strict = new Error(
      "locator.screenshot: Error: strict mode violation: locator('div') resolved to 2 elements"
    )
    await expect(elementPng(failing(strict, 2), 'div')).rejects.toThrow(
      '--selector div matches 2 elements and snap captures one. Narrow it to one, for example --selector "div >> nth=0" for the first.'
    )
  })

  it('says what to check when no element matched before the timeout', async () => {
    await expect(elementPng(failing(TIMEOUT, 0), '.ui-missing')).rejects.toThrow(
      "--selector .ui-missing matched no element before Playwright's timeout. Check the selector against the page, or let the page settle first with --wait-for."
    )
  })

  it("keeps any other error of Playwright's as it is", async () => {
    const closed = new Error('locator.screenshot: Target page, context or browser has been closed')
    await expect(elementPng(failing(closed, 1), 'main')).rejects.toBe(closed)
  })
})

describe('waitFor', () => {
  it('says what to do when the element it waits for never comes', async () => {
    const page = {
      locator: () => ({ first: () => ({ waitFor: () => Promise.reject(TIMEOUT) }) }),
    } as unknown as Page // only locator().first().waitFor() is called
    await expect(waitFor(page, 'main')).rejects.toThrow(
      "--wait-for main matched no element before Playwright's timeout. Check the selector against the page, or wait a number of milliseconds instead, as --wait-for 2000 does."
    )
  })
})
