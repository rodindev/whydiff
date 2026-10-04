import type {
  Expect,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from '@playwright/test'

import { recordSettings, toHaveScreenshot } from './matcher.js'
import { useOptions, type WhydiffUseOptions } from './options.js'
import { assertSupportedPlaywright, playwrightVersion } from './version.js'

type BaseTest = TestType<
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>

/** Wraps a project's `test` and `expect` so every `toHaveScreenshot` keeps and explains render-tree snapshots; apply it last. */
export function withWhydiff<T extends BaseTest, E extends Expect>(
  test: T,
  expect: E
): { test: T; expect: E } {
  assertSupportedPlaywright(playwrightVersion())
  const extended = test.extend<{ whydiff: WhydiffUseOptions; whydiffSettings: undefined }>({
    whydiff: [{}, { option: true }],
    whydiffSettings: [
      async ({ whydiff }, use, testInfo) => {
        recordSettings(testInfo, useOptions({ whydiff }))
        await use(undefined)
      },
      { auto: true },
    ],
  })
  return {
    test: extended as unknown as T, // the added fixtures are internal
    expect: expect.extend({ toHaveScreenshot }) as unknown as E, // same matcher, same signature
  }
}
