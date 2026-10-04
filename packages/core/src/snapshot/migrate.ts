import { WhydiffError, type WhydiffErrorCode } from '../errors.js'
import { SNAPSHOT_FORMAT_VERSION } from './types.js'

/** Rewrites a snapshot of one format version into the next one. */
export type Migration = (snapshot: unknown) => unknown

/** Migrations keyed by the version they read; empty while v1 is the only version. */
const MIGRATIONS: ReadonlyMap<number, Migration> = new Map()

/** Applies migrations until the snapshot is at `latest`; throws for unknown or newer versions. */
export function migrateToLatest(
  snapshot: unknown,
  migrations: ReadonlyMap<number, Migration> = MIGRATIONS,
  latest: number = SNAPSHOT_FORMAT_VERSION,
  code: WhydiffErrorCode = 'invalid-snapshot'
): unknown {
  const fail: (message: string) => never = (message) => {
    throw new WhydiffError(code, `$.formatVersion: ${message}.`)
  }
  let current = snapshot
  let version = versionOf(current, fail)
  if (version > latest) {
    fail(
      `format version ${String(version)} is newer than this build reads (${String(latest)}). Upgrade whydiff`
    )
  }
  while (version < latest) {
    const migration = migrations.get(version)
    if (migration === undefined) fail(`no migration from format version ${String(version)}`)
    current = migration(current)
    const next = versionOf(current, fail)
    if (next <= version)
      fail(`migration from version ${String(version)} did not advance the format`)
    version = next
  }
  return current
}

function versionOf(snapshot: unknown, fail: (message: string) => never): number {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    fail('expected an object')
  }
  const version: unknown = Reflect.get(snapshot, 'formatVersion')
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    fail('formatVersion is missing or not a positive integer')
  }
  return version
}
