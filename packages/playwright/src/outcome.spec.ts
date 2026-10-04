import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  classifyOutcome,
  sameBytes,
  stampOf,
  type FileStamp,
  type OutcomeInput,
} from './outcome.js'

const stamp = (mtimeNs: bigint): FileStamp => ({ size: 10n, mtimeNs, ino: 1n })
const base: OutcomeInput = {
  threw: false,
  matcherResult: false,
  before: stamp(1n),
  after: stamp(1n),
  errorsBefore: 0,
  errorsAfter: 0,
}

describe('classifyOutcome', () => {
  it.each<[string, Partial<OutcomeInput>, string]>([
    ['a comparison that failed', { threw: true, matcherResult: true }, 'failed'],
    ['a call that threw without a result', { threw: true }, 'errored'],
    ['a new baseline', { before: null }, 'written'],
    ['an updated baseline', { after: stamp(2n) }, 'written'],
    ['a baseline written in missing mode', { before: null, errorsAfter: 1 }, 'written-but-failed'],
    ['no baseline and nothing written', { before: null, after: null }, 'ignored'],
    ['an untouched baseline', {}, 'passed'],
    ['a pass after an earlier soft failure', { errorsBefore: 1, errorsAfter: 1 }, 'passed'],
  ])('reads %s', (_, overrides, outcome) => {
    expect(classifyOutcome({ ...base, ...overrides })).toBe(outcome)
  })
})

describe('stampOf', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'whydiff-stamp-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('is null for a missing file and changes when the file is rewritten', async () => {
    const path = join(dir, 'a.png')
    expect(await stampOf(path)).toBeNull()
    await writeFile(path, 'one')
    const first = await stampOf(path)
    expect(first).toMatchObject({ size: 3n })
    await writeFile(path, 'two!')
    expect(await stampOf(path)).not.toEqual(first)
  })
})

describe('sameBytes', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'whydiff-bytes-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('compares the contents, not the paths', async () => {
    await writeFile(join(dir, 'a.png'), 'same')
    await writeFile(join(dir, 'b.png'), 'same')
    await writeFile(join(dir, 'c.png'), 'other')
    expect(await sameBytes(join(dir, 'a.png'), join(dir, 'b.png'))).toBe(true)
    expect(await sameBytes(join(dir, 'a.png'), join(dir, 'c.png'))).toBe(false)
    await expect(sameBytes(join(dir, 'a.png'), join(dir, 'missing.png'))).rejects.toThrow(/ENOENT/)
  })
})
