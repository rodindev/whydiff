import { code, type ReportV1 } from '@whydiff/core'

/** A short GitHub job summary of a run: what the reporter warns about, its own count lines, the run summary the report leads with (its first causes by their headlines), and where the reporter wrote the rest. Only plain counts and the core's Markdown-safe text, so it renders as written. */
export function jobSummary(
  totals: readonly string[],
  report: ReportV1,
  warnings: readonly string[],
  files: { readonly report: string; readonly screenshots: string }
): string {
  return [
    '## whydiff',
    ...warnings.flatMap((line) => [`Warning: ${line}`, '']),
    ...totals.map((line) => `- ${line}`),
    '',
    report.summary.lead.text,
    '',
    `The whole run in ${code(files.report)}; the page of each changed screenshot in ${code(files.screenshots)}.`,
    '',
  ].join('\n')
}
