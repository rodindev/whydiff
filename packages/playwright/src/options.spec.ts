import type { Locator } from '@playwright/test'

import { parseArgs, resolveCapture, resolveSettings, useOptions } from './options.js'

describe('parseArgs', () => {
  it.each([
    [[], null, {}],
    [['a.png'], ['a.png'], {}],
    [[['dir', 'a.png']], ['dir', 'a.png'], {}],
    [[{ fullPage: true }], null, { fullPage: true }],
    [['a.png', { caret: 'initial' }], ['a.png'], { caret: 'initial' }],
  ] as const)('reads %j', (args, name, options) => {
    expect(parseArgs([...args])).toEqual({ name, options })
  })
})

describe('resolveCapture', () => {
  const mask = {} as Locator // only passed through

  it('lets the call win over the project defaults and keeps absent values absent', () => {
    const resolved = resolveCapture(
      { threshold: 0.35, maxDiffPixels: 0, animations: 'disabled', stylePath: 'a.css' },
      {
        threshold: 0.1,
        caret: 'initial',
        fullPage: true,
        mask: [mask],
        stylePath: ['b.css', 'c.css'],
      }
    )
    expect(resolved).toEqual({
      capture: {
        compare: { threshold: 0.1, maxDiffPixels: 0 },
        animations: 'disabled',
        caret: 'initial',
        fullPage: true,
      },
      stylePaths: ['b.css', 'c.css'],
      mask: [mask],
      unsupported: [],
    })
  })

  it('names the options a snapshot cannot express', () => {
    const resolved = resolveCapture(
      {},
      { clip: { x: 0, y: 0, width: 1, height: 1 }, omitBackground: true }
    )
    expect(resolved.unsupported).toEqual(['clip', 'omitBackground'])
    expect(resolved.capture).toEqual({ compare: {} })
    expect(resolved.stylePaths).toEqual([])
  })
})

describe('useOptions', () => {
  it('returns the whydiff entry of a use block and nothing for anything else', () => {
    expect(useOptions({ whydiff: { threshold: 0.2 }, viewport: null })).toEqual({ threshold: 0.2 })
    expect(useOptions({ viewport: null })).toEqual({})
    expect(useOptions(undefined)).toEqual({})
    expect(useOptions({ whydiff: 'no' })).toEqual({})
  })
})

describe('resolveSettings', () => {
  it('turns everything on with a minute of budget and a fuse of 500 in-test explanations unless use.whydiff says otherwise', () => {
    expect(resolveSettings({ threshold: 0.1 })).toEqual({
      use: { threshold: 0.1 },
      enabled: true,
      backfill: true,
      budgetMs: 60000,
      attach: true,
      maxExplained: 500,
    })
    expect(
      resolveSettings({
        enabled: false,
        backfill: false,
        budgetMs: 50,
        attach: false,
        maxExplained: 0,
      })
    ).toMatchObject({
      enabled: false,
      backfill: false,
      budgetMs: 50,
      attach: false,
      maxExplained: 0,
    })
  })
})
