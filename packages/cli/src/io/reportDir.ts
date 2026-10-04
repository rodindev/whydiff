import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  parseReport,
  renderRunPage,
  renderScreenshot,
  serializeReport,
  type RenderOptions,
  type ReportV1,
} from '@whydiff/core'

const REPORT_FILE = /^report(\.shard-.+)?\.json$/

/** The paths `writeReportFiles` wrote. */
export interface ReportFiles {
  readonly json: string
  readonly markdown: string
  readonly html: string
  readonly screenshots: string
}

/** Writes `report.json`, `report.md`, `report.html` and one `screenshots/<id>.md` per changed screenshot, as the reporter does. */
export async function writeReportFiles(
  dir: string,
  report: ReportV1,
  markdown: string,
  options: RenderOptions = {}
): Promise<ReportFiles> {
  const files = {
    json: join(dir, 'report.json'),
    markdown: join(dir, 'report.md'),
    html: join(dir, 'report.html'),
    screenshots: join(dir, 'screenshots'),
  }
  await mkdir(dir, { recursive: true })
  await writeFile(files.json, serializeReport(report))
  await writeFile(files.markdown, markdown)
  await writeFile(files.html, renderRunPage(report, options))
  await rm(files.screenshots, { recursive: true, force: true })
  const changed = report.screenshots.filter((s) => s.status === 'changed')
  if (changed.length > 0) await mkdir(files.screenshots, { recursive: true })
  for (const screenshot of changed) {
    await writeFile(
      join(files.screenshots, `${screenshot.id}.md`),
      renderScreenshot(report, screenshot.id)
    )
  }
  return files
}

/** The most recently written `report.json` or `report.shard-*.json` directly under `dir`, or null. */
export async function newestReport(dir: string): Promise<string | null> {
  const names = (await readdir(dir).catch(() => [])).filter((name) => REPORT_FILE.test(name)).sort()
  let newest: { path: string; mtime: number } | null = null
  for (const name of names) {
    const path = join(dir, name)
    const { mtimeMs } = await stat(path)
    if (newest === null || mtimeMs > newest.mtime) newest = { path, mtime: mtimeMs }
  }
  return newest?.path ?? null
}

/** Reads and validates a report file. */
export async function readReport(path: string): Promise<ReportV1> {
  return parseReport(await readFile(path, 'utf8'))
}
