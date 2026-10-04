import {
  CAUSE_KEYS,
  CHANGE_KEYS,
  COMPARED_KEYS,
  DEFAULT_KEYS,
  EFFECT_KEYS,
  ELEMENT_KEYS,
  EXAMPLE_KEYS,
  FACT_KEYS,
  LEAD_KEYS,
  MEMBER_BOX_KEYS,
  MEMBER_CHANGE_KEYS,
  MEMBER_KEYS,
  MIXED_KEYS,
  RULE_REF_KEYS,
  RULE_SUMMARY_KEYS,
  SCREENSHOT_KEYS,
  SUMMARY_KEYS,
  UNEXPLAINED_KEYS,
  VAR_KEYS,
  VIA_KEYS,
} from './shape.js'
import type { CauseV1, ObservationV1, ReportV1 } from './types.js'

/** Canonical text of a report: keys in schema order, two-space indent, final newline. */
export function serializeReport(report: ReportV1): string {
  const ordered = {
    formatVersion: report.formatVersion,
    tool: report.tool,
    compared: pick(report.compared, COMPARED_KEYS),
    summary: { ...pick(report.summary, SUMMARY_KEYS), lead: pick(report.summary.lead, LEAD_KEYS) },
    screenshots: report.screenshots.map((s) => pick(s, SCREENSHOT_KEYS)),
    causes: report.causes.map((c) => ({
      ...pick(c, CAUSE_KEYS),
      summary: summaryOf(c.summary),
      effects: c.effects.map((e) => pick(e, EFFECT_KEYS)),
      example: pick(c.example, EXAMPLE_KEYS),
      members: c.members.map((m) => ({
        ...pick(m, MEMBER_KEYS),
        effects: m.effects.map((e) => pick(e, EFFECT_KEYS)),
        ...(m.changes === undefined
          ? {}
          : { changes: m.changes.map((change) => pick(change, MEMBER_CHANGE_KEYS)) }),
        ...(m.observation === undefined ? {} : { observation: observationOf(m.observation) }),
        ...(m.box === undefined ? {} : { box: pick(m.box, MEMBER_BOX_KEYS) }),
      })),
    })),
    unexplained: report.unexplained.map((u) => pick(u, UNEXPLAINED_KEYS)),
  }
  return `${JSON.stringify(ordered, null, 2)}\n`
}

function summaryOf(summary: CauseV1['summary']): Record<string, unknown> {
  if ('changes' in summary) {
    return {
      kind: summary.kind,
      changes: summary.changes.map((change) => pick(change, CHANGE_KEYS)),
    }
  }
  if (summary.kind !== 'rule') return summary
  const out = pick(summary, RULE_SUMMARY_KEYS)
  if (summary.values !== undefined)
    out.values = summary.values.map((entry) => pick(entry, MEMBER_CHANGE_KEYS))
  if (summary.mixed !== undefined) out.mixed = summary.mixed.map((entry) => pick(entry, MIXED_KEYS))
  if (summary.over !== undefined) out.over = pick(summary.over, RULE_REF_KEYS)
  if (summary.defaults !== undefined)
    out.defaults = summary.defaults.map((entry) => pick(entry, DEFAULT_KEYS))
  if (summary.vars !== undefined) out.vars = summary.vars.map((entry) => pick(entry, VAR_KEYS))
  if (summary.via !== undefined) {
    out.via = summary.via.map((entry) => ({
      ...pick(entry, VIA_KEYS),
      rule: pick(entry.rule, RULE_REF_KEYS),
    }))
  }
  return out
}

function observationOf(observation: ObservationV1): Record<string, unknown> {
  return {
    element: pick(observation.element, ELEMENT_KEYS),
    facts: observation.facts.map((fact) => pick(fact, FACT_KEYS)),
    text: observation.text,
  }
}

function pick(value: object, keys: readonly string[]): Record<string, unknown> {
  const source = value as Record<string, unknown> // read-only access by known key names
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  return out
}
