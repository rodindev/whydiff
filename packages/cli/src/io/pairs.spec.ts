import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { pairInputs, resolveInput } from './pairs.js'

interface Line {
  project: string
  testId: string
  ordinal: number
  name: string
  failedName?: string
  retry: number
  repeat?: number
  snapshot: string | null
  screenshot: string | null
  png: string | null
  line?: number
}

async function file(path: string, text = ''): Promise<string> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
  return path
}

async function manifest(dir: string, lines: Line[]): Promise<void> {
  const full = lines.map((line) => ({
    title: `test ${line.testId}`,
    file: 'tests/a.spec.ts',
    line: 7,
    receiver: 'page',
    ...line,
  }))
  await file(join(dir, 'manifest.jsonl'), full.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

describe('resolveInput', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'whydiff-pairs-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('takes a snap name, a .whydiff.json file with its PNG, a run directory or a snapshot directory', async () => {
    await file(join(dir, '.whydiff', 'snaps', 'home.whydiff.json'))
    await file(join(dir, '.whydiff', 'snaps', 'home.png'))
    await file(join(dir, 'pair', 'x.whydiff.json'))
    await file(join(dir, 'pair', 'x.png'))
    await manifest(join(dir, 'run'), [])
    await file(join(dir, 'snapshots', 'a.png'))
    expect(await resolveInput('home', dir)).toEqual({
      kind: 'single',
      label: 'home',
      snapshot: join(dir, '.whydiff', 'snaps', 'home.whydiff.json'),
      png: join(dir, '.whydiff', 'snaps', 'home.png'),
    })
    expect(await resolveInput('pair/x.whydiff.json', dir)).toMatchObject({
      kind: 'single',
      png: join(dir, 'pair', 'x.png'),
    })
    expect(await resolveInput('run', dir)).toEqual({
      kind: 'run',
      label: 'run',
      dir: join(dir, 'run'),
    })
    expect(await resolveInput('snapshots', dir)).toEqual({
      kind: 'snapshots',
      label: 'snapshots',
      dir: join(dir, 'snapshots'),
    })
  })

  it('refuses a snapshot without its PNG and anything it cannot classify', async () => {
    await file(join(dir, 'lonely.whydiff.json'))
    await expect(resolveInput('lonely.whydiff.json', dir)).rejects.toThrow('is missing next to')
    await expect(resolveInput('nothing', dir)).rejects.toThrow(
      'nothing is not a snap name, a .whydiff.json file or a directory. Run npx whydiff snap <url> --name nothing first, or give a path.'
    )
  })
})

describe('pairInputs', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'whydiff-pairs-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('pairs two single snapshots under one key made of both labels', async () => {
    for (const name of ['a', 'b']) {
      await file(join(dir, `${name}.whydiff.json`))
      await file(join(dir, `${name}.png`))
    }
    const paired = await pairInputs(
      await resolveInput('a.whydiff.json', dir),
      await resolveInput('b.whydiff.json', dir)
    )
    expect(paired).toEqual({
      pairs: [
        {
          screen: 'a.whydiff.json|b.whydiff.json',
          title: 'a.whydiff.json -> b.whydiff.json',
          before: { snapshot: join(dir, 'a.whydiff.json'), png: join(dir, 'a.png') },
          after: { snapshot: join(dir, 'b.whydiff.json'), png: join(dir, 'b.png') },
        },
      ],
      unpaired: [],
      withoutPng: [],
    })
  })

  it('pairs two-run outputs by project, test id and ordinal, the last retry winning', async () => {
    const png = await file(join(dir, 'baseline.png'))
    const line = (testId: string, ordinal: number, retry = 0): Line => {
      const stem = `chromium/${testId}/${String(ordinal)}-card${retry > 0 ? `-retry${String(retry)}` : ''}`
      return {
        project: 'chromium',
        testId,
        ordinal,
        name: 'card',
        retry,
        snapshot: `${stem}.whydiff.json`,
        screenshot: png,
        png: `${stem}.png`,
      }
    }
    await manifest(join(dir, 'before'), [
      line('t1', 1),
      line('t1', 2),
      line('t2', 1),
      { ...line('t3', 1), snapshot: null },
      { ...line('t0', 1), line: 3 },
    ])
    await manifest(join(dir, 'after'), [
      line('t1', 1),
      line('t1', 1, 1),
      line('t3', 1),
      { ...line('t0', 1), line: 3 },
    ])
    const paired = await pairInputs(
      await resolveInput('before', dir),
      await resolveInput('after', dir)
    )
    expect(paired.pairs).toEqual([
      expect.objectContaining({ screen: 'chromium|t0|1', line: 3 }),
      {
        screen: 'chromium|t1|1',
        title: 'test t1 > card',
        file: 'tests/a.spec.ts',
        line: 7,
        project: 'chromium',
        before: {
          snapshot: join(dir, 'before', 'chromium/t1/1-card.whydiff.json'),
          png: join(dir, 'before', 'chromium/t1/1-card.png'),
        },
        after: {
          snapshot: join(dir, 'after', 'chromium/t1/1-card-retry1.whydiff.json'),
          png: join(dir, 'after', 'chromium/t1/1-card-retry1.png'),
        },
      },
    ])
    expect(paired.unpaired).toEqual([
      'before: test t1 > card has no counterpart',
      'before: test t2 > card has no counterpart',
      'after: test t3 > card has no counterpart',
    ])
    expect(paired.withoutPng).toEqual([])
  })

  it("gives a pair whose after side failed the id of the after run's report, and every other pair the key of 0.1", async () => {
    const png = await file(join(dir, 'baseline.png'))
    const line = (testId: string, failedName?: string): Line => ({
      project: 'chromium',
      testId,
      ordinal: 1,
      name: 'home_page',
      ...(failedName === undefined ? {} : { failedName }),
      retry: 0,
      snapshot: `chromium/${testId}/1-home_page.whydiff.json`,
      screenshot: png,
      png: `chromium/${testId}/1-home_page.png`,
    })
    // A run recorded by 0.1 has no failedName and no repeat.
    await manifest(join(dir, 'before'), [line('t1'), line('t2', 'home-page')])
    await manifest(join(dir, 'after'), [
      { ...line('t1', 'home-page'), repeat: 0 },
      { ...line('t2'), repeat: 0 },
    ])
    const paired = await pairInputs(
      await resolveInput('before', dir),
      await resolveInput('after', dir)
    )
    expect(paired.pairs.map((pair) => [pair.screen, pair.title])).toEqual([
      [['chromium', 'tests/a.spec.ts', 'test t1 > home-page'].join('\x1e'), 'test t1 > home-page'],
      ['chromium|t2|1', 'test t2 > home_page'],
    ])
    expect(paired.unpaired).toEqual([])
  })

  it('lists a two-run pair apart when a side recorded no PNG and its baseline is gone', async () => {
    const line = (testId: string, png: string | null): Line => ({
      project: 'chromium',
      testId,
      ordinal: 1,
      name: 'card',
      retry: 0,
      snapshot: `chromium/${testId}/1-card.whydiff.json`,
      screenshot: join(dir, 'gone.png'),
      png,
    })
    await manifest(join(dir, 'before'), [
      line('t1', 'chromium/t1/1-card.png'),
      line('t2', null),
      line('t3', null),
    ])
    await manifest(join(dir, 'after'), [
      line('t1', null),
      line('t2', 'chromium/t2/1-card.png'),
      line('t3', null),
    ])
    const paired = await pairInputs(
      await resolveInput('before', dir),
      await resolveInput('after', dir)
    )
    expect(paired.pairs).toEqual([])
    expect(paired.unpaired).toEqual([])
    expect(paired.withoutPng).toEqual([
      {
        screen: 'chromium|t1|1',
        title: 'test t1 > card',
        file: 'tests/a.spec.ts',
        line: 7,
        project: 'chromium',
        missing: ['after'],
      },
      expect.objectContaining({ screen: 'chromium|t2|1', missing: ['before'] }),
      expect.objectContaining({ screen: 'chromium|t3|1', missing: ['before', 'after'] }),
    ])
  })

  it('pairs snapshot directories by relative path and lists baselines without a snapshot', async () => {
    for (const side of ['main', 'branch']) {
      await file(join(dir, side, 'shop', 'cart.png'))
      await file(join(dir, side, 'shop', 'cart.whydiff.json'))
    }
    await file(join(dir, 'main', 'home.png'))
    await file(join(dir, 'main', 'home.whydiff.json'))
    await file(join(dir, 'branch', 'home.png'))
    await file(join(dir, 'branch', 'extra.png'))
    await file(join(dir, 'branch', 'extra.whydiff.json'))
    const paired = await pairInputs(
      await resolveInput('main', dir),
      await resolveInput('branch', dir)
    )
    expect(paired.pairs.map((p) => [p.screen, p.title])).toEqual([['shop/cart', 'shop/cart']])
    expect(paired.unpaired).toEqual([
      'branch: extra has no counterpart',
      'main: home has no counterpart',
      'branch: home.png has no .whydiff.json',
    ])
  })

  it('refuses sides of different kinds', async () => {
    await file(join(dir, 'a.whydiff.json'))
    await file(join(dir, 'a.png'))
    await manifest(join(dir, 'run'), [])
    await expect(
      pairInputs(await resolveInput('a.whydiff.json', dir), await resolveInput('run', dir))
    ).rejects.toThrow(
      'a.whydiff.json is one snapshot and run is a two-run output directory; both sides of a diff must be of the same kind.'
    )
  })

  it('refuses a manifest line that is not one', async () => {
    await file(join(dir, 'run', 'manifest.jsonl'), '{"project":"x"}\n')
    await manifest(join(dir, 'other'), [])
    await expect(
      pairInputs(await resolveInput('run', dir), await resolveInput('other', dir))
    ).rejects.toThrow(
      'manifest.jsonl line 1 is not a whydiff manifest line. Point diff at the directory @whydiff/playwright recorded a run into, set with WHYDIFF_OUT or use.whydiff.outputDir.'
    )
  })
})
