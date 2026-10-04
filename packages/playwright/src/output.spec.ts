import type { TestInfo } from '@playwright/test'

import { outputRoot, predictBaseline, sanitizeName, sidecarPath, snapshotPath } from './output.js'

const testInfo = {
  config: { rootDir: '/repo/tests', configFile: '/repo/playwright.config.ts' },
  project: { name: 'desktop us' },
  testId: 'abc123-def',
  retry: 0,
} as TestInfo // only these fields are read

describe('sanitizeName', () => {
  it.each([
    [null, 'screenshot'],
    [['home.png'], 'home'],
    [['shop', 'cart.PNG'], 'shop-cart'],
    [['Save / cancel?.png'], 'Save-cancel-'],
    [['.png'], 'screenshot'],
  ])('turns %j into %s', (name, expected) => {
    expect(sanitizeName(name)).toBe(expected)
  })
})

describe('outputRoot', () => {
  afterEach(() => {
    delete process.env.WHYDIFF_OUT
  })

  it('prefers the environment, then use.whydiff, and is null without either', () => {
    expect(outputRoot({})).toBeNull()
    expect(outputRoot({ outputDir: '/elsewhere' })).toBe('/elsewhere')
    process.env.WHYDIFF_OUT = '/env'
    expect(outputRoot({})).toBe('/env')
    expect(outputRoot({ outputDir: '/elsewhere' })).toBe('/env')
  })
})

describe('snapshotPath', () => {
  it('nests by project and test id and marks retries', () => {
    expect(snapshotPath('/out', testInfo, 2, 'home')).toBe(
      '/out/desktop-us/abc123-def/2-home.whydiff.json'
    )
    expect(snapshotPath('/out', { ...testInfo, retry: 1 }, 1, 'home')).toBe(
      '/out/desktop-us/abc123-def/1-home-retry1.whydiff.json'
    )
  })
})

describe('predictBaseline', () => {
  const calls: unknown[][] = []
  const recording = {
    snapshotPath: (...args: unknown[]) => {
      calls.push(args)
      return '/snapshots/x.png'
    },
  } as unknown as TestInfo // only snapshotPath is read

  it('asks for a screenshot path by name, by segments, or for the next unnamed one', () => {
    predictBaseline(recording, ['home.png'])
    predictBaseline(recording, ['shop', 'cart.png'])
    predictBaseline(recording, null)
    expect(calls).toEqual([
      ['home.png', { kind: 'screenshot' }],
      ['shop', 'cart.png'],
      [{ kind: 'screenshot' }],
    ])
  })
})

describe('sidecarPath', () => {
  it('replaces the png extension, whatever its case', () => {
    expect(sidecarPath('/s/home-desktop-linux.png')).toBe('/s/home-desktop-linux.whydiff.json')
    expect(sidecarPath('/s/Home.PNG')).toBe('/s/Home.whydiff.json')
  })
})
