import { CLUSTER_MIN_MEMBERS, CLUSTER_RULES_VERSION } from '../constants.js'
import type { Cause, RegionExplanation } from '../causes/types.js'
import { ruleTables, type RuleTables } from '../deltas/rules.js'
import type { PairDelta } from '../deltas/types.js'
import { componentKind } from './component.js'
import { fnv1a64 } from '../hash.js'
import {
  contentDetail,
  plainKeys,
  ruleCandidates,
  styleKeys,
  type KeySet,
  type PlainSummary,
  type RuleCandidate,
} from './keys.js'
import type {
  Cluster,
  ClusterLevel,
  ClusterMember,
  Clusters,
  ClusterSummary,
  LonghandValues,
  MixedLonghand,
  RuleSummary,
  ScreenCauses,
  StyleFamily,
  VarChange,
  ViaRule,
} from './types.js'

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

const ID_LENGTH = 6
const STYLE_FAMILIES: ReadonlyMap<Cause['kind'], StyleFamily> = new Map([
  ['own', 'style'],
  ['inherited-root', 'style'],
  ['container', 'container'],
  ['paint-order', 'paint-order'],
])

interface Keyed {
  readonly member: ClusterMember
  readonly kind: string
  readonly keySet: KeySet
  readonly rules: readonly RuleCandidate[]
}

interface Group {
  readonly level: ClusterLevel
  readonly kind: string
  /** Null at level 0, where the summary is the union of the members' rule candidates. */
  readonly summary: ClusterSummary | null
  readonly members: ClusterMember[]
  readonly rules: RuleCandidate[]
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Groups the region-touching causes of every screen: a cause with rules behind its changes joins the cluster of each of them and shares its pixels among its clusters, any other cause the most specific key level that repeats. */
export function clusterCauses(screens: readonly ScreenCauses[]): Clusters {
  const keyed: Keyed[] = []
  for (const screen of screens) {
    const tables = ruleTables(screen.before, screen.after)
    const pixels = causePixels(screen.explanation.regions)
    for (const cause of screen.explanation.causes) {
      const touched = pixels.get(cause.id)
      if (touched === undefined) continue
      keyed.push(keyOf(screen, tables, cause, touched))
    }
  }
  const groups = new Map<string, Group>()
  let pending = byRule(groups, keyed)
  for (const level of [1, 2, 3] as const) {
    const counts = new Map<string, number>()
    for (const item of pending) {
      const key = keyAt(item, level)
      if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const rest: Keyed[] = []
    for (const item of pending) {
      const key = keyAt(item, level)
      if (key !== null && (counts.get(key) ?? 0) >= CLUSTER_MIN_MEMBERS)
        add(groups, key, level, item, null)
      else rest.push(item)
    }
    pending = rest
  }
  for (const item of pending) add(groups, item.keySet.keys[0], 1, item, null)
  const joined = new Map<ClusterMember, string[]>()
  for (const [key, group] of groups) {
    for (const member of group.members) joined.set(member, [...(joined.get(member) ?? []), key])
  }
  const clusters = [...groups.entries()]
    .map(([key, group]) => {
      const members = group.members
        .map((m) => ({ ...m, pixels: shareOf(m.pixels, key, joined.get(m) ?? [key]) }))
        .sort((a, b) => (a.screen < b.screen ? -1 : a.screen > b.screen ? 1 : a.cause - b.cause))
      return {
        key,
        group,
        summary: group.summary ?? ruleSummary(group.rules),
        members,
        screens: new Set(members.map((m) => m.screen)).size,
        pixels: members.reduce((sum, m) => sum + m.pixels, 0),
      }
    })
    .sort(
      (a, b) =>
        Number(a.summary.kind === 'resized') - Number(b.summary.kind === 'resized') ||
        b.pixels - a.pixels ||
        b.screens - a.screens ||
        b.members.length - a.members.length ||
        (a.key < b.key ? -1 : 1)
    )
    .map(({ key, group, summary, members, screens, pixels }, index): Cluster => ({
      id: `c${fnv1a64(key).slice(0, ID_LENGTH)}`,
      alias: `c${String(index + 1).padStart(2, '0')}`,
      level: group.level,
      key,
      kind: group.kind,
      summary,
      members,
      screens,
      pixels,
    }))
  return { rulesVersion: CLUSTER_RULES_VERSION, clusters }
}

/** The key of a cause at level 1, 2 or 3. */
function keyAt(item: Keyed, level: Exclude<ClusterLevel, 0>): string | null {
  return item.keySet.keys[level - 1] ?? null
}

/** Level 0: a cause joins the cluster of each rule behind its changes, alone or not: the cascade names the rule, repetition adds nothing to it. Returns the causes without one for the levels below. */
function byRule(groups: Map<string, Group>, keyed: readonly Keyed[]): Keyed[] {
  const pending: Keyed[] = []
  for (const item of keyed) {
    for (const rule of item.rules) add(groups, rule.key, 0, item, rule)
    if (item.rules.length === 0) pending.push(item)
  }
  return pending
}

/** Each cause's pixels of one screen: every region split evenly among its causes, rounded once by largest remainder with ties to the lower cause id, so they add up to the pixels of the regions with a cause. */
function causePixels(regions: readonly RegionExplanation[]): Map<number, number> {
  const explained = regions.filter((r) => r.causes.length > 0)
  // a multiple of every region's cause count, so each exact share is a whole number of units
  const unit = explained.reduce((n, r) => lcm(n, BigInt(r.causes.length)), 1n)
  const exact = new Map<number, bigint>()
  let left = 0
  for (const { region, causes } of explained) {
    left += region.pixels
    const share = (BigInt(region.pixels) * unit) / BigInt(causes.length)
    for (const id of causes) exact.set(id, (exact.get(id) ?? 0n) + share)
  }
  const pixels = new Map<number, number>()
  for (const [id, share] of exact) {
    const whole = Number(share / unit)
    pixels.set(id, whole)
    left -= whole
  }
  const byRemainder = [...exact].sort(([a, x], [b, y]) => {
    const [rx, ry] = [x % unit, y % unit]
    return rx > ry ? -1 : rx < ry ? 1 : a - b
  })
  for (const [id] of byRemainder.slice(0, left)) pixels.set(id, (pixels.get(id) ?? 0) + 1)
  return pixels
}

function lcm(a: bigint, b: bigint): bigint {
  let [x, y] = [a, b]
  while (y !== 0n) [x, y] = [y, x % y]
  return (a / x) * b
}

/** A member's pixels split evenly among the clusters it belongs to, the left-over pixels one each to the first clusters by key. */
function shareOf(pixels: number, key: string, keys: readonly string[]): number {
  const index = [...keys].sort(compare).indexOf(key)
  return Math.floor(pixels / keys.length) + (index < pixels % keys.length ? 1 : 0)
}

function add(
  groups: Map<string, Group>,
  key: string,
  level: ClusterLevel,
  item: Keyed,
  rule: RuleCandidate | null
): void {
  const group = groups.get(key)
  if (group !== undefined) {
    group.members.push(item.member)
    if (rule !== null) group.rules.push(rule)
    return
  }
  groups.set(key, {
    level,
    kind: level === 0 ? 'rule' : item.kind,
    summary: level === 0 ? null : (item.keySet.summaries[level - 1] ?? null),
    members: [item.member],
    rules: rule === null ? [] : [rule],
  })
}

/** The rule the members point at, the sorted union of their longhands per kind, the layer move when every member saw the same one, and the loser when they all share one. */
function ruleSummary(candidates: readonly RuleCandidate[]): RuleSummary {
  const [first] = [...candidates].sort(
    (a, b) => Number(b.after) - Number(a.after) || compare(a.rule.layer ?? '', b.rule.layer ?? '')
  )
  if (first === undefined) throw new Error('a rule cluster has no rule candidates')
  const union = (list: (c: RuleCandidate) => readonly string[]): string[] =>
    [...new Set(candidates.flatMap(list))].sort(compare)
  const out: Mutable<RuleSummary> = {
    kind: 'rule',
    ...first.rule,
    sets: union((c) => c.sets),
    changed: union((c) => c.changed),
    unsets: union((c) => c.unsets),
    values: agreedValues(candidates),
  }
  const mixed = mixedOf(candidates, out)
  if (mixed.length > 0) out.mixed = mixed
  const { layers } = first
  if (
    layers !== null &&
    layers.from !== layers.to &&
    candidates.every(
      (c) => c.layers !== null && c.layers.from === layers.from && c.layers.to === layers.to
    )
  ) {
    if (layers.from !== undefined) out.layerFrom = layers.from
    if (layers.to !== undefined) out.layerTo = layers.to
  }
  const losing = candidates.filter((c) => c.sets.length > 0)
  const loser = losing[0]?.loser
  const over = losing[0]?.loserRef ?? null
  if (over !== null && losing.every((c) => c.loser === loser && c.loserRef?.layer === over.layer)) {
    out.over = over
    const defaults = agreed(losing.map((c) => c.defaults))
    if (over.userAgent === true && defaults.length > 0) out.defaults = defaults
  }
  const vars = varsOf(candidates)
  if (vars.length > 0) out.vars = vars
  const via = viaOf(candidates)
  if (via.length > 0) out.via = via
  return out
}

/** The entries the rule sets on some members, changed on others or no longer sets on others, with how many members each. */
function mixedOf(candidates: readonly RuleCandidate[], rule: RuleSummary): MixedLonghand[] {
  const lists = [rule.sets, rule.changed, rule.unsets]
  const props = [...new Set(lists.flat())].sort(compare)
  return props.flatMap((prop) => {
    if (lists.filter((list) => list.includes(prop)).length < 2) return []
    const members = (kind: (c: RuleCandidate) => readonly string[]): number =>
      candidates.filter((c) => kind(c).includes(prop)).length
    return [
      {
        prop,
        sets: members((c) => c.sets),
        changed: members((c) => c.changed),
        unsets: members((c) => c.unsets),
      },
    ]
  })
}

/** Each longhand's values where every member that changed it went between the same two, by longhand. */
function agreedValues(candidates: readonly RuleCandidate[]): LonghandValues[] {
  const all = candidates.flatMap((c) => c.values)
  const props = [...new Set(all.map((v) => v.prop))].sort(compare)
  return props.flatMap((prop) => {
    const seen = all.filter((v) => v.prop === prop)
    const [first] = seen
    return first !== undefined && seen.every((v) => v.from === first.from && v.to === first.to)
      ? [{ prop, from: first.from, to: first.to }]
      : []
  })
}

/** The browser's declarations every member that has one agrees on, by longhand. */
function agreed(
  lists: readonly (readonly { readonly prop: string; readonly value: string }[])[]
): { prop: string; value: string }[] {
  const all = lists.flat()
  const props = [...new Set(all.map((d) => d.prop))].sort(compare)
  return props.flatMap((prop) => {
    const values = new Set(all.filter((d) => d.prop === prop).map((d) => d.value))
    const [value] = values
    return values.size === 1 && value !== undefined ? [{ prop, value }] : []
  })
}

/** Each custom property once: values kept where every member saw the same, the longhands it reached in all, and what was missing where every member agrees. */
function varsOf(candidates: readonly RuleCandidate[]): VarChange[] {
  const all = candidates.flatMap((c) => c.vars)
  const names = [...new Set(all.map((v) => v.name))].sort(compare)
  return names.map((name) => {
    const seen = all.filter((v) => v.name === name)
    const out: Mutable<VarChange> = {
      name,
      readBy: [...new Set(seen.flatMap((v) => v.readBy))].sort(compare),
    }
    const same = <K extends 'from' | 'to' | 'missing'>(key: K): VarChange[K] | undefined => {
      const [first] = seen
      return first !== undefined && seen.every((v) => v[key] === first[key])
        ? first[key]
        : undefined
    }
    const from = same('from')
    const to = same('to')
    const missing = same('missing')
    if (from !== undefined) out.from = from
    if (to !== undefined) out.to = to
    if (missing !== undefined) out.missing = missing
    return out
  })
}

/** Each custom property and the rule it came from once, with every longhand of the members that read it. */
function viaOf(candidates: readonly RuleCandidate[]): ViaRule[] {
  const all = candidates
    .flatMap((c) => c.via)
    .sort((a, b) => compare(a.name, b.name) || compare(a.key, b.key))
  const out: (ViaRule & { readonly key: string })[] = []
  for (const via of all) {
    const last = out.at(-1)
    if (last?.name !== via.name || last.key !== via.key) out.push({ ...via, readBy: [] })
  }
  return out.map(({ name, key, rule }) => ({
    name,
    rule,
    readBy: [
      ...new Set(all.filter((v) => v.name === name && v.key === key).flatMap((v) => v.readBy)),
    ].sort(compare),
  }))
}

function keyOf(screen: ScreenCauses, tables: RuleTables, cause: Cause, pixels: number): Keyed {
  const { node } = cause
  const nodeIndex = 'added' in node ? node.added : 'removed' in node ? node.removed : node.before
  const snapshot = 'added' in node ? screen.after : screen.before
  const target = snapshot.nodes[nodeIndex]
  const family = STYLE_FAMILIES.get(cause.kind)
  const pair =
    'before' in node ? screen.deltas.pairs.find((p) => p.before === node.before) : undefined
  const changes =
    family === undefined ? [] : (pair?.style ?? []).filter((c) => c.derived === undefined)
  const kind = target === undefined ? '?' : componentKind(target, snapshot)
  const member: ClusterMember = {
    screen: screen.screen,
    cause: cause.id,
    nodes: 1 + cause.effects.reduce((sum, e) => sum + e.nodes.length, 0),
    pixels,
  }
  if (family !== undefined && changes.length > 0) {
    return {
      member,
      kind,
      keySet: styleKeys(kind, family, changes),
      rules: ruleCandidates(screen.before, screen.after, tables, changes),
    }
  }
  return {
    member,
    kind,
    keySet: plainKeys(kind, plainSummary(cause.kind, pair?.font)),
    rules: [],
  }
}

function plainSummary(kind: Cause['kind'], font: PairDelta['font']): PlainSummary {
  const detail = contentDetail(kind)
  if (detail === 'font-metrics' && font !== undefined) {
    return { kind: 'content', detail, from: font.from, to: font.to }
  }
  if (detail !== undefined) return { kind: 'content', detail }
  switch (kind) {
    case 'added':
    case 'removed':
    case 'scrolled':
      return { kind }
    default:
      return { kind: 'resized' }
  }
}
