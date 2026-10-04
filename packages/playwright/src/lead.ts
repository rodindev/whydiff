import {
  bareHeadline,
  changedLines,
  describeRegion,
  describeUnchanged,
  plain,
  renderScreenshot,
  type ReportV1,
} from '@whydiff/core'

import { NO_BASELINE, pixelMarkdown, type PairIdentity, type PixelSummary } from './pair.js'

/** One line a person reads first about a failed screenshot, as plain text, and the causes it comes from. */
export interface Lead {
  readonly text: string
  /** Ids of its causes in report order; none for a line about pixels alone. */
  readonly causes: readonly string[]
}

/** A failed screenshot's page, the lines a person reads first about it and every cause it is under. */
export interface Explanation {
  readonly page: string
  readonly leads: readonly Lead[]
  /** Ids of every cause of the screenshot, in report order. */
  readonly causes: readonly string[]
}

/** A screenshot of a report: its page, its leads and its causes. */
export function explanationOf(report: ReportV1, screenshot: string): Explanation {
  return {
    page: renderScreenshot(report, screenshot),
    leads: leadsOf(report, screenshot),
    causes: causesOf(report, screenshot),
  }
}

/** Ids of every cause of a screenshot of a report, in report order. */
export function causesOf(report: ReportV1, screenshot: string): string[] {
  const entry = report.screenshots.find((s) => s.id === screenshot)
  return report.causes.filter((c) => entry?.causes.includes(c.id) === true).map((c) => c.id)
}

/** A failed screenshot without a baseline snapshot: its pixels, and why only they are described. */
export function pixelExplanation(identity: PairIdentity, summary: PixelSummary): Explanation {
  return {
    page: pixelMarkdown(identity, summary),
    leads: [{ text: NO_BASELINE, causes: [] }],
    causes: [],
  }
}

/** The lines a person reads first about a screenshot of a report: what changed on it, as its page opens; else what each of its causes did, its headline without its share of the run; else its unexplained regions; else why the report finds it unchanged. */
export function leadsOf(report: ReportV1, screenshot: string): Lead[] {
  const changed = changedLines(report, screenshot)
  if (changed.length > 0) {
    return changed.map((line) => ({ text: line.text, causes: line.causes }))
  }
  const entry = report.screenshots.find((s) => s.id === screenshot)
  const causes = report.causes.filter((c) => entry?.causes.includes(c.id) === true)
  if (causes.length > 0) {
    return causes.map((c) => ({ text: plain(bareHeadline(report, c)), causes: [c.id] }))
  }
  const regions = report.unexplained.filter((u) => u.screenshot === screenshot)
  if (regions.length > 0) {
    return regions.map((u) => ({ text: plain(describeRegion(u, report)), causes: [] }))
  }
  return entry?.status === 'identical' ? [{ text: describeUnchanged(entry), causes: [] }] : []
}

/** A screenshot's annotation: its first line, closed by the ids of that line's causes and then of every other cause of the screenshot, so that Playwright's `annot:` search finds it by any of them; undefined without a line. */
export function annotationOf(
  explanation: Pick<Explanation, 'leads' | 'causes'>
): string | undefined {
  const [lead] = explanation.leads
  if (lead === undefined) return undefined
  const ids = [...lead.causes, ...explanation.causes.filter((id) => !lead.causes.includes(id))]
  return ids.length === 0 ? lead.text : `${lead.text} (${ids.join(', ')})`
}
