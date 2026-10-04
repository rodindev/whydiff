import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** How the text a test attaches past its project's in-test explanations begins, then where the reporter writes the explanation; the reporter replaces it. */
export const POINTER = 'The explanation of this screenshot is in '

/** Starts the run's count in a fresh directory and hands it, with the report directory, to the workers forked after it; called by the reporter in onBegin. Null when the directory cannot be made, which leaves every explanation in its test. */
export function openRun(reportDir: string): string | null {
  let dir: string
  try {
    dir = mkdtempSync(join(tmpdir(), 'whydiff-'))
  } catch {
    return null
  }
  // Playwright forks the workers after onBegin, each with the runner's environment.
  process.env.WHYDIFF_RUN_DIR = dir
  process.env.WHYDIFF_REPORT_DIR = reportDir
  return dir
}

/** Removes the run's tokens and both variables. */
export function closeRun(dir: string): void {
  delete process.env.WHYDIFF_RUN_DIR
  delete process.env.WHYDIFF_REPORT_DIR
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    return
  }
}

/** The report directory of the whydiff reporter that started the run; null in a worker no reporter started. */
export function reporterDir(): string | null {
  const dir = process.env.WHYDIFF_RUN_DIR
  const reportDir = process.env.WHYDIFF_REPORT_DIR
  return dir === undefined || reportDir === undefined ? null : reportDir
}

/** The report directory when the run's reporter explains this failing screenshot instead of its test: its `screen` holds none of the `max` tokens of its project and none is left. Null while the test explains it, always in a worker that no reporter started. */
export async function explainedLater(
  project: string,
  screen: string,
  max: number
): Promise<string | null> {
  const dir = process.env.WHYDIFF_RUN_DIR
  const reportDir = process.env.WHYDIFF_REPORT_DIR
  if (dir === undefined || reportDir === undefined) return null
  // Each project counts on its own, so one that fails first cannot leave another none.
  const pool = createHash('sha1').update(project).digest('hex')
  for (let n = 1; n <= max; n++) {
    const token = join(dir, `${pool}-${String(n)}`)
    try {
      await writeFile(token, screen, { flag: 'wx' })
      return null
    } catch (error) {
      // The cap bounds cost only: a token that cannot be written leaves the test its explanation.
      if (!isTaken(error)) return null
    }
    if ((await readFile(token, 'utf8').catch(() => '')) === screen) return null
  }
  return reportDir
}

function isTaken(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}
