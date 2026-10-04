import { readFile, stat } from 'node:fs/promises'

/** What one built-in screenshot assertion did, read from its effects rather than from Playwright's enums. */
export type Outcome = 'failed' | 'errored' | 'written' | 'written-but-failed' | 'ignored' | 'passed'

/** Identity of a file at one moment. */
export interface FileStamp {
  readonly size: bigint
  readonly mtimeNs: bigint
  readonly ino: bigint
}

export interface OutcomeInput {
  readonly threw: boolean
  /** The thrown error carried Playwright's `matcherResult`: a comparison failed, not the call. */
  readonly matcherResult: boolean
  /** The baseline before and after the call; null when it did not exist. */
  readonly before: FileStamp | null
  readonly after: FileStamp | null
  /** `testInfo.errors.length` before and after the call. */
  readonly errorsBefore: number
  readonly errorsAfter: number
}

export function classifyOutcome(input: OutcomeInput): Outcome {
  if (input.threw) return input.matcherResult ? 'failed' : 'errored'
  if (!sameStamp(input.before, input.after)) {
    return input.errorsAfter > input.errorsBefore ? 'written-but-failed' : 'written'
  }
  return input.after === null ? 'ignored' : 'passed'
}

export async function stampOf(path: string): Promise<FileStamp | null> {
  try {
    const { size, mtimeNs, ino } = await stat(path, { bigint: true })
    return { size, mtimeNs, ino }
  } catch {
    return null
  }
}

/** True when both files hold the same bytes, as the baseline and the actual do once the built-in wrote a missing baseline. */
export async function sameBytes(a: string, b: string): Promise<boolean> {
  const [first, second] = await Promise.all([readFile(a), readFile(b)])
  return first.equals(second)
}

function sameStamp(a: FileStamp | null, b: FileStamp | null): boolean {
  if (a === null || b === null) return a === b
  return a.size === b.size && a.mtimeNs === b.mtimeNs && a.ino === b.ino
}
