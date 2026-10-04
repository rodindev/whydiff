import type { ClusterSummary, RuleRef, RuleSummary, VarChange, ViaRule } from '../cluster/types.js'
import { OBSERVATION_FACTS, OBSERVATION_MAX_FACTS } from '../constants.js'
import { WhydiffError } from '../errors.js'
import type { Point, Rect } from '../snapshot/types.js'
import {
  CAUSE_KEYS,
  CHANGE_KEYS,
  CLUSTER_LEVELS,
  COMPARED_KEYS,
  CONTENT_DETAILS,
  DEFAULT_KEYS,
  EFFECT_KEYS,
  EFFECT_KINDS,
  ELEMENT_KEYS,
  EXAMPLE_KEYS,
  LEAD_KEYS,
  FACT_KEYS,
  MATCH_WORDS,
  MISSING_KINDS,
  MIXED_KEYS,
  OBSERVATION_KEYS,
  ROOT_KEYS,
  SCOPES,
  SCREENSHOT_KEYS,
  SCREENSHOT_STATUSES,
  MEMBER_CHANGE_KEYS,
  MEMBER_BOX_KEYS,
  MEMBER_KEYS,
  PLAIN_KINDS,
  RULE_ONLY_KEYS,
  RULE_REF_KEYS,
  RULE_SUMMARY_KEYS,
  STYLE_FAMILIES,
  SUMMARY_KEYS,
  SUMMARY_SHAPE_KEYS,
  TOOL_KEYS,
  UNEXPLAINED_KEYS,
  VAR_KEYS,
  VIA_KEYS,
} from './shape.js'
import {
  REPORT_FORMAT_VERSION,
  type CauseV1,
  type ComparedV1,
  type EffectV1,
  type ExampleV1,
  type FactV1,
  type MemberChangeV1,
  type MemberV1,
  type ObservationV1,
  type ReportDraft,
  type ReportV1,
  type ScreenshotV1,
  type UnexplainedV1,
} from './types.js'

type Raw = Record<string, unknown>
type Check<T> = (value: unknown, path: string) => T
type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/** Checks a parsed JSON value against report format v1 and returns it typed; throws WhydiffError otherwise. */
export function validateReport(value: unknown): ReportV1 {
  const raw = record(value, '$', ROOT_KEYS)
  if (raw.formatVersion !== REPORT_FORMAT_VERSION) {
    fail('$.formatVersion', `expected ${String(REPORT_FORMAT_VERSION)}`)
  }
  const causes = list(raw.causes, '$.causes', cause)
  const { lead, ...counts } = summary(raw.summary, '$.summary')
  const report = {
    formatVersion: REPORT_FORMAT_VERSION,
    tool: tool(raw.tool, '$.tool'),
    compared: compared(raw.compared, '$.compared'),
    summary: counts,
    screenshots: list(raw.screenshots, '$.screenshots', screenshot),
    causes,
    unexplained: list(raw.unexplained, '$.unexplained', unexplained),
  } satisfies ReportDraft
  checkRelations(report)
  lead.causes.forEach((id, index) => {
    if (!causes.some((c) => c.id === id))
      fail(`$.summary.lead.causes[${String(index)}]`, `unknown id ${id}`)
  })
  return { ...report, summary: { ...counts, lead } }
}

function fail(path: string, message: string): never {
  throw new WhydiffError(
    'invalid-report',
    `${path}: ${message}. Rebuild the report with the whydiff version you read it with.`
  )
}

function record(value: unknown, path: string, keys: readonly string[]): Raw {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'expected an object')
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`${path}.${key}`, 'unknown key')
  }
  return value as Raw // narrowed to a plain object above
}

function list<T>(value: unknown, path: string, item: Check<T>): T[] {
  if (!Array.isArray(value)) fail(path, 'expected an array')
  return value.map((element: unknown, index) => item(element, `${path}[${String(index)}]`))
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'expected a string')
  return value
}

function number(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'expected a finite number')
  return value
}

function integer(value: unknown, path: string, min: number): number {
  const n = number(value, path)
  if (!Number.isInteger(n) || n < min) fail(path, `expected an integer of at least ${String(min)}`)
  return n
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'expected a boolean')
  return value
}

function literalTrue(value: unknown, path: string): true {
  if (value !== true) fail(path, 'expected true')
  return true
}

function oneOf<T extends string | number>(value: unknown, path: string, allowed: readonly T[]): T {
  const match = allowed.find((item) => item === value)
  if (match === undefined) fail(path, `expected one of ${allowed.join(', ')}`)
  return match
}

function tuple(value: unknown, path: string, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length) {
    fail(path, `expected ${String(length)} numbers`)
  }
  return value.map((element: unknown, index) => number(element, `${path}[${String(index)}]`))
}

function rect(value: unknown, path: string): Rect {
  const [x, y, width, height] = tuple(value, path, 4) as [number, number, number, number] // tuple checked the length
  if (width < 0 || height < 0) fail(path, 'expected a non-negative size')
  return [x, y, width, height]
}

function point(value: unknown, path: string): Point {
  const [x, y] = tuple(value, path, 2) as [number, number] // tuple checked the length
  return [x, y]
}

function optional<T>(raw: Raw, key: string, path: string, check: Check<T>): T | undefined {
  return raw[key] === undefined ? undefined : check(raw[key], `${path}.${key}`)
}

function assign<T extends object, K extends keyof T>(
  target: Mutable<T>,
  key: K,
  value: T[K] | undefined
): void {
  if (value !== undefined) target[key] = value
}

const nonNegative = (value: unknown, path: string): number => integer(value, path, 0)

function tool(value: unknown, path: string): ReportV1['tool'] {
  const raw = record(value, path, TOOL_KEYS)
  const rules = record(raw.rules, `${path}.rules`, ['cluster'])
  return {
    name: oneOf(raw.name, `${path}.name`, ['whydiff']),
    version: string(raw.version, `${path}.version`),
    rules: { cluster: string(rules.cluster, `${path}.rules.cluster`) },
  }
}

function compared(value: unknown, path: string): ComparedV1 {
  const raw = record(value, path, COMPARED_KEYS)
  const out: Mutable<ComparedV1> = {
    before: string(raw.before, `${path}.before`),
    after: string(raw.after, `${path}.after`),
  }
  assign(out, 'browser', optional(raw, 'browser', path, string))
  assign(out, 'viewport', optional(raw, 'viewport', path, string))
  return out
}

function summary(value: unknown, path: string): ReportV1['summary'] {
  const raw = record(value, path, SUMMARY_KEYS)
  const shots = record(raw.screenshots, `${path}.screenshots`, ['compared', 'changed', 'identical'])
  const out = {
    screenshots: {
      compared: nonNegative(shots.compared, `${path}.screenshots.compared`),
      changed: nonNegative(shots.changed, `${path}.screenshots.changed`),
      identical: nonNegative(shots.identical, `${path}.screenshots.identical`),
    },
    causes: nonNegative(raw.causes, `${path}.causes`),
    unexplained: nonNegative(raw.unexplained, `${path}.unexplained`),
    massChange: nonNegative(raw.massChange, `${path}.massChange`),
  }
  const lead = record(raw.lead, `${path}.lead`, LEAD_KEYS)
  return {
    ...out,
    lead: {
      causes: list(lead.causes, `${path}.lead.causes`, string),
      screenshots: nonNegative(lead.screenshots, `${path}.lead.screenshots`),
      settled: nonNegative(lead.settled, `${path}.lead.settled`),
      pixels: nonNegative(lead.pixels, `${path}.lead.pixels`),
      text: string(lead.text, `${path}.lead.text`),
    },
  }
}

function screenshot(value: unknown, path: string): ScreenshotV1 {
  const raw = record(value, path, SCREENSHOT_KEYS)
  const out: Mutable<ScreenshotV1> = {
    id: string(raw.id, `${path}.id`),
    title: string(raw.title, `${path}.title`),
    status: oneOf(raw.status, `${path}.status`, SCREENSHOT_STATUSES),
    width: nonNegative(raw.width, `${path}.width`),
    height: nonNegative(raw.height, `${path}.height`),
    regions: nonNegative(raw.regions, `${path}.regions`),
    pixels: nonNegative(raw.pixels, `${path}.pixels`),
    massChange: boolean(raw.massChange, `${path}.massChange`),
    causes: list(raw.causes, `${path}.causes`, string),
    unexplained: list(raw.unexplained, `${path}.unexplained`, string),
  }
  assign(out, 'file', optional(raw, 'file', path, string))
  assign(
    out,
    'line',
    optional(raw, 'line', path, (v, p) => integer(v, p, 1))
  )
  assign(out, 'project', optional(raw, 'project', path, string))
  assign(
    out,
    'sizeMismatch',
    optional(raw, 'sizeMismatch', path, (v, p) => {
      const sizes = record(v, p, ['before', 'after'])
      return {
        before: point(sizes.before, `${path}.before`),
        after: point(sizes.after, `${path}.after`),
      }
    })
  )
  return out
}

function cause(value: unknown, path: string): CauseV1 {
  const raw = record(value, path, CAUSE_KEYS)
  const out: Mutable<CauseV1> = {
    id: string(raw.id, `${path}.id`),
    headline: string(raw.headline, `${path}.headline`),
    text: string(raw.text, `${path}.text`),
    key: string(raw.key, `${path}.key`),
    kind: string(raw.kind, `${path}.kind`),
    level: oneOf(raw.level, `${path}.level`, CLUSTER_LEVELS),
    summary: clusterSummary(raw.summary, `${path}.summary`),
    scope: oneOf(raw.scope, `${path}.scope`, SCOPES),
    match: oneOf(raw.match, `${path}.match`, MATCH_WORDS),
    ambiguous: nonNegative(raw.ambiguous, `${path}.ambiguous`),
    screenshots: integer(raw.screenshots, `${path}.screenshots`, 1),
    elements: integer(raw.elements, `${path}.elements`, 1),
    pixels: nonNegative(raw.pixels, `${path}.pixels`),
    effects: list(raw.effects, `${path}.effects`, effect),
    example: example(raw.example, `${path}.example`),
    members: list(raw.members, `${path}.members`, member),
  }
  assign(out, 'file', optional(raw, 'file', path, string))
  return out
}

function observation(value: unknown, path: string): ObservationV1 {
  const raw = record(value, path, OBSERVATION_KEYS)
  const facts = list(raw.facts, `${path}.facts`, fact)
  if (facts.length === 0 || facts.length > OBSERVATION_MAX_FACTS) {
    fail(`${path}.facts`, `expected 1 to ${String(OBSERVATION_MAX_FACTS)} facts`)
  }
  const element = record(raw.element, `${path}.element`, ELEMENT_KEYS)
  const named: Mutable<ObservationV1['element']> = {
    tag: string(element.tag, `${path}.element.tag`),
  }
  assign(named, 'role', optional(element, 'role', `${path}.element`, string))
  assign(named, 'name', optional(element, 'name', `${path}.element`, string))
  assign(named, 'class', optional(element, 'class', `${path}.element`, string))
  return { element: named, facts, text: string(raw.text, `${path}.text`) }
}

function fact(value: unknown, path: string): FactV1 {
  const raw = record(value, path, FACT_KEYS)
  const out: Mutable<FactV1> = { kind: oneOf(raw.kind, `${path}.kind`, OBSERVATION_FACTS) }
  assign(out, 'from', optional(raw, 'from', path, factValue))
  assign(out, 'to', optional(raw, 'to', path, factValue))
  return out
}

function factValue(value: unknown, path: string): number | string {
  if (typeof value === 'string') return value
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, 'expected a number or a string')
  }
  return value
}

function member(value: unknown, path: string): MemberV1 {
  const raw = record(value, path, MEMBER_KEYS)
  const out: Mutable<MemberV1> = {
    screenshot: string(raw.screenshot, `${path}.screenshot`),
    locator: string(raw.locator, `${path}.locator`),
    elements: integer(raw.elements, `${path}.elements`, 1),
    effects: list(raw.effects, `${path}.effects`, effect),
  }
  assign(
    out,
    'changes',
    optional(raw, 'changes', path, (v, p) => list(v, p, memberChange))
  )
  assign(out, 'observation', optional(raw, 'observation', path, observation))
  assign(
    out,
    'box',
    optional(raw, 'box', path, (v, p) => {
      const sides = record(v, p, MEMBER_BOX_KEYS)
      const box: Mutable<NonNullable<MemberV1['box']>> = {}
      assign(box, 'before', optional(sides, 'before', p, rect))
      assign(box, 'after', optional(sides, 'after', p, rect))
      return box
    })
  )
  return out
}

function memberChange(value: unknown, path: string): MemberChangeV1 {
  const raw = record(value, path, MEMBER_CHANGE_KEYS)
  return {
    prop: string(raw.prop, `${path}.prop`),
    from: string(raw.from, `${path}.from`),
    to: string(raw.to, `${path}.to`),
  }
}

function clusterSummary(value: unknown, path: string): ClusterSummary {
  const raw = record(value, path, SUMMARY_SHAPE_KEYS)
  const kind = oneOf(raw.kind, `${path}.kind`, [
    ...STYLE_FAMILIES,
    'content',
    'rule',
    ...PLAIN_KINDS,
  ])
  if (kind === 'rule') return ruleSummary(value, path)
  for (const key of RULE_ONLY_KEYS) {
    if (raw[key] !== undefined) fail(`${path}.${key}`, 'expected no rule fields for this kind')
  }
  if (kind === 'content') {
    if (raw.changes !== undefined) fail(`${path}.changes`, 'expected no changes for this kind')
    const out: Mutable<Extract<ClusterSummary, { detail: unknown }>> = {
      kind,
      detail: oneOf(raw.detail, `${path}.detail`, CONTENT_DETAILS),
    }
    assign(out, 'from', optional(raw, 'from', path, string))
    assign(out, 'to', optional(raw, 'to', path, string))
    return out
  }
  if (raw.from !== undefined || raw.to !== undefined) fail(path, 'expected no fonts for this kind')
  if (raw.detail !== undefined) fail(`${path}.detail`, 'expected no detail for this kind')
  if (kind === 'added' || kind === 'removed' || kind === 'scrolled' || kind === 'resized') {
    if (raw.changes !== undefined) fail(`${path}.changes`, 'expected no changes for this kind')
    return { kind }
  }
  return {
    kind,
    changes: list(raw.changes, `${path}.changes`, (v, p) => {
      const change = record(v, p, CHANGE_KEYS)
      const out: Mutable<Extract<ClusterSummary, { changes: unknown }>['changes'][number]> = {
        prop: string(change.prop, `${p}.prop`),
      }
      assign(out, 'from', optional(change, 'from', p, string))
      assign(out, 'to', optional(change, 'to', p, string))
      assign(out, 'delta', optional(change, 'delta', p, string))
      return out
    }),
  }
}

function ruleSummary(value: unknown, path: string): RuleSummary {
  const raw = record(value, path, RULE_SUMMARY_KEYS)
  const out: Mutable<RuleSummary> = {
    kind: 'rule',
    selector: string(raw.selector, `${path}.selector`),
    sheet: string(raw.sheet, `${path}.sheet`),
    sets: list(raw.sets, `${path}.sets`, string),
    changed: list(raw.changed, `${path}.changed`, string),
    unsets: list(raw.unsets, `${path}.unsets`, string),
  }
  if (out.sets.length + out.changed.length + out.unsets.length === 0) {
    fail(path, 'expected a longhand in sets, changed or unsets')
  }
  assign(out, 'layer', optional(raw, 'layer', path, string))
  assign(out, 'important', optional(raw, 'important', path, literalTrue))
  assign(out, 'layerFrom', optional(raw, 'layerFrom', path, string))
  assign(out, 'layerTo', optional(raw, 'layerTo', path, string))
  assign(out, 'over', optional(raw, 'over', path, ruleRef))
  assign(
    out,
    'values',
    optional(raw, 'values', path, (v, p) => list(v, p, memberChange))
  )
  assign(
    out,
    'mixed',
    optional(raw, 'mixed', path, (v, p) =>
      list(v, p, (entry, q) => {
        const mixed = record(entry, q, MIXED_KEYS)
        return {
          prop: string(mixed.prop, `${q}.prop`),
          sets: nonNegative(mixed.sets, `${q}.sets`),
          changed: nonNegative(mixed.changed, `${q}.changed`),
          unsets: nonNegative(mixed.unsets, `${q}.unsets`),
        }
      })
    )
  )
  assign(
    out,
    'defaults',
    optional(raw, 'defaults', path, (v, p) => list(v, p, browserDefault))
  )
  assign(
    out,
    'vars',
    optional(raw, 'vars', path, (v, p) => list(v, p, varChange))
  )
  assign(
    out,
    'via',
    optional(raw, 'via', path, (v, p) => list(v, p, viaRule))
  )
  return out
}

function ruleRef(value: unknown, path: string): RuleRef {
  const raw = record(value, path, RULE_REF_KEYS)
  const out: Mutable<RuleRef> = {
    selector: string(raw.selector, `${path}.selector`),
    sheet: string(raw.sheet, `${path}.sheet`),
  }
  assign(out, 'layer', optional(raw, 'layer', path, string))
  assign(out, 'important', optional(raw, 'important', path, literalTrue))
  assign(out, 'userAgent', optional(raw, 'userAgent', path, literalTrue))
  return out
}

function browserDefault(value: unknown, path: string): { prop: string; value: string } {
  const raw = record(value, path, DEFAULT_KEYS)
  return { prop: string(raw.prop, `${path}.prop`), value: string(raw.value, `${path}.value`) }
}

function varChange(value: unknown, path: string): VarChange {
  const raw = record(value, path, VAR_KEYS)
  const out: Mutable<VarChange> = {
    name: string(raw.name, `${path}.name`),
    readBy: list(raw.readBy, `${path}.readBy`, string),
  }
  assign(out, 'from', optional(raw, 'from', path, string))
  assign(out, 'to', optional(raw, 'to', path, string))
  assign(
    out,
    'missing',
    optional(raw, 'missing', path, (v, p) => oneOf(v, p, MISSING_KINDS))
  )
  return out
}

function viaRule(value: unknown, path: string): ViaRule {
  const raw = record(value, path, VIA_KEYS)
  return {
    name: string(raw.name, `${path}.name`),
    rule: ruleRef(raw.rule, `${path}.rule`),
    readBy: list(raw.readBy, `${path}.readBy`, string),
  }
}

function effect(value: unknown, path: string): EffectV1 {
  const raw = record(value, path, EFFECT_KEYS)
  const out: Mutable<EffectV1> = {
    kind: oneOf(raw.kind, `${path}.kind`, EFFECT_KINDS),
    nodes: integer(raw.nodes, `${path}.nodes`, 1),
  }
  assign(out, 'vector', optional(raw, 'vector', path, point))
  assign(
    out,
    'vectorNodes',
    optional(raw, 'vectorNodes', path, (v, p) => integer(v, p, 1))
  )
  return out
}

function example(value: unknown, path: string): ExampleV1 {
  const raw = record(value, path, EXAMPLE_KEYS)
  const out: Mutable<ExampleV1> = {
    screenshot: string(raw.screenshot, `${path}.screenshot`),
    locator: string(raw.locator, `${path}.locator`),
  }
  assign(out, 'src', optional(raw, 'src', path, string))
  return out
}

function unexplained(value: unknown, path: string): UnexplainedV1 {
  const raw = record(value, path, UNEXPLAINED_KEYS)
  const out: Mutable<UnexplainedV1> = {
    id: string(raw.id, `${path}.id`),
    screenshot: string(raw.screenshot, `${path}.screenshot`),
    region: rect(raw.region, `${path}.region`),
    pixels: nonNegative(raw.pixels, `${path}.pixels`),
    candidates: list(raw.candidates, `${path}.candidates`, (v, p) => {
      const candidate = record(v, p, ['locator', 'share'])
      return {
        locator: string(candidate.locator, `${p}.locator`),
        share: nonNegative(candidate.share, `${p}.share`),
      }
    }),
  }
  assign(out, 'note', optional(raw, 'note', path, string))
  return out
}

function checkRelations(report: ReportDraft): void {
  const screenshots = new Set(report.screenshots.map((s) => s.id))
  const causes = new Set(report.causes.map((c) => c.id))
  const unexplained = new Set(report.unexplained.map((u) => u.id))
  if (screenshots.size !== report.screenshots.length) fail('$.screenshots', 'expected unique ids')
  if (causes.size !== report.causes.length) fail('$.causes', 'expected unique ids')
  if (unexplained.size !== report.unexplained.length) fail('$.unexplained', 'expected unique ids')
  const known = (set: ReadonlySet<string>, ids: readonly string[], path: string): void => {
    ids.forEach((id, index) => {
      if (!set.has(id)) fail(`${path}[${String(index)}]`, `unknown id ${id}`)
    })
  }
  report.screenshots.forEach((s, index) => {
    known(causes, s.causes, `$.screenshots[${String(index)}].causes`)
    known(unexplained, s.unexplained, `$.screenshots[${String(index)}].unexplained`)
  })
  report.causes.forEach((c, index) => {
    known(screenshots, [c.example.screenshot], `$.causes[${String(index)}].example.screenshot`)
    known(
      screenshots,
      c.members.map((m) => m.screenshot),
      `$.causes[${String(index)}].members`
    )
  })
  report.unexplained.forEach((u, index) => {
    known(screenshots, [u.screenshot], `$.unexplained[${String(index)}].screenshot`)
  })
  const { summary } = report
  if (summary.screenshots.compared !== report.screenshots.length)
    fail('$.summary.screenshots.compared', 'does not match the screenshot list')
  if (summary.causes !== report.causes.length)
    fail('$.summary.causes', 'does not match the cause list')
  if (summary.unexplained !== report.unexplained.length)
    fail('$.summary.unexplained', 'does not match the unexplained list')
}
