import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { run } from '../main.js'
import { fakeProcess } from '../testing.js'

async function runWithoutPngs(dir: string, projects: readonly string[]): Promise<void> {
  const lines = projects.map((project, index) => ({
    project,
    testId: `t${String(index + 1)}`,
    title: `test t${String(index + 1)}`,
    file: 'tests/a.spec.ts',
    line: 7,
    ordinal: 1,
    name: 'card',
    retry: 0,
    receiver: 'page',
    screenshot: join(dir, 'card.png'),
    snapshot: `t${String(index + 1)}/1-card.whydiff.json`,
    png: null,
  }))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.png'), '')
  await writeFile(
    join(dir, 'manifest.jsonl'),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
  )
}

describe('diff over two runs that recorded no PNG', () => {
  let dir: string
  let stdout: string
  let stderr: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'whydiff-diff-'))
    await runWithoutPngs(join(dir, 'before'), ['chromium', ''])
    await runWithoutPngs(join(dir, 'after'), ['chromium', ''])
    const p = fakeProcess(dir)
    expect(await run(['diff', 'before', 'after'], p)).toBe(0)
    stdout = p.text.stdout
    stderr = p.text.stderr
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('says what the runs hold in place of a headline about changed pixels', () => {
    expect(stdout.split('\n').slice(0, 4)).toEqual([
      '# whydiff: before -> after | 0 of 2 screenshots compared | 2 without a PNG',
      'compared: before -> after',
      '',
      '## No baseline snapshot (2)',
    ])
    expect(stderr).toMatch(
      /^analyzing 0 pairs\n0 of 2 screenshots compared, 2 without a PNG in \d+ ms\nwhydiff-report\/report\.md\n$/
    )
  })

  it('names an assertion that took no screenshot among the reasons a run has no PNG', () => {
    expect(stdout).toContain('; an assertion that failed before it took a screenshot has none; ')
  })

  it('leaves out the project field of a project without a name', () => {
    expect(stdout.split('\n').filter((line) => line.startsWith('- '))).toEqual([
      '- test t2 > card | tests/a.spec.ts:7 | no PNG in before and after',
      '- test t1 > card | tests/a.spec.ts:7 | chromium | no PNG in before and after',
    ])
  })
})
