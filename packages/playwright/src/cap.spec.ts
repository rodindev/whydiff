import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { closeRun, explainedLater, openRun } from './cap.js'

describe('explainedLater', () => {
  const report = join(tmpdir(), 'whydiff-report')
  const p = createHash('sha1').update('p').digest('hex')
  let run: string | null = null

  /** What the reporter does in onBegin for the workers it starts. */
  const startRun = (): string => {
    run = openRun(report)
    if (run === null) throw new Error('no run directory')
    return run
  }

  afterEach(() => {
    if (run !== null) closeRun(run)
    run = null
    delete process.env.WHYDIFF_RUN_DIR
    delete process.env.WHYDIFF_REPORT_DIR
  })

  it('takes one token per screen until the cap is reached, then names the report directory', async () => {
    const dir = startRun()
    expect([
      await explainedLater('p', 'p|t1|first', 2),
      await explainedLater('p', 'p|t2|second', 2),
      await explainedLater('p', 'p|t3|third', 2),
    ]).toEqual([null, null, report])
    expect((await readdir(dir)).sort()).toEqual([`${p}-1`, `${p}-2`])
    expect(await readFile(join(dir, `${p}-2`), 'utf8')).toBe('p|t2|second')
  })

  it('gives each project its own tokens, so one that fails first leaves the others theirs', async () => {
    startRun()
    expect([
      await explainedLater('desktop', 'desktop|t1|card', 1),
      await explainedLater('desktop', 'desktop|t2|card', 1),
      await explainedLater('mobile', 'mobile|t3|card', 1),
      await explainedLater('', '|t4|card', 1),
    ]).toEqual([null, report, null, null])
  })

  it('lets a screen that holds a token keep it, in this worker or another', async () => {
    const dir = startRun()
    await writeFile(join(dir, `${p}-1`), 'p|t1|card')
    expect(await explainedLater('p', 'p|t1|card', 1)).toBeNull()
    expect(await explainedLater('p', 'p|t1|card', 1)).toBeNull()
    expect(await explainedLater('p', 'p|t2|card', 1)).toBe(report)
    expect(await readdir(dir)).toEqual([`${p}-1`])
  })

  it('names the report directory at a cap of zero', async () => {
    startRun()
    expect(await explainedLater('p', 'p|t1|card', 0)).toBe(report)
  })

  it('leaves the explanation in the test when a token cannot be written', async () => {
    process.env.WHYDIFF_RUN_DIR = join(startRun(), 'gone')
    expect(await explainedLater('p', 'p|t1|card', 1)).toBeNull()
  })

  it('leaves every explanation in the test of a worker no reporter started', async () => {
    expect([
      await explainedLater('p', 'p|t1|card', 1),
      await explainedLater('p', 'p|t2|card', 1),
    ]).toEqual([null, null])
  })
})

describe('openRun', () => {
  it('hands a fresh directory and the report directory to the environment, and closeRun takes both back', () => {
    const first = openRun('/report')
    const second = openRun('/report')
    try {
      expect(first).not.toBeNull()
      expect(second).not.toBe(first)
      expect(second?.startsWith(join(tmpdir(), 'whydiff-'))).toBe(true)
      expect(process.env.WHYDIFF_RUN_DIR).toBe(second)
      expect(process.env.WHYDIFF_REPORT_DIR).toBe('/report')
    } finally {
      if (first !== null) closeRun(first)
      if (second !== null) closeRun(second)
    }
    expect([first, second].map((dir) => existsSync(dir ?? ''))).toEqual([false, false])
    expect(process.env.WHYDIFF_RUN_DIR).toBeUndefined()
    expect(process.env.WHYDIFF_REPORT_DIR).toBeUndefined()
  })
})
