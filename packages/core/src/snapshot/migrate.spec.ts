import { migrateToLatest, type Migration } from './migrate.js'

const bump = (to: number, extra: Record<string, unknown> = {}): Migration => {
  return (snapshot) => Object.assign({}, snapshot, { formatVersion: to }, extra)
}

describe('migrateToLatest', () => {
  it('returns a snapshot that is already at the latest version untouched', () => {
    const snapshot = { formatVersion: 1, nodes: [] }
    expect(migrateToLatest(snapshot)).toBe(snapshot)
  })

  it('applies the chain in version order until the latest', () => {
    const migrations = new Map<number, Migration>([
      [1, bump(2, { a: 1 })],
      [2, bump(3, { b: 2 })],
    ])
    expect(migrateToLatest({ formatVersion: 1 }, migrations, 3)).toEqual({
      formatVersion: 3,
      a: 1,
      b: 2,
    })
  })

  it('rejects a newer format than this build reads', () => {
    expect(() => migrateToLatest({ formatVersion: 2 })).toThrow(/newer than this build/)
  })

  it('rejects a version with no migration', () => {
    expect(() => migrateToLatest({ formatVersion: 1 }, new Map(), 2)).toThrow(
      /no migration from format version 1/
    )
  })

  it('rejects a migration that does not advance the version', () => {
    const migrations = new Map<number, Migration>([[1, bump(1)]])
    expect(() => migrateToLatest({ formatVersion: 1 }, migrations, 2)).toThrow(/did not advance/)
  })

  it.each([null, [], 'text', {}, { formatVersion: 0 }, { formatVersion: '1' }])(
    'rejects %j',
    (value) => {
      expect(() => migrateToLatest(value)).toThrow(
        expect.objectContaining({ code: 'invalid-snapshot' })
      )
    }
  )
})
