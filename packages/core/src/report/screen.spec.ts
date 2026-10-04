import { readFileSync } from 'node:fs'

import { clusterCauses } from '../cluster/cluster.js'
import type { RgbaImage } from '../pixels/index.js'
import { parseSnapshot } from '../snapshot/parse.js'
import type { Rect, SnapshotV1 } from '../snapshot/types.js'
import { buildReport } from './build.js'
import { screenshotId } from './ids.js'
import { renderScreenshot } from './render.js'
import { analyzeScreen, type ScreenSource } from './screen.js'

/** The diff rectangles each causes golden was recorded with. */
const CASES: Record<string, Rect[]> = {
  'typography-cascade': [[0, 0, 600, 150]],
  'container-padding': [[0, 0, 400, 60]],
  'flex-centered-reflow': [[180, 0, 240, 40]],
  'inserted-row': [[0, 20, 400, 60]],
  'paint-order-flip': [[10, 110, 60, 20]],
  'faded-card': [[0, 0, 300, 120]],
}

const fixture = (name: string, file: string): string =>
  readFileSync(new URL(`../../fixtures/causes/${name}/${file}`, import.meta.url), 'utf8')

const snapshot = (name: string, side: 'before' | 'after'): SnapshotV1 =>
  parseSnapshot(fixture(name, `${side}.whydiff.json`))

/** A white image with the given rectangles painted in `rgb`. */
function image(rects: readonly Rect[], rgb = [0, 0, 0], width = 1000, height = 800): RgbaImage {
  const data = new Uint8Array(width * height * 4).fill(255)
  for (const [x, y, w, h] of rects) {
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) data.set([...rgb, 255], (j * width + i) * 4)
    }
  }
  return { width, height, data }
}

function source(name: string, overrides: Partial<ScreenSource> = {}): ScreenSource {
  return {
    screen: name,
    title: `${name} > renders`,
    before: snapshot(name, 'before'),
    after: snapshot(name, 'after'),
    expected: image([]),
    actual: image(CASES[name] ?? []),
    threshold: 0.2,
    ...overrides,
  }
}

describe('analyzeScreen', () => {
  it.each(Object.entries(CASES))('reproduces the %s golden from the two images', (name, rects) => {
    const screen = analyzeScreen(source(name))
    expect(`${JSON.stringify(screen.explanation, null, 2)}\n`).toBe(
      fixture(name, 'explanation.json')
    )
    expect(screen.differing).toBe(rects.reduce((sum, [, , w, h]) => sum + w * h, 0))
    expect(screen.massChange).toBe(false)
    expect(screen.sizeMismatch).toBeNull()
  })

  it('carries the identity of the pair and leaves absent fields absent', () => {
    const bare = analyzeScreen(source('container-padding'))
    expect(bare).not.toHaveProperty('file')
    expect(bare).not.toHaveProperty('line')
    expect(bare).not.toHaveProperty('project')
    const named = analyzeScreen(
      source('container-padding', { file: 'tests/card.spec.ts', line: 12, project: 'chromium' })
    )
    expect(named).toMatchObject({
      screen: 'container-padding',
      title: 'container-padding > renders',
      file: 'tests/card.spec.ts',
      line: 12,
      project: 'chromium',
    })
    expect(named.regions).toEqual([{ x: 0, y: 0, width: 400, height: 60, pixels: 24000 }])
  })

  it('compares with the threshold of the pair', () => {
    const faint = source('container-padding', { actual: image([[0, 0, 400, 60]], [250, 250, 250]) })
    expect(analyzeScreen(faint).regions).toEqual([])
    expect(analyzeScreen({ ...faint, threshold: 0 }).regions).toHaveLength(1)
  })

  it('reports a size mismatch and compares the overlap', () => {
    const screen = analyzeScreen(
      source('container-padding', { actual: image([[0, 0, 400, 60]], [0, 0, 0], 1000, 820) })
    )
    expect(screen.sizeMismatch).toEqual({
      expected: { width: 1000, height: 800 },
      actual: { width: 1000, height: 820 },
    })
  })

  it('feeds the single-pair report', () => {
    const screen = analyzeScreen(
      source('container-padding', { file: 'tests/card.spec.ts', line: 12, project: 'chromium' })
    )
    const report = buildReport({
      version: '0.0.1',
      compared: { before: 'expected', after: 'actual' },
      screens: [screen],
      clusters: clusterCauses([screen]),
    })
    const id = screenshotId(screen.screen)
    const text = renderScreenshot(report, id)
    expect(text).toContain(
      `\nsource: tests/card.spec.ts:12 | chromium | 1000x800 px, 24,000 changed pixels | ${id}\n`
    )
    expect(report.summary.causes).toBe(1)
  })
})
