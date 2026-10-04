import { dirname, join, relative, resolve } from 'node:path'
import {
  count,
  describeEffect,
  describeMemberChanges,
  describeRegion,
  diffMask,
  plural,
  renderScreenshot,
  screenshotId,
  selectorList,
  WhydiffError,
  type CauseV1,
  type ComparedV1,
  type MemberChangeV1,
  type MemberV1,
  type Rect,
  type ReportV1,
  type UnexplainedV1,
} from '@whydiff/core'

import { flagValue, hasFlag, type FlagSpec, type ParsedArgs } from '../args.js'
import {
  CROP_MARGIN,
  EXPLAIN_MAX_GROUPS,
  EXPLAIN_MAX_LOCATORS,
  EXPLAIN_MAX_MEMBERS,
  REPORT_DIR,
} from '../constants.js'
import type { Context } from '../context.js'
import { pairInputs, readPairFiles, resolveInput, type InputPair } from '../io/pairs.js'
import { cropImage, paintDiff, writePng } from '../io/png.js'
import { newestReport, readReport } from '../io/reportDir.js'

// The labels @whydiff/playwright gives the two sides of every pair (COMPARED in its pair.ts).
const PLAYWRIGHT_SIDES: ComparedV1 = { before: 'expected', after: 'actual' }

/** Flags of `explain`. */
export const EXPLAIN_FLAGS: FlagSpec = { report: true, all: false, json: false, help: false }

/** What `--json` prints: the report read and the entries the ids named. */
interface Explained {
  readonly report: string
  readonly causes: CauseV1[]
  readonly screenshots: ReportV1['screenshots'][number][]
  readonly unexplained: UnexplainedV1[]
  readonly crops: Crops[]
}

/** The crops written for one unexplained region, relative to the current directory, and their size. */
interface Crops {
  readonly id: string
  readonly expected: string
  readonly actual: string
  readonly diff: string
  readonly width: number
  readonly height: number
}

/** Prints what the report holds about each id; a region id also gets its crops written. */
export async function explain(args: ParsedArgs, ctx: Context): Promise<number> {
  const all = hasFlag(args, 'all')
  if (args.positionals.length === 0 && !all) {
    throw new WhydiffError(
      'invalid-option',
      'explain takes ids from the report, or --all for every cause: npx whydiff explain --all.'
    )
  }
  const path = await locateReport(flagValue(args, 'report'), ctx.cwd)
  const report = await readReport(path)
  const shown = relative(ctx.cwd, path)
  const result: Explained = {
    report: shown,
    causes: [],
    screenshots: [],
    unexplained: [],
    crops: [],
  }
  const sections: string[] = []
  if (args.positionals.length === 0) {
    result.causes.push(...report.causes)
    sections.push(...causeBlocks(report))
  }
  for (const id of args.positionals) {
    if (id.startsWith('c')) {
      const cause = report.causes.find((c) => c.id === id) ?? unknown(id, shown)
      result.causes.push(cause)
      sections.push(causeSection(report, cause, all))
    } else if (id.startsWith('s')) {
      const screenshot = report.screenshots.find((s) => s.id === id) ?? unknown(id, shown)
      result.screenshots.push(screenshot)
      sections.push(screenshotSection(report, screenshot.id, all))
    } else if (id.startsWith('u')) {
      const region = report.unexplained.find((u) => u.id === id) ?? unknown(id, shown)
      const crops = await writeCrops(report, region, path, ctx)
      result.unexplained.push(region)
      result.crops.push(crops)
      sections.push(regionSection(report, region, crops))
    } else {
      throw new WhydiffError(
        'invalid-option',
        `${id} is not an id: ids start with c (a cause), s (a screenshot) or u (an unexplained region).`
      )
    }
  }
  ctx.out(
    hasFlag(args, 'json')
      ? `${JSON.stringify(result, null, 2)}\n`
      : `report: ${shown}\n\n${sections.join('\n')}`
  )
  return 0
}

async function locateReport(given: string | undefined, cwd: string): Promise<string> {
  if (given !== undefined) return resolve(cwd, given)
  const newest = await newestReport(join(cwd, REPORT_DIR))
  if (newest === null) {
    throw new WhydiffError(
      'invalid-report',
      `no report.json under ${REPORT_DIR}. Run npx whydiff diff or npx whydiff report first, or name one with --report.`
    )
  }
  return newest
}

function unknown(id: string, report: string): never {
  throw new WhydiffError(
    'invalid-option',
    `no ${id} in ${report}. Ids are listed in report.md; a report from another run has other ids.`
  )
}

/** The cause as the run report renders it, then its members grouped by identical changes, or every member under `--all`. */
function causeSection(report: ReportV1, cause: CauseV1, all: boolean): string {
  return [cause.text, ...selectorLines(cause, all), ...memberLines(report, cause, all), ''].join(
    '\n'
  )
}

/** Every cause as the run report renders it, in its order, none cut. */
function causeBlocks(report: ReportV1): string[] {
  return report.causes.map((cause) => `${cause.text}\n`)
}

/** The selector lists the rule lines shorten, in full under `--all`, else how many selectors they leave out. */
function selectorLines(cause: CauseV1, all: boolean): string[] {
  const { summary } = cause
  if (summary.kind !== 'rule') return []
  const lists = [
    { label: 'selectors', text: summary.selector },
    { label: 'over selectors', text: summary.over?.selector ?? '' },
  ]
    .map((list) => ({ ...list, more: selectorList(list.text).length - 1 }))
    .filter((list) => list.more > 0)
  if (all) return lists.map((list) => `- ${list.label}: ${list.text}`)
  const more = lists.reduce((sum, list) => sum + list.more, 0)
  return more === 0
    ? []
    : [`+ ${plural(more, 'more selector')}: npx whydiff explain ${cause.id} --all`]
}

/** The single-pair form, then the members of every cause on the screenshot. */
function screenshotSection(report: ReportV1, id: string, all: boolean): string {
  const lines = [renderScreenshot(report, id).trimEnd()]
  for (const cause of report.causes.filter((c) => c.members.some((m) => m.screenshot === id))) {
    lines.push('', `## members of ${cause.id}`, ...memberLines(report, cause, all).slice(1))
  }
  return `${lines.join('\n')}\n`
}

function memberLines(report: ReportV1, cause: CauseV1, all: boolean): string[] {
  const heading = `### members (${count(cause.members.length)})`
  if (all) {
    const lines = [heading]
    for (const member of cause.members) lines.push(...memberEntry(report, cause, member))
    return lines
  }
  const more = `npx whydiff explain ${cause.id} --all`
  if (cause.members.every((m) => (m.changes ?? []).length === 0)) {
    const lines = [heading]
    for (const member of cause.members.slice(0, EXPLAIN_MAX_MEMBERS)) {
      lines.push(memberHead(report, member))
    }
    const rest = cause.members.length - EXPLAIN_MAX_MEMBERS
    if (rest > 0) lines.push(`+ ${plural(rest, 'more member')}: ${more}`)
    return lines
  }
  const groups = changeGroups(cause)
  const lines = [`${heading} by identical changes`]
  for (const group of groups.slice(0, EXPLAIN_MAX_GROUPS)) {
    lines.push(...groupLines(report, cause, group, more))
  }
  const rest = groups.slice(EXPLAIN_MAX_GROUPS)
  if (rest.length > 0) {
    const members = rest.reduce((sum, group) => sum + group.length, 0)
    lines.push(
      `+ ${plural(rest.length, 'more change set')} on ${plural(members, 'member')}: ${more}`
    )
  }
  return lines
}

/** Members with the same own changes, the largest group first, then by the changes' text. */
function changeGroups(cause: CauseV1): MemberV1[][] {
  const groups = new Map<string, MemberV1[]>()
  for (const member of cause.members) {
    const key = changesText(cause, member)
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [member])
    else group.push(member)
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([, group]) => group)
}

function groupLines(
  report: ReportV1,
  cause: CauseV1,
  group: readonly MemberV1[],
  more: string
): string[] {
  const [first] = group
  const changes = first === undefined ? '' : changesText(cause, first)
  const screenshots = new Set(group.map((m) => m.screenshot)).size
  const lines = [
    `- ${plural(group.length, 'member')} on ${plural(screenshots, 'screenshot')}: ${changes === '' ? 'no own style changes' : changes}`,
  ]
  for (const member of group.slice(0, EXPLAIN_MAX_LOCATORS)) {
    lines.push(`  ${memberHead(report, member)}`)
  }
  const rest = group.length - EXPLAIN_MAX_LOCATORS
  if (rest > 0) {
    lines.push(
      `  + ${plural(rest, 'more member')}${changes === '' ? '' : ' with these changes'}: ${more}`
    )
  }
  return lines
}

function changesText(cause: CauseV1, member: MemberV1): string {
  return describeMemberChanges(ownChanges(cause, member))
}

/** The member's own changes, those its cause's rule lists first. */
function ownChanges(cause: CauseV1, member: MemberV1): MemberChangeV1[] {
  const { summary } = cause
  const listed = new Set(
    summary.kind === 'rule' ? [...summary.sets, ...summary.changed, ...summary.unsets] : []
  )
  return [...(member.changes ?? [])].sort(
    (a, b) =>
      Number(!listed.has(a.prop)) - Number(!listed.has(b.prop)) ||
      (a.prop < b.prop ? -1 : a.prop > b.prop ? 1 : 0)
  )
}

function memberHead(report: ReportV1, member: MemberV1): string {
  const title = report.screenshots.find((s) => s.id === member.screenshot)?.title ?? ''
  return `- ${member.screenshot} | ${title} | ${member.locator} | ${plural(member.elements, 'element')}`
}

function memberEntry(report: ReportV1, cause: CauseV1, member: MemberV1): string[] {
  const lines = [memberHead(report, member)]
  for (const change of ownChanges(cause, member)) {
    lines.push(`  - ${describeMemberChanges([change])}`)
  }
  for (const effect of member.effects) lines.push(`  - effect: ${describeEffect(effect)}`)
  return lines
}

/** The region's own line, as the screenshot page lists it, then where its crops went. */
function regionSection(report: ReportV1, region: UnexplainedV1, crops: Crops): string {
  return [
    `## ${region.id}`,
    `- ${describeRegion(region, report)}`,
    `- crops: ${crops.expected}, ${crops.actual}, ${crops.diff} | ${String(crops.width)}x${String(crops.height)} px each`,
    '',
  ].join('\n')
}

async function writeCrops(
  report: ReportV1,
  region: UnexplainedV1,
  reportPath: string,
  ctx: Context
): Promise<Crops> {
  const pair = await findPair(report, region, ctx.cwd)
  const { after, expected, actual } = await readPairFiles(pair)
  const mask = diffMask(expected, actual, { threshold: after.compare.threshold })
  const rect = padded(region.region, mask.width, mask.height)
  const dir = join(dirname(reportPath), 'crops')
  const file = (kind: string): string => join(dir, `${region.id}-${kind}.png`)
  const image = cropImage(expected, rect)
  await writePng(file('expected'), image)
  await writePng(file('actual'), cropImage(actual, rect))
  await writePng(file('diff'), cropImage(paintDiff(expected, mask), rect))
  return {
    id: region.id,
    expected: relative(ctx.cwd, file('expected')),
    actual: relative(ctx.cwd, file('actual')),
    diff: relative(ctx.cwd, file('diff')),
    width: image.width,
    height: image.height,
  }
}

function padded(region: Rect, width: number, height: number): Rect {
  const x = Math.max(0, region[0] - CROP_MARGIN)
  const y = Math.max(0, region[1] - CROP_MARGIN)
  return [
    x,
    y,
    Math.min(width, region[0] + region[2] + CROP_MARGIN) - x,
    Math.min(height, region[1] + region[3] + CROP_MARGIN) - y,
  ]
}

/** The pair behind a region's screenshot, found again through the labels the report was built from. */
async function findPair(report: ReportV1, region: UnexplainedV1, cwd: string): Promise<InputPair> {
  const { before, after } = report.compared
  let pairs: readonly InputPair[] = []
  let reason: string | null = null
  try {
    pairs = (await pairInputs(await resolveInput(before, cwd), await resolveInput(after, cwd)))
      .pairs
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error)
  }
  const pair = pairs.find((p) => screenshotId(p.screen) === region.screenshot)
  if (pair !== undefined) return pair
  if (before === PLAYWRIGHT_SIDES.before && after === PLAYWRIGHT_SIDES.after) {
    throw new WhydiffError('invalid-option', playwrightRegion(report, region))
  }
  throw new WhydiffError(
    'invalid-option',
    reason === null
      ? `${region.screenshot} is not a pair of ${before} and ${after} any more. Run npx whydiff diff again, then explain.`
      : `crops need the images behind "compared: ${before} -> ${after}", which were not found from here (${reason}). Run npx whydiff explain in the directory npx whydiff diff ran in.`
  )
}

/** Where a region of a Playwright run can be seen: Playwright keeps the images, whydiff crops only the pairs it diffs. */
function playwrightRegion(report: ReportV1, region: UnexplainedV1): string {
  const entry = report.screenshots.find((s) => s.id === region.screenshot)
  const at =
    entry?.file === undefined
      ? ''
      : ` (${entry.file}${entry.line === undefined ? '' : `:${String(entry.line)}`})`
  const [x, y, width, height] = region.region
  return `${region.id} is in a screenshot of a Playwright run; whydiff crops only the pairs it diffs. See "${entry?.title ?? region.screenshot}"${at} in Playwright's HTML report (npx playwright show-report) or its -diff.png in test-results: the region is ${String(width)}x${String(height)} at (${String(x)},${String(y)}).`
}
