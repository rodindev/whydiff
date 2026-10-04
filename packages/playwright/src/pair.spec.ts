import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'

import {
  decodePng,
  pairIdentity,
  pixelMarkdown,
  pixelSummary,
  writeIfChanged,
  type PairIdentity,
} from './pair.js'

const identity: PairIdentity = pairIdentity(
  {
    project: 'chromium',
    testId: 'abc',
    titles: ['cart', 'pays'],
    file: 'tests/cart.spec.ts',
    line: 12,
  },
  'total'
)

/** A white image with black squares of `size` px at the given corners. */
function image(width: number, height: number, squares: readonly [number, number, number][]) {
  const data = new Uint8Array(width * height * 4).fill(255)
  for (const [x, y, size] of squares) {
    for (let j = y; j < y + size; j++) {
      for (let i = x; i < x + size; i++) data.set([0, 0, 0, 255], (j * width + i) * 4)
    }
  }
  return { width, height, data }
}

describe('pairIdentity', () => {
  it('keys the pair by project, test and name and titles it with the screenshot name', () => {
    expect(identity).toEqual({
      screen: 'chromium|abc|total',
      title: 'cart > pays > total',
      file: 'tests/cart.spec.ts',
      line: 12,
      project: 'chromium',
    })
  })
})

describe('pixelMarkdown', () => {
  it('says there is no baseline snapshot in one sentence and lists the regions', () => {
    const summary = pixelSummary(
      image(100, 50, []),
      image(100, 50, [
        [0, 0, 4],
        [60, 30, 10],
      ]),
      0.2
    )
    expect(pixelMarkdown(identity, summary)).toBe(
      [
        '# whydiff: cart > pays > total | no baseline snapshot',
        'compared: expected -> actual',
        'source: tests/cart.spec.ts:12 | chromium | 100x50 px, 116 changed pixels',
        'No render-tree snapshot is stored next to the baseline PNG, so only the pixels are described; run with --update-snapshots, or let the assertion pass once with backfill on, to record one.',
        '',
        '## Changed regions (2)',
        '- region 4x4 at (0,0), 16 changed pixels',
        '- region 10x10 at (60,30), 100 changed pixels',
        '',
      ].join('\n')
    )
  })

  it('stops listing after twenty regions', () => {
    const squares = Array.from({ length: 25 }, (_, i): [number, number, number] => [i * 20, 0, 2])
    const text = pixelMarkdown(
      identity,
      pixelSummary(image(500, 10, []), image(500, 10, squares), 0.2)
    )
    expect(text).toContain('## Changed regions (25)\n')
    expect(text.match(/^- region /gm)).toHaveLength(20)
    expect(text).toContain('\n+ 5 more regions\n')
  })
})

describe('decodePng', () => {
  it('reads RGBA pixels', () => {
    const png = new PNG({ width: 2, height: 1 })
    png.data.set([1, 2, 3, 255, 4, 5, 6, 255])
    expect(decodePng(PNG.sync.write(png))).toEqual({
      width: 2,
      height: 1,
      data: Buffer.from([1, 2, 3, 255, 4, 5, 6, 255]),
    })
  })
})

describe('writeIfChanged', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'whydiff-pair-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('creates the directory, then leaves identical bytes alone', async () => {
    const path = join(dir, 'nested', 'a.whydiff.json')
    expect(await writeIfChanged(path, '{}\n')).toBe(true)
    const first = await stat(path, { bigint: true })
    expect(await writeIfChanged(path, '{}\n')).toBe(false)
    expect((await stat(path, { bigint: true })).mtimeNs).toBe(first.mtimeNs)
    expect(await writeIfChanged(path, '[]\n')).toBe(true)
    expect(await readFile(path, 'utf8')).toBe('[]\n')
  })
})
