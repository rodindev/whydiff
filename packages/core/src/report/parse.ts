import { WhydiffError } from '../errors.js'
import { migrateToLatest, type Migration } from '../snapshot/migrate.js'
import { REPORT_FORMAT_VERSION, type ReportV1 } from './types.js'
import { validateReport } from './validate.js'

/** Migrations keyed by the version they read; empty while v1 is the only version. */
const REPORT_MIGRATIONS: ReadonlyMap<number, Migration> = new Map()

/** Parses report text of any supported format version into a validated v1 report. */
export function parseReport(text: string): ReportV1 {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new WhydiffError(
      'invalid-report',
      `$: not valid JSON (${reason}). The file is truncated or not a whydiff report.`
    )
  }
  return validateReport(
    migrateToLatest(value, REPORT_MIGRATIONS, REPORT_FORMAT_VERSION, 'invalid-report')
  )
}
