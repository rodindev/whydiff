import { REPORT_MAX_CLUSTERS, RESTORE_MAX_VALUES, RUN_SUMMARY_CAUSES } from '../constants.js'
import type {
  LonghandValues,
  MixedLonghand,
  RuleRef,
  RuleSummary,
  VarChange,
  ViaRule,
} from '../cluster/types.js'
import { code, compareText, count, plain, plural, quoted, safe } from './format.js'
import {
  onScreenshots,
  propsOf,
  share,
  showsAs,
  withoutImpact,
  type RunTotals,
} from './headline.js'
import { hexColor, observationText } from './observe.js'
import { selectorList } from '../snapshot/selectors.js'
import { builtName } from '../snapshot/sheets.js'
import { SENTENCES } from './sentences.js'
import type {
  CauseV1,
  EffectV1,
  FactKind,
  MemberChangeV1,
  MemberV1,
  ObservationV1,
  RenderOptions,
  ReportV1,
  ScreenshotV1,
  UnexplainedV1,
} from './types.js'

const DEFAULT_COMMAND = 'npx whydiff explain'

/** Unexplained regions of one screenshot, or of several whose regions are the same. */
interface TailGroup {
  /** Index of the first screenshot in the report. */
  readonly order: number
  readonly screenshots: string[]
  /** The regions of the first screenshot. */
  readonly regions: readonly UnexplainedV1[]
  /** Changed pixels of `regions`. */
  readonly pixels: number
}
/** Facts that say an element appeared or went away, which a person sees first. */
const PRESENCE: ReadonlySet<FactKind> = new Set(['appears', 'gone', 'visible', 'invisible'])
/** Facts that only say an element moved. */
const MOVES: ReadonlySet<FactKind> = new Set(['x', 'y'])
/** A sheet a bundler or a page names after third-party code: `vendor-ui-*.css`, `chunk-vendors.*.css`, `vendors~main.*.css`. */
const VENDOR = /(?:^|[^a-z])vendors?(?:[^a-z]|$)/i
/** Sheets without a file, which a script put into the page. */
const INJECTED = /^(?:<style>|constructed) #\d+$/
/** How capture names an `@property` rule: its selector starts with this. */
const REGISTRATION = '@property '
/** The label `collapseSides` gives four equal sides or corners. */
const ALL_SIDES = / \(all (?:sides|corners)\)$/

/** The whole run as Markdown, for a person and an agent alike: causes first, consequences marked, unexplained regions last, identifiers in code spans. */
export function renderReport(report: ReportV1, options: RenderOptions = {}): string {
  const command = options.explainCommand ?? DEFAULT_COMMAND
  const limit = options.maxClusters ?? REPORT_MAX_CLUSTERS
  const { summary } = report
  if (summary.screenshots.changed === 0) return renderNoChange(report, options.failed ?? 0)
  const lines: string[] = [
    `# whydiff: ${count(summary.screenshots.changed)} of ${plural(summary.screenshots.compared, 'screenshot')} changed | ${plural(summary.causes, 'cause')} | ${plural(summary.unexplained, 'unexplained region')}`,
    comparedLine(report),
    '',
    ...report.summary.lead.text.split('\n'),
  ]
  const shown = report.causes.slice(0, limit)
  const rest = report.causes.slice(limit)
  for (const cause of shown) lines.push('', ...renderCause(cause, report, command))
  if (rest.length > 0) {
    const screens = new Set(rest.flatMap((c) => c.members.map((m) => m.screenshot))).size
    lines.push(
      '',
      `+ ${plural(rest.length, 'more cause')} on ${plural(screens, 'screenshot')}, ordered by changed pixels: ${code('report.json#causes')} or ${code(`${command} --all`)}`
    )
  }
  const { groups, notes } = tailParts(report, command)
  if (groups.length > 0) {
    lines.push(
      '',
      `## Unexplained regions (${count(report.unexplained.length)})`,
      ...SENTENCES.unexplainedIntro,
      ...groups.map((group) => `- ${group}`)
    )
  }
  if (notes.length > 0) lines.push('', ...notes)
  lines.push('')
  if (summary.screenshots.identical > 0) {
    lines.push(
      `Unchanged: ${plural(summary.screenshots.identical, 'screenshot')} ${summary.screenshots.identical === 1 ? 'is' : 'are'} pixel-identical and not listed.`
    )
  }
  lines.push(
    `Test and file of each screenshot id: ${code('report.json#screenshots')} or ${code(`${command} <id>`)}`
  )
  return join(lines)
}

/** The run summary as `report.md` prints it, from its parts: the sentence that leads it, a line per cause it lists, what the rest of the run holds. */
export function runSummaryText(parts: RunSummaryParts): string {
  const { lead, top, rest } = parts
  return [
    lead,
    ...top.map((cause) => `- ${cause.headline} (${handleOf(cause)})`),
    ...(rest === null ? [] : ['', rest]),
  ].join('\n')
}

/** The run summary in parts. */
export interface RunSummaryParts {
  /** The causes it lists: the first in report order, up to the last of the first `RUN_SUMMARY_CAUSES` that adds a changed screenshot they appear on or one they settle. */
  readonly top: readonly CauseV1[]
  /** Changed screenshots the listed causes appear on. */
  readonly screenshots: number
  /** Changed screenshots on which the listed causes account for every changed pixel: no other cause and no unexplained region there. */
  readonly settled: number
  /** Changed pixels of the listed causes. */
  readonly pixels: number
  readonly lead: string
  /** What the other causes and the unexplained regions hold, one sentence; null when nothing else changed. */
  readonly rest: string | null
}

/** The run summary in parts, from the causes, screenshots and unexplained regions of a report. */
export function summaryParts(
  report: Pick<ReportV1, 'causes' | 'screenshots' | 'unexplained'>
): RunSummaryParts {
  const totals = runTotals(report)
  const { causes, unexplained } = report
  const top = leadingCauses(report)
  const reached = screenshotsOf(top)
  const settled = settledBy(report, top)
  const pixels = pixelsOf(top)
  const lead =
    top.length === 0
      ? 'No cause explains these changes.'
      : leadSentence(
          top.length,
          reached.size,
          settled,
          share(pixels, totals.pixels),
          totals.screenshots
        )
  const others = causes.slice(top.length)
  const parts: string[] = []
  if (others.length > 0) {
    const more = [...screenshotsOf(others)].filter((id) => !reached.has(id)).length
    const one = others.length === 1
    parts.push(
      `${one ? 'the other cause holds' : `the other ${count(others.length)} causes hold`} ${share(pixelsOf(others), totals.pixels)} of changed pixels${more > 0 ? ` and ${one ? 'appears' : 'appear'} on ${plural(more, 'more screenshot')}` : ''}`
    )
  }
  if (unexplained.length > 0) {
    const on = new Set(unexplained.map((u) => u.screenshot)).size
    const pixels = unexplained.reduce((sum, u) => sum + u.pixels, 0)
    parts.push(
      `${plural(unexplained.length, 'unexplained region')} on ${plural(on, 'screenshot')} ${unexplained.length === 1 ? 'holds' : 'hold'} ${share(pixels, totals.pixels)} of changed pixels`
    )
  }
  return {
    top,
    screenshots: reached.size,
    settled,
    pixels,
    lead,
    rest: parts.length === 0 ? null : `${capital(parts.join('; '))}.`,
  }
}

/** `3 causes appear on 119 of 120 changed screenshots, 29% of changed pixels; they account for every changed pixel on 12 of them:` */
function leadSentence(
  causes: number,
  reached: number,
  settled: number,
  pixels: string,
  changed: number
): string {
  const one = causes === 1
  const base = `${plural(causes, 'cause')} ${one ? 'appears' : 'appear'} ${onScreenshots(reached, changed)}, ${pixels} of changed pixels`
  if (settled === reached)
    return `${base}, and ${one ? 'accounts' : 'account'} for every changed pixel there:`
  if (settled > 0)
    return `${base}; ${one ? 'it accounts' : 'they account'} for every changed pixel on ${count(settled)} of them:`
  return `${base}; ${reached === 1 ? 'that screenshot has' : 'every one of those screenshots has'} other changes too:`
}

/** The first causes in report order, up to the last of the first few that adds a changed screenshot the list appears on or one it accounts for every changed pixel on. */
function leadingCauses(report: Pick<ReportV1, 'causes' | 'screenshots'>): CauseV1[] {
  const first = report.causes.slice(0, RUN_SUMMARY_CAUSES)
  let length = 0
  first.forEach((_, index) => {
    const before = first.slice(0, index)
    const after = first.slice(0, index + 1)
    if (
      screenshotsOf(after).size > screenshotsOf(before).size ||
      settledBy(report, after) > settledBy(report, before)
    )
      length = index + 1
  })
  return first.slice(0, length)
}

/** Changed screenshots on which the causes account for every changed pixel: they appear there, and no other cause and no unexplained region does. */
function settledBy(report: Pick<ReportV1, 'screenshots'>, causes: readonly CauseV1[]): number {
  const reached = screenshotsOf(causes)
  const listed = new Set(causes.map((cause) => cause.id))
  return report.screenshots.filter(
    (s) => reached.has(s.id) && s.unexplained.length === 0 && s.causes.every((id) => listed.has(id))
  ).length
}

function screenshotsOf(causes: readonly CauseV1[]): Set<string> {
  return new Set(causes.flatMap((cause) => cause.members.map((member) => member.screenshot)))
}

function pixelsOf(causes: readonly CauseV1[]): number {
  return causes.reduce((sum, cause) => sum + cause.pixels, 0)
}

/** The changed screenshots of a report and their changed pixels, which a cause's impact is a share of. */
export function runTotals(report: Pick<ReportV1, 'screenshots'>): RunTotals {
  const changed = report.screenshots.filter((s) => s.status === 'changed')
  return {
    screenshots: changed.length,
    pixels: changed.reduce((sum, s) => sum + s.pixels, 0),
  }
}

/** What a run whose failed screenshots the report explains none of opens with: `12 failed screenshots, none explained`. */
export function noneExplained(failed: number): string {
  return `${plural(failed, 'failed screenshot')}, none explained`
}

/** A cause's headline without its share of the run: what the cause did, the line a test, which sees one screenshot, gives it. */
export function bareHeadline(report: Pick<ReportV1, 'screenshots'>, cause: CauseV1): string {
  return withoutImpact(cause, runTotals(report))
}

/** Why a screenshot the report finds unchanged is so, in one plain sentence: when its size changed, the sizes, the pixels both sides cover and that the rest is blank; else that none of its pixels differs at whydiff's own comparison threshold. */
export function describeUnchanged(screenshot: ScreenshotV1): string {
  const { width, height, sizeMismatch } = screenshot
  if (sizeMismatch === undefined) {
    return `none of the ${count(width * height)} pixels differs at whydiff's own comparison threshold`
  }
  const { before, after } = sizeMismatch
  const shared = Math.min(before[0], after[0]) * Math.min(before[1], after[1])
  // The comparison pads the smaller side with transparent pixels and reads them as white, so the
  // area only one side covers left no changed pixel only where it is blank.
  return `the screenshot was ${String(before[0])}x${String(before[1])} px, now ${String(after[0])}x${String(after[1])} px: the ${count(shared)} pixels both cover are unchanged and the area only one covers is blank`
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** One screenshot in the single-pair form, what changed on it first; the text the Playwright attachment carries. */
export function renderScreenshot(
  report: ReportV1,
  screenshot: string,
  options: RenderOptions = {}
): string {
  const command = options.explainCommand ?? DEFAULT_COMMAND
  const entry = report.screenshots.find((s) => s.id === screenshot)
  if (entry === undefined) return `# whydiff: no screenshot ${screenshot} in this report\n`
  const causes = report.causes.filter((c) => entry.causes.includes(c.id))
  const unexplained = report.unexplained.filter((u) => entry.unexplained.includes(u.id))
  if (entry.status === 'identical') {
    return join([
      `# whydiff: ${safe(entry.title)} | no visible change`,
      comparedLine(report),
      sourceLine(entry),
      `${capital(describeUnchanged(entry))}.`,
      SENTENCES.noChangeChecklist,
    ])
  }
  const observed = changedLines(report, entry.id).map(
    (line) => `- ${line.markdown} (${line.causes.join(', ')})`
  )
  const lines = [
    ...(observed.length > 0 ? [SENTENCES.observed, ...observed, ''] : []),
    `# whydiff: ${safe(entry.title)} | ${plural(causes.length, 'cause')} | ${plural(unexplained.length, 'unexplained region')}`,
    comparedLine(report),
    sourceLine(entry),
  ]
  for (const cause of causes) lines.push('', ...renderCause(cause, report, command, entry.id))
  if (unexplained.length > 0) lines.push('', ...renderUnexplained(unexplained, report))
  lines.push(...screenshotNotes(entry, false).map((note) => `\n${note}`))
  return join(lines)
}

function renderNoChange(report: ReportV1, failed: number): string {
  if (failed > 0) {
    return join([
      `# whydiff: ${noneExplained(failed)}`,
      comparedLine(report),
      SENTENCES.noneExplained('below'),
    ])
  }
  const pixels = report.screenshots.reduce((sum, s) => sum + s.width * s.height, 0)
  return join([
    `# whydiff: ${safe(report.compared.before)} -> ${safe(report.compared.after)} | 0 causes | 0 unexplained regions`,
    comparedLine(report),
    SENTENCES.noChange(pixels),
    SENTENCES.noChangeChecklist,
  ])
}

function comparedLine(report: ReportV1): string {
  const { before, after, browser, viewport } = report.compared
  const tail = [browser, viewport].filter((part): part is string => part !== undefined).join(' ')
  return `compared: ${safe(before)} -> ${safe(after)}${tail === '' ? '' : ` | ${safe(tail)}`}`
}

function sourceLine(entry: ScreenshotV1): string {
  const where = [
    entry.file !== undefined
      ? `${safe(entry.file)}${entry.line !== undefined ? `:${String(entry.line)}` : ''}`
      : null,
    entry.project === undefined || entry.project === '' ? null : safe(entry.project),
  ].filter((p): p is string => p !== null)
  const size = `${String(entry.width)}x${String(entry.height)} px, ${count(entry.pixels)} changed pixels`
  return `source: ${[...where, size, entry.id].join(' | ')}`
}

/** A cause's block as the run report prints it, with the default `explain` command: the text `report.json` keeps beside the cause. */
export function renderCauseText(cause: CauseV1, report: Pick<ReportV1, 'screenshots'>): string {
  return renderCause(cause, report, DEFAULT_COMMAND).join('\n')
}

function renderCause(
  cause: CauseV1,
  report: Pick<ReportV1, 'screenshots'>,
  command: string,
  screenshot?: string
): string[] {
  const parts = causeParts(cause, report, command, screenshot)
  const lines = [
    parts.example,
    ...parts.why,
    ...parts.effects,
    ...(parts.ambiguous === null ? [] : [parts.ambiguous]),
    ...(parts.restore === null ? [] : [parts.restore]),
    ...(parts.occurrences === null ? [] : [parts.occurrences]),
  ]
  return [`## ${parts.heading} (${handleOf(cause)})`, ...lines.map((line) => `- ${line}`)]
}

/** What closes a cause's heading: the rule of a rule cause as its rule line names it, then the id: `` `.ui-col` and 2 more, c1g6bij ``; the id alone for any other cause. */
export function handleOf(cause: CauseV1): string {
  const { summary } = cause
  if (summary.kind !== 'rule') return cause.id
  const rule =
    summary.selector === ''
      ? summary.sheet
      : summary.selector.startsWith(REGISTRATION)
        ? code(summary.selector)
        : shortSelector(summary.selector)
  return `${rule}, ${cause.id}`
}

/** A cause block in parts, each Markdown text without its list marker: the headline, the member shown, why, what followed, how sure, where a fix goes, and the command for every member. */
export function causeParts(
  cause: CauseV1,
  report: Pick<ReportV1, 'screenshots'>,
  command: string = DEFAULT_COMMAND,
  screenshot?: string
): {
  readonly heading: string
  readonly example: string
  readonly why: readonly string[]
  readonly effects: readonly string[]
  readonly ambiguous: string | null
  readonly restore: string | null
  readonly occurrences: string | null
} {
  const run = screenshot === undefined
  const only = run && cause.file !== undefined ? `, only in ${safe(cause.file)}` : ''
  const shown = shownMember(cause, screenshot)
  const { summary } = cause
  return {
    heading: `${cause.headline}${only}`,
    example: whatAndWhere(cause, report, shown, run),
    why:
      summary.kind === 'rule'
        ? ruleLines(summary, code(`${command} ${cause.id}`))
        : [describeSummary(cause.level, summary)],
    effects: (run ? cause.effects : (shown?.member.effects ?? [])).map(
      (effect) => `as a result, ${describeEffect(effect)}`
    ),
    ambiguous:
      cause.match === 'ambiguous'
        ? SENTENCES.ambiguous(cause.ambiguous, cause.members.length)
        : null,
    restore: summary.kind === 'rule' ? restoreLine(summary) : null,
    occurrences:
      run && cause.members.length > 1 ? `all occurrences: ${code(`${command} ${cause.id}`)}` : null,
  }
}

/** The member a cause shows: what the cause did there, then where. */
function whatAndWhere(
  cause: CauseV1,
  report: Pick<ReportV1, 'screenshots'>,
  shown: ReturnType<typeof shownMember>,
  run: boolean
): string {
  const prefix =
    shown?.shared !== true
      ? ''
      : run
        ? 'for example, '
        : `${plural(shown.members, 'element')} here; for example, `
  const { example } = cause
  const where = run
    ? `at ${code(example.locator)} in ${screenName(report, example.screenshot)}${example.src === undefined ? '' : `, source hint ${code(example.src)}`}`
    : `at ${code(shown?.member.locator ?? example.locator)}`
  const what = shown === undefined ? null : memberText(cause, shown.member)
  return what === null ? `${prefix}${where}` : `${prefix}${what}, ${where}`
}

/** What the cause did on one of several members: the facts of its observation the cause can show, else the cause's own longhands that changed there; null for a cause of one member, which its headline and lines already say. */
function memberText(cause: CauseV1, member: MemberV1): string | null {
  const { observation } = member
  if (cause.members.length === 1) return null
  const shows = showsAs(cause.summary)
  const facts = observation?.facts.filter((fact) => shows(fact.kind)) ?? []
  if (observation !== undefined && facts.length > 0) {
    return facts.length === observation.facts.length
      ? observation.text
      : observationText(observation.element, facts)
  }
  const props = propsOf(cause.summary)
  const changes = (member.changes ?? []).filter((c) => props === null || props.includes(c.prop))
  if (changes.length === 0) return null
  const parts = collapseSides(changes).map((c) => {
    const pair = `was ${value(c.from ?? '')}, now ${value(c.to ?? '')}`
    return c.prop.endsWith(')') ? `${c.prop.slice(0, -1)}, ${pair})` : `${c.prop} (${pair})`
  })
  const last = parts.pop() ?? ''
  return `${parts.length === 0 ? last : `${parts.join(', ')} and ${last}`} changed`
}

function screenName(report: Pick<ReportV1, 'screenshots'>, screenshot: string): string {
  const title = report.screenshots.find((s) => s.id === screenshot)?.title
  return title === undefined ? screenshot : `${quoted(title)} (${screenshot})`
}

/** The member a cause names: its example in the run, its largest member on one screenshot, the first on a tie; `shared` when more members share the cause there. */
function shownMember(
  cause: CauseV1,
  screenshot?: string
): { readonly member: MemberV1; readonly shared: boolean; readonly members: number } | undefined {
  const { example } = cause
  const members =
    screenshot === undefined
      ? cause.members
      : cause.members.filter((m) => m.screenshot === screenshot)
  const member =
    screenshot === undefined
      ? members.find((m) => m.screenshot === example.screenshot && m.locator === example.locator)
      : members.reduce<MemberV1 | undefined>(
          (best, m) => (best === undefined || m.elements > best.elements ? m : best),
          undefined
        )
  return member === undefined
    ? undefined
    : { member, shared: members.length > 1, members: members.length }
}

/** One line of what changed on a screenshot and the causes it belongs to. */
export interface ChangedLine {
  /** The line without Markdown: `the "Save" button is 8 px wider (was 80, now 88)`. */
  readonly text: string
  /** The line as the screenshot's page prints it, identifiers in code spans. */
  readonly markdown: string
  /** Other elements on the screenshot that share any of its causes, which both texts end with: `, and 3 more elements changed with it`. */
  readonly others: number
  /** Ids of its causes, in report order. */
  readonly causes: readonly string[]
}

/** What changed on a screenshot, the lines its page opens with, in the order a person notices them; empty when no member there is observed, where the page opens with its header. */
export function changedLines(report: ReportV1, screenshot: string): ChangedLine[] {
  const entry = report.screenshots.find((s) => s.id === screenshot)
  if (entry === undefined) return []
  const causes = report.causes.filter((c) => entry.causes.includes(c.id))
  return observedLines(causes, entry.id).map((line) => {
    const markdown = `${line.text}${andMore(line.others)}`
    return { text: plain(markdown), markdown, others: line.others, causes: line.ids }
  })
}

/** One line per element the causes on a screenshot name, with every cause that names it and how many other elements on the screenshot share any of those causes: elements that appear or go first, then named elements that changed, then moves and unnamed containers, each in cause order. */
function observedLines(
  causes: readonly CauseV1[],
  screenshot: string
): { text: string; others: number; ids: string[] }[] {
  const lines: {
    locator: string
    text: string
    shown: MemberV1[]
    causes: CauseV1[]
    rank: number
    order: number
  }[] = []
  causes.forEach((cause, order) => {
    const shown = shownMember(cause, screenshot)
    const observation = shown?.member.observation
    if (shown === undefined || observation === undefined) return
    const { locator } = shown.member
    const { text } = observation
    const line = lines.find((l) => l.locator === locator && l.text === text)
    if (line === undefined) {
      lines.push({
        locator,
        text,
        shown: [shown.member],
        causes: [cause],
        rank: salience(observation),
        order,
      })
    } else {
      line.shown.push(shown.member)
      line.causes.push(cause)
    }
  })
  return lines
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((line) => ({
      text: line.text,
      others: othersOf(line.causes, screenshot, line.shown),
      ids: line.causes.map((c) => c.id),
    }))
}

/** The elements on a screenshot that are members of any of these causes there, not counting the ones the line names; an element under several of them counts once. */
function othersOf(
  causes: readonly CauseV1[],
  screenshot: string,
  shown: readonly MemberV1[]
): number {
  const key = (m: MemberV1): string => `${m.locator} ${JSON.stringify(m.box ?? null)}`
  const keys = new Set(
    causes.flatMap((c) => c.members.filter((m) => m.screenshot === screenshot).map(key))
  )
  for (const member of shown) keys.delete(key(member))
  return keys.size
}

/** What closes a line about one element when more changed with it: `, and 3 more elements changed with it`. */
function andMore(others: number): string {
  return others === 0 ? '' : `, and ${plural(others, 'more element')} changed with it`
}

/** 0 for an element that appears or goes, 1 for a named element that changed size, text or look, 2 for a move or an element named only by its tag or class. */
function salience(observation: ObservationV1): number {
  const { element, facts } = observation
  if (facts.some((f) => PRESENCE.has(f.kind))) return 0
  const named = element.role !== undefined || element.name !== undefined
  return named && facts.some((f) => !MOVES.has(f.kind)) ? 1 : 2
}

function describeSummary(
  level: CauseV1['level'],
  summary: Exclude<CauseV1['summary'], RuleSummary>
): string {
  switch (summary.kind) {
    case 'style':
    case 'container':
    case 'paint-order': {
      const changes = describeChanges(level, collapseSides(summary.changes))
      if (summary.kind === 'container') return `${changes}; the children were laid out again`
      if (summary.kind === 'paint-order')
        return `${changes}; a stacking context changed, so elements paint in a different order and nothing moved`
      return changes
    }
    case 'content':
      switch (summary.detail) {
        case 'text':
          return 'text changed'
        case 'wrap':
          return 'same text, different number of lines'
        case 'font-metrics':
          return summary.from === undefined || summary.to === undefined
            ? 'same text and styles, different size: the font metrics changed'
            : `same text and styles, rendered with another font (was ${safe(summary.from)}, now ${safe(summary.to)})`
      }
    // eslint-disable-next-line no-fallthrough -- every detail returns above
    case 'added':
      return 'element added; not present before'
    case 'removed':
      return 'element no longer rendered'
    case 'scrolled':
      return 'scroll offset of this container changed'
    case 'resized':
      return 'size changed with no style change of its own'
  }
}

/** The rule named once with what it does now on one line, what its move between layers means for the cascade, then the longhands that changed through its custom properties and the custom properties its own longhands read from other rules. */
function ruleLines(rule: RuleSummary, pointer: string): string[] {
  const vars = rule.vars ?? []
  const changedVar = (name: string): string => {
    const seen = vars.find((v) => v.name === name)
    return seen?.from === undefined || seen.to === undefined
      ? safe(name)
      : `${safe(name)} (was ${value(seen.from)}, now ${value(seen.to)})`
  }
  const mixed = rule.mixed ?? []
  // one pointer per line: later longhands whose values differ only say so
  let pointed = false
  const differ = (): string => {
    const text = pointed ? 'values differ per element' : `values differ per element: ${pointer}`
    pointed = true
    return text
  }
  const entries = (list: readonly string[], custom: (name: string) => string): string => {
    const plain = list.filter((entry) => !mixed.some((m) => m.prop === entry))
    return [
      valued(
        plain.filter((entry) => !entry.startsWith('--')),
        rule,
        differ
      ),
      ...plain.filter((entry) => entry.startsWith('--')).map(custom),
    ]
      .filter((part) => part !== '')
      .join(', ')
  }
  const sets = entries(rule.sets, safe)
  const changed = entries(rule.changed, changedVar)
  const unsets = entries(rule.unsets, safe)
  const over = rule.over === undefined ? '' : ` in place of ${overName(rule)}`
  const clauses = rule.selector.startsWith(REGISTRATION)
    ? registrationClauses(rule)
    : [
        sets === '' ? null : `now sets ${sets}${over}`,
        changed === '' ? null : `changed its declaration of ${changed}`,
        unsets === '' ? null : `no longer sets ${unsets}`,
        ...mixed.map((m, index) => mixedClause(m, rule, sets === '' && index === 0 ? over : '')),
      ].filter((clause): clause is string => clause !== null)
  const lines = [clauses.length === 0 ? ruleName(rule) : `${ruleName(rule)} ${clauses.join('; ')}`]
  const move = layerMove(rule)
  if (move !== null) lines.push(move)
  lines.push(...readByLines(rule), ...(rule.via ?? []).map(viaLine))
  return lines
}

/** `now sets filter on 2 elements and no longer sets it on 1`: one entry the members disagree on, with how many each way. */
function mixedClause(mixed: MixedLonghand, rule: RuleSummary, over: string): string {
  const { prop } = mixed
  const name = prop.startsWith('--') ? safe(prop) : prop
  return [
    { verb: 'now sets', list: rule.sets, n: mixed.sets, over },
    { verb: 'changed its declaration of', list: rule.changed, n: mixed.changed, over: '' },
    { verb: 'no longer sets', list: rule.unsets, n: mixed.unsets, over: '' },
  ]
    .filter((part) => part.list.includes(prop))
    .map(
      (part, index) =>
        `${part.verb} ${index === 0 ? name : 'it'} on ${plural(part.n, 'element')}${part.over}`
    )
    .join(' and ')
}

/** Longhands grouped by the computed values every member went between, four equal sides read as one: `padding-left, padding-right (was 16px, now 24px)`; those whose values differ per member last, saying so in the words `differ` gives. A report without values names the longhands alone. */
function valued(longhands: readonly string[], rule: RuleSummary, differ: () => string): string {
  const { values } = rule
  if (values === undefined) return props(longhands)
  const groups: { key: string; props: string[]; pair: LonghandValues | undefined }[] = []
  for (const prop of longhands) {
    const pair = values.find((v) => v.prop === prop)
    const key = pair === undefined ? '' : `${pair.from}\n${pair.to}`
    const group = groups.find((g) => g.key === key)
    if (group === undefined) groups.push({ key, props: [prop], pair })
    else group.props.push(prop)
  }
  return [
    ...groups.filter((g) => g.pair !== undefined),
    ...groups.filter((g) => g.pair === undefined),
  ]
    .map(({ props: list, pair }) => {
      const names = props(list)
      const change =
        pair === undefined ? differ() : `was ${value(pair.from)}, now ${value(pair.to)}`
      return names.endsWith(')') && !names.includes(', ')
        ? `${names.slice(0, -1)}, ${change})`
        : `${names} (${change})`
    })
    .join(', ')
}

/** A value as a line prints it: a colour as observations write it, a value of several words in a code span so its commas and spaces stay its own. */
function value(text: string): string {
  const printed = shown(text)
  return printed.includes(' ') ? code(printed) : safe(printed)
}

function props(list: readonly string[]): string {
  return collapseSides(list.map((prop) => ({ prop })))
    .map((c) => c.prop)
    .join(', ')
}

/** What an `@property` rule did to the one name it registers. */
function registrationClauses(rule: RuleSummary): string[] {
  const [seen] = rule.vars ?? []
  const initial = (text: string | undefined): string =>
    text === undefined ? '' : ` (initial value ${value(text)})`
  if (rule.sets.length > 0) return [`registers it${initial(seen?.to)}`]
  if (rule.unsets.length > 0) return [`no longer registers it${initial(seen?.from)}`]
  const values =
    seen?.from === undefined || seen.to === undefined
      ? ''
      : ` (was ${value(seen.from)}, now ${value(seen.to)})`
  return [`changed its initial value${values}`]
}

/** One line per group of custom properties read by the same longhands with the same outcome where a side had no value. */
function readByLines(rule: RuleSummary): string[] {
  const groups: { key: string; names: string[]; line: (names: readonly string[]) => string }[] = []
  for (const seen of rule.vars ?? []) {
    const side = rule.unsets.includes(seen.name) ? 'now' : 'before'
    const key = `${seen.readBy.join(',')}|${seen.missing ?? ''}|${side}`
    const group = groups.find((g) => g.key === key)
    if (group !== undefined) group.names.push(seen.name)
    else groups.push({ key, names: [seen.name], line: (names) => readByLine(names, seen, side) })
  }
  return groups.map((group) => group.line(group.names))
}

function readByLine(names: readonly string[], seen: VarChange, side: 'now' | 'before'): string {
  const readers = props(seen.readBy)
  const one = collapseSides(seen.readBy.map((prop) => ({ prop }))).length === 1
  const them = names.length === 1 ? 'it' : 'them'
  const tail =
    seen.missing === 'fallback'
      ? side === 'now'
        ? `, which now ${one ? 'uses its' : 'use their'} var() fallback`
        : `, which used ${one ? 'its' : 'their'} var() fallback before`
      : seen.missing === 'invalid'
        ? side === 'now'
          ? `, which ${one ? 'is' : 'are'} invalid without ${them}`
          : `, which ${one ? 'was' : 'were'} invalid without ${them}`
        : ''
  return `${names.map(safe).join(', ')} ${names.length === 1 ? 'is' : 'are'} read by ${readers}${tail}`
}

function viaLine(via: ViaRule): string {
  const one = collapseSides(via.readBy.map((prop) => ({ prop }))).length === 1
  return `${props(via.readBy)} ${one ? 'reads' : 'read'} ${safe(via.name)}, set by ${ruleName(via.rule)}`
}

/** The rule every member's `sets` lost to; the browser's with the declarations it had, as a code span. */
function overName(rule: RuleSummary): string {
  const { over } = rule
  if (over === undefined) return ''
  if (over.userAgent !== true) return ruleName(over)
  const declarations = (rule.defaults ?? []).map((d) => ({ prop: d.prop, from: d.value }))
  if (declarations.length === 0) return `the browser's default for ${code(over.selector)}`
  const block = collapseSides(declarations)
    .map((d) => `${shorthand(d.prop)}: ${d.from ?? ''}`)
    .join('; ')
  return `the browser's default ${code(`${over.selector} { ${block} }`)}`
}

/** The shorthand of four equal sides or corners, as CSS writes it: `border-width`, `padding`, `border-radius`. */
function shorthand(prop: string): string {
  return prop.replace(ALL_SIDES, '')
}

/** A move between cascade layers in one sentence: the layer decides before specificity, unlayered rules count as the last layer, and `!important` turns the order around (CSS Cascade 5, 6.4). */
function layerMove(rule: RuleSummary): string | null {
  const { layerFrom: from, layerTo: to } = rule
  const important = rule.important === true
  const its = important ? 'its !important declarations' : 'its declarations'
  const any = important ? 'any !important declaration' : 'any declaration'
  const regardless = "whatever the selectors' specificity"
  if (from === undefined) {
    if (to === undefined) return null
    return `it moved from unlayered into layer ${code(to)}: ${its} now ${important ? 'beat' : 'lose to'} ${any} of the same property outside a layer, ${regardless}`
  }
  if (to === undefined) {
    return `it moved out of layer ${code(from)}: outside a layer, ${its} now ${important ? 'lose to' : 'beat'} ${any} of the same property in a layer, ${regardless}`
  }
  return `it moved from layer ${code(from)} into layer ${code(to)}: between ${important ? '!important ' : ''}declarations of the same property in two layers, the layer declared ${important ? 'first' : 'later'} wins, ${regardless}`
}

function restoreLine(rule: RuleSummary): string {
  if (rule.selector === '')
    return 'to restore it: change the style attribute where the markup or a script sets it'
  const sheet = code(rule.sheet)
  const set = `set ${oldValues(rule)} in your own stylesheet`
  if (VENDOR.test(rule.sheet))
    return `to restore it: ${set}; do not edit ${sheet}, which reads as a dependency's (vendor in its name)`
  if (builtName(rule.sheet))
    return `to restore it: change the rule in the source file that builds ${sheet}, or ${set} if the rule comes from a dependency; whydiff cannot tell from a built sheet which it is`
  if (INJECTED.test(rule.sheet))
    return `to restore it: change the rule where ${sheet} comes from, or ${set} if a dependency injects it; whydiff cannot tell which`
  return `to restore it: change the rule in ${sheet}, or ${set} if ${sheet} comes from a dependency`
}

/** What a restore sets, in one clause: `padding-left, padding-right back to 16px`, when every entry of the rule had one old value on every member and they fall in a few groups; else `the old values`. */
function oldValues(rule: RuleSummary): string {
  const entries = [...rule.sets, ...rule.changed, ...rule.unsets]
  const groups: { from: string; entries: string[] }[] = []
  for (const entry of [...new Set(entries)].sort(compareText)) {
    const from = entry.startsWith('--')
      ? rule.vars?.find((v) => v.name === entry)?.from
      : rule.values?.find((v) => v.prop === entry)?.from
    if (from === undefined) return 'the old values'
    const group = groups.find((g) => g.from === from)
    if (group === undefined) groups.push({ from, entries: [entry] })
    else group.entries.push(entry)
  }
  if (groups.length === 0 || groups.length > RESTORE_MAX_VALUES) return 'the old values'
  return groups
    .map((group) => {
      const custom = group.entries.filter((entry) => entry.startsWith('--')).map(safe)
      const names = [props(group.entries.filter((entry) => !entry.startsWith('--'))), ...custom]
        .filter((part) => part !== '')
        .join(', ')
      return `${names} back to ${value(group.from)}`
    })
    .join(' and ')
}

/** `` `.ui-col` from `framework.css` (layer `framework.components`) ``, `` `.card` from `app.css` (unlayered, !important) ``, `the style attribute`, `the style attribute of an ancestor`, `` `@property --ui-gap` from `app.css` ``. */
function ruleName(rule: RuleRef): string {
  const marks = rule.important === true ? ['!important'] : []
  if (rule.selector === '') {
    return marks.length === 0 ? `the ${rule.sheet}` : `the ${rule.sheet} (${marks.join(', ')})`
  }
  if (rule.selector.startsWith(REGISTRATION))
    return `${code(rule.selector)} from ${code(rule.sheet)}`
  const where = [rule.layer === undefined ? 'unlayered' : `layer ${code(rule.layer)}`, ...marks]
  return `${shortSelector(rule.selector)} from ${code(rule.sheet)} (${where.join(', ')})`
}

/** A selector list by its shortest selector, the first on a tie, and how many more: `` `.ui-col` and 2 more ``. */
function shortSelector(selector: string): string {
  const [first = selector, ...rest] = selectorList(selector)
  if (rest.length === 0) return code(selector)
  const shortest = rest.reduce((best, s) => (s.length < best.length ? s : best), first)
  return `${code(shortest)} and ${count(rest.length)} more`
}

type Change = Extract<CauseV1['summary'], { changes: unknown }>['changes'][number]

/** A member's own changes on one line, four equal sides read as one: `padding (all sides) 0px -> 12px`. */
export function describeMemberChanges(changes: readonly MemberChangeV1[]): string {
  return collapseSides(changes)
    .map((c) => `${c.prop} ${shown(c.from ?? '')} -> ${shown(c.to ?? '')}`)
    .join('; ')
}

/** A computed value as the report prints it: a colour in the notation of the observations, anything else as captured. */
function shown(value: string): string {
  return hexColor(value) ?? value
}

function describeChanges(level: CauseV1['level'], changes: readonly Change[]): string {
  if (level === 1)
    return changes
      .map((c) => `${c.prop}: was ${value(c.from ?? '')}, now ${value(c.to ?? '')}`)
      .join('; ')
  if (level === 2)
    return changes.map((c) => `${c.prop}: ${describeDelta(c.delta ?? '')}`).join('; ')
  return `changed: ${changes.map((c) => c.prop).join(', ')} (values differ per element)`
}

/** A cluster key's parameter in words: `<len +8px>` as `+8px`, `<color>` as `another colour`, `<kw a>b>` as `was a, now b`. */
function describeDelta(delta: string): string {
  const step = /^<(?:len|num) (.*)>$/.exec(delta)?.[1]
  if (step !== undefined) return step
  if (delta === '<color>') return 'another colour'
  const keywords = /^<kw (.*?)>(.*)>$/.exec(delta)
  if (keywords !== null) return `was ${safe(keywords[1] ?? '')}, now ${safe(keywords[2] ?? '')}`
  return safe(delta)
}

const SIDES = ['top', 'right', 'bottom', 'left']
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left']

/** Four equal per-side changes read as one: `border-width (all sides) 2px -> 0`. */
function collapseSides(changes: readonly Change[]): Change[] {
  const byProp = new Map(changes.map((c) => [c.prop, c]))
  const taken = new Set<string>()
  const out: Change[] = []
  const group = (props: string[], label: string): boolean => {
    const found = props.map((p) => byProp.get(p))
    const [first] = found
    if (first === undefined || found.some((c) => c === undefined || !sameChange(c, first))) {
      return false
    }
    for (const p of props) taken.add(p)
    out.push({ ...first, prop: label })
    return true
  }
  for (const c of changes) {
    if (taken.has(c.prop)) continue
    const side = SIDES.find((s) => c.prop.includes(`-${s}`))
    const corner = CORNERS.find((k) => c.prop.includes(`-${k}-`))
    if (corner !== undefined) {
      const [head, tail] = c.prop.split(`-${corner}-`)
      if (
        group(
          CORNERS.map((k) => `${head ?? ''}-${k}-${tail ?? ''}`),
          `${head ?? ''}-${tail ?? ''} (all corners)`
        )
      )
        continue
    } else if (side !== undefined) {
      const [head, tail] = c.prop.split(`-${side}`)
      if (
        group(
          SIDES.map((s) => `${head ?? ''}-${s}${tail ?? ''}`),
          `${head ?? ''}${tail ?? ''} (all sides)`
        )
      )
        continue
    }
    out.push(c)
  }
  return out
}

function sameChange(a: Change, b: Change): boolean {
  return a.from === b.from && a.to === b.to && a.delta === b.delta
}

/** One consequence of a cause as a clause: `3 elements moved 4 px down`, `145 elements moved, 120 of them 12 px up`. */
export function describeEffect(effect: EffectV1): string {
  const nodes = plural(effect.nodes, 'element')
  const one = effect.nodes === 1
  switch (effect.kind) {
    case 'shifted':
      if (effect.vector === undefined) return `${nodes} shifted`
      return effect.vectorNodes === undefined
        ? `${nodes} moved ${distance(effect.vector)}`
        : `${nodes} moved, ${count(effect.vectorNodes)} of them ${distance(effect.vector)}`
    case 'resized':
      return `${nodes} resized with it`
    case 'reflowed':
      return `${nodes} ${one ? 'was' : 'were'} laid out again inside the same container`
    case 'painted':
      return `${nodes} ${one ? 'looks' : 'look'} different under it`
    case 'inherited':
      return `${nodes} ${one ? 'inherits' : 'inherit'} the change`
  }
}

function renderUnexplained(
  unexplained: readonly UnexplainedV1[],
  report: Pick<ReportV1, 'screenshots'>
): string[] {
  return [
    `## Unexplained regions (${count(unexplained.length)})`,
    ...SENTENCES.unexplainedIntro,
    ...unexplained.map((u) => `- ${describeRegion(u, report)}`),
  ]
}

/** One unexplained region on one line: its id, screenshot, size and place, changed pixels, note and candidates. */
export function describeRegion(
  region: UnexplainedV1,
  report: Pick<ReportV1, 'screenshots'>
): string {
  const [x, y, width, height] = region.region
  const candidates = region.candidates
    .map((c) => `${code(c.locator)} ${String(c.share / 10)}%`)
    .join(', ')
  return `${region.id} in ${screenName(report, region.screenshot)} | region ${String(width)}x${String(height)} at (${String(x)},${String(y)}), ${count(region.pixels)} changed pixels${region.note === undefined ? '' : ` | ${region.note}`}${candidates === '' ? '' : ` | candidates, by how much of their box changed: ${candidates}`}`
}

/** The tail of a run report: one line per group of unexplained regions, then the notes of the screenshots whose size note no single-screenshot group took in. */
export function tailParts(
  report: ReportV1,
  command: string = DEFAULT_COMMAND
): { readonly groups: readonly string[]; readonly notes: readonly string[] } {
  const tail = tailGroups(report)
  const folded = new Set(tail.flatMap((g) => (g.screenshots.length === 1 ? g.screenshots : [])))
  return {
    groups: tail.map((group) => groupLine(group, report, command)),
    notes: report.screenshots.flatMap((s) => screenshotNotes(s, true, !folded.has(s.id))),
  }
}

/** The unexplained regions of a run grouped by screenshot, a screenshot whose regions repeat those of an earlier one exactly joining its group; the most changed pixels first. */
function tailGroups(report: ReportV1): TailGroup[] {
  const groups: (TailGroup & { readonly pattern: string })[] = []
  report.screenshots.forEach((screenshot, order) => {
    const regions = report.unexplained.filter((u) => u.screenshot === screenshot.id)
    if (regions.length === 0) return
    const pattern = regions
      .map(
        (u) =>
          `${u.region.join(',')}|${u.note ?? ''}|${u.candidates.map((c) => c.locator).join(',')}`
      )
      .sort()
      .join(';')
    const pixels = regions.reduce((sum, u) => sum + u.pixels, 0)
    const group = groups.find((g) => g.pattern === pattern)
    if (group === undefined)
      groups.push({ pattern, order, screenshots: [screenshot.id], regions, pixels })
    else group.screenshots.push(screenshot.id)
  })
  return groups.sort(
    (a, b) => b.pixels * b.screenshots.length - a.pixels * a.screenshots.length || a.order - b.order
  )
}

/** A group of the tail on one line: where, how many pixels, what lies under the regions, the size note of its screenshot and the command that lists every region. */
function groupLine(group: TailGroup, report: ReportV1, command: string): string {
  const [first = '', ...more] = group.screenshots
  const regions = plural(group.regions.length, 'region')
  const where =
    more.length === 0
      ? `${regions} on ${screenName(report, first)}`
      : `${regions} on ${screenName(report, first)} and the same on ${plural(more.length, 'more screenshot')} (${more.join(', ')})`
  const mismatch = report.screenshots.find((s) => s.id === first)?.sizeMismatch
  return [
    `${where}, ${count(group.pixels)} changed pixels${more.length === 0 ? '' : ' each'}`,
    notesClause(group.regions),
    aroundClause(group.regions),
    more.length === 0 && mismatch !== undefined
      ? `; the screenshot was ${size(mismatch.before)}, now ${size(mismatch.after)}, and only the overlapping area was compared`
      : '',
    `; every region with its candidates: ${code(`${command} ${first}`)}`,
  ].join('')
}

/** `: 27 under <canvas>, 2 anti-aliasing, 6 other`, adding up to the regions; nothing when no region has a note. */
function notesClause(regions: readonly UnexplainedV1[]): string {
  const notes = tally(regions.flatMap((u) => (u.note === undefined ? [] : [u.note])))
  if (notes.length === 0) return ''
  const other = regions.length - notes.reduce((sum, n) => sum + n.count, 0)
  const parts = notes.map((n) => `${count(n.count)} ${n.value}`)
  return `: ${[...parts, ...(other > 0 ? [`${count(other)} other`] : [])].join(', ')}`
}

/** `; 29 around X, 4 around other elements, 2 with no candidate`, adding up to the regions, when one first candidate is shared or the group is one region; else nothing. */
function aroundClause(regions: readonly UnexplainedV1[]): string {
  const [around] = tally(regions.flatMap((u) => u.candidates.slice(0, 1).map((c) => c.locator)))
  if (around === undefined || (around.count === 1 && regions.length > 1)) return ''
  if (regions.length === 1) return `; around ${code(around.value)}`
  const none = regions.filter((u) => u.candidates.length === 0).length
  const other = regions.length - none - around.count
  const parts = [
    `${around.count === regions.length ? 'all' : count(around.count)} around ${code(around.value)}`,
    ...(other > 0 ? [`${count(other)} around other elements`] : []),
    ...(none > 0 ? [`${count(none)} with no candidate`] : []),
  ]
  return `; ${parts.join(', ')}`
}

function size([width, height]: readonly [number, number]): string {
  return `${String(width)}x${String(height)} px`
}

/** How often each value occurs, the most common first, then in order of appearance. */
function tally(values: readonly string[]): { value: string; count: number }[] {
  const out: { value: string; count: number; first: number }[] = []
  values.forEach((value, index) => {
    const seen = out.find((entry) => entry.value === value)
    if (seen === undefined) out.push({ value, count: 1, first: index })
    else seen.count++
  })
  return out.sort((a, b) => b.count - a.count || a.first - b.first)
}

function screenshotNotes(entry: ScreenshotV1, named: boolean, size = true): string[] {
  const notes: string[] = []
  if (entry.massChange) notes.push(SENTENCES.massChange)
  if (entry.sizeMismatch !== undefined && size)
    notes.push(SENTENCES.sizeMismatch(entry.sizeMismatch.before, entry.sizeMismatch.after))
  return named ? notes.map((note) => `${quoted(entry.title)} (${entry.id}): ${note}`) : notes
}

function join(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`
}

function distance(point: readonly [number, number]): string {
  const axes = [step(point[0], 'left', 'right'), step(point[1], 'up', 'down')].filter(
    (axis): axis is string => axis !== null
  )
  return axes.length === 0 ? 'less than 1 px' : axes.join(' and ')
}

function step(delta: number, less: string, more: string): string | null {
  const size = Math.round(Math.abs(delta))
  return size === 0 ? null : `${count(size)} px ${delta < 0 ? less : more}`
}
