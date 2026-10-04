import { createRequire } from 'node:module'
import { WhydiffError } from '@whydiff/core'

import { assertSupportedPlaywright, playwrightVersion, VERSION } from './version.js'

const require = createRequire(import.meta.url)

describe('assertSupportedPlaywright', () => {
  it.each(['1.53.0', '1.61.1', '1.64.0-alpha', null])('accepts %s', (version) => {
    expect(() => {
      assertSupportedPlaywright(version)
    }).not.toThrow()
  })

  it.each(['1.60.0', '1.61.0'])('refuses %s and names the releases that work', (version) => {
    let thrown: unknown
    try {
      assertSupportedPlaywright(version)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(WhydiffError)
    expect(thrown).toMatchObject({ code: 'unsupported-playwright' })
    expect(String(thrown)).toContain(`${version} lets an override of toHaveScreenshot recurse`)
    expect(String(thrown)).toContain('Use 1.59 or earlier, or 1.61.1 or later')
  })
})

describe('versions', () => {
  it('reads the resolved @playwright/test and this package', () => {
    expect(playwrightVersion()).toBe(
      (require('@playwright/test/package.json') as { version: string }).version // a manifest
    )
    expect(VERSION).toBe((require('../package.json') as { version: string }).version) // a manifest
  })
})
