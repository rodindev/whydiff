import { createRequire } from 'node:module'
import { WhydiffError } from '@whydiff/core'

import { EXCLUDED_PLAYWRIGHT } from './constants.js'

const require = createRequire(import.meta.url)

/** Version of this package, as written into every report. */
export const VERSION: string = ownVersion(require('../package.json'))

/** Version of the `@playwright/test` this package resolves, or null when its manifest cannot be read. */
export function playwrightVersion(): string | null {
  try {
    return versionOf(require('@playwright/test/package.json'))
  } catch {
    return null
  }
}

/** Refuses the releases on which an override of `toHaveScreenshot` breaks every screenshot assertion. */
export function assertSupportedPlaywright(version: string | null): void {
  if (version === null || !EXCLUDED_PLAYWRIGHT.includes(version)) return
  throw new WhydiffError(
    'unsupported-playwright',
    `@playwright/test ${version} lets an override of toHaveScreenshot recurse into the root expect, which breaks every screenshot assertion of the worker. Use 1.59 or earlier, or 1.61.1 or later; whydiffCapture works on every version.`
  )
}

function ownVersion(manifest: unknown): string {
  const version = versionOf(manifest)
  if (version === null) throw new Error('package.json of @whydiff/playwright has no version')
  return version
}

function versionOf(manifest: unknown): string | null {
  if (typeof manifest !== 'object' || manifest === null || !('version' in manifest)) return null
  const { version } = manifest
  return typeof version === 'string' ? version : null
}
