import { WhydiffError } from '../errors.js'
import { migrateToLatest } from './migrate.js'
import type { SnapshotV1 } from './types.js'
import { validateSnapshot } from './validate.js'

/** Parses snapshot text of any supported format version into a validated v1 snapshot. */
export function parseSnapshot(text: string): SnapshotV1 {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new WhydiffError(
      'invalid-snapshot',
      `$: not valid JSON (${reason}). The file is truncated or not a whydiff snapshot.`
    )
  }
  return validateSnapshot(migrateToLatest(value))
}
