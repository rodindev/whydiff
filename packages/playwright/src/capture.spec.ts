import type { Page, TestInfo } from '@playwright/test'

import { onChromium } from './capture.js'

function pageIn(browserName: string | null): Page {
  const browser = browserName === null ? null : { browserType: () => ({ name: () => browserName }) }
  return { context: () => ({ browser: () => browser }) } as unknown as Page // only the browser name is read
}

const testInfo = (): TestInfo => ({ annotations: [] }) as unknown as TestInfo // only annotations are written

describe('onChromium', () => {
  it('lets Chromium and contexts without a browser object through', () => {
    const info = testInfo()
    expect(onChromium(info, pageIn('chromium'))).toBe(true)
    expect(onChromium(info, pageIn(null))).toBe(true)
    expect(info.annotations).toEqual([])
  })

  it('annotates any other browser once per test', () => {
    const info = testInfo()
    expect(onChromium(info, pageIn('webkit'))).toBe(false)
    expect(onChromium(info, pageIn('webkit'))).toBe(false)
    expect(info.annotations).toEqual([
      {
        type: 'whydiff',
        description: 'webkit screenshots are not explained: whydiff captures in Chromium only',
      },
    ])
    const other = testInfo()
    onChromium(other, pageIn('firefox'))
    expect(other.annotations).toHaveLength(1)
  })
})
