import { CLUSTER_LENGTH_STEP, CLUSTER_RULES_VERSION } from '../constants.js'
import { parseColor } from '../deltas/color.js'
import { normalizeValue } from '../deltas/normalize.js'
import type { RuleTables } from '../deltas/rules.js'
import type { StyleChange } from '../deltas/types.js'
import { ruleSheet } from '../snapshot/sheets.js'
import type { DeclarationV1, SnapshotV1 } from '../snapshot/types.js'
import type {
  ClusterSummary,
  ContentDetail,
  LonghandValues,
  RuleRef,
  StyleFamily,
  VarChange,
  ViaRule,
} from './types.js'
import {
  ancestral,
  culpritsOf,
  missingOf,
  providerKey,
  readsFromOthers,
  type Culprit,
} from './vars.js'

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/** A summary of a cause that is not about styles, nor about the rule that wins. */
export type PlainSummary = Exclude<ClusterSummary, { changes: unknown } | { kind: 'rule' }>

const PX = /^-?\d+(\.\d+)?px$|^0$/
const NUMBER = /^-?\d+(\.\d+)?$/

/** The three keys of one cause, most specific first, and the summary each one stands for. */
export interface KeySet {
  readonly keys: readonly [string, string, string]
  readonly summaries: readonly [ClusterSummary, ClusterSummary, ClusterSummary]
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function prefix(kind: string, family: string): string {
  return `${CLUSTER_RULES_VERSION}|${kind}|${family}|`
}

/** Keys of a style, container or paint-order cause from its non-derived changes. */
export function styleKeys(
  kind: string,
  family: StyleFamily,
  changes: readonly StyleChange[]
): KeySet {
  const normalized = changes
    .map((c) => ({
      prop: c.prop,
      from: normalizeValue(c.prop, c.from),
      to: normalizeValue(c.prop, c.to),
    }))
    .sort((a, b) => compare(a.prop, b.prop))
  const head = prefix(kind, family)
  const exact = normalized.map((c) => `${c.prop}=${c.from}>${c.to}`)
  const params = normalized.map((c) => `${c.prop}:${parameter(c.from, c.to)}`)
  const props = normalized.map((c) => c.prop)
  return {
    keys: [head + exact.join(';'), head + params.join(';'), head + props.join(';')],
    summaries: [
      { kind: family, changes: normalized.map((c) => ({ prop: c.prop, from: c.from, to: c.to })) },
      {
        kind: family,
        changes: normalized.map((c) => ({ prop: c.prop, delta: parameter(c.from, c.to) })),
      },
      { kind: family, changes: props.map((prop) => ({ prop })) },
    ],
  }
}

/** A level-0 key of a cause: one rule its changed longhands point at, and what it stands for. */
export interface RuleCandidate {
  readonly key: string
  /** The rule as the after side names it, or the before side when it is gone. */
  readonly rule: RuleRef
  /** Whether `rule` was read on the after side. */
  readonly after: boolean
  /** Sorted changed longhands and custom properties per kind of change under this key. */
  readonly sets: readonly string[]
  readonly changed: readonly string[]
  readonly unsets: readonly string[]
  /** Content key of the rule all `sets` entries lost to; null when they lost to different rules or to none. */
  readonly loser: string | null
  readonly loserRef: RuleRef | null
  /** Layer of the rule before and after, absent when unlayered; null unless the rule was met on both sides. */
  readonly layers: { readonly from?: string; readonly to?: string } | null
  /** The custom properties under this key as this cause saw them, sorted by name. */
  readonly vars: readonly VarChange[]
  /** Custom properties the rule's own changed longhands read from another author rule, with that rule's content key, sorted by name and key. */
  readonly via: readonly (ViaRule & { readonly key: string })[]
  /** The browser's value of each `sets` longhand that the browser's rule won before, sorted by longhand. */
  readonly defaults: readonly { readonly prop: string; readonly value: string }[]
  /** Computed values before and after of the longhands under this key, sorted by longhand. */
  readonly values: readonly LonghandValues[]
}

interface RuleBucket {
  readonly sets: string[]
  readonly changed: string[]
  readonly unsets: string[]
  /** The first before-side and after-side index of the rule met. */
  before: number | null
  after: number | null
  /** Before-side rule index per `sets` entry. */
  readonly lost: Set<number | null>
  /** Set when the rule is the style attribute of an ancestor that a custom property came from. */
  ancestor: boolean
  readonly vars: Map<string, BucketVar>
  /** Keyed by the name and the content key of the rule that declares it. */
  readonly via: Map<string, BucketVia>
  readonly defaults: Map<string, string>
  readonly values: LonghandValues[]
}

interface BucketVar {
  readonly from: string | undefined
  readonly to: string | undefined
  readonly readBy: string[]
  readonly missing: ('fallback' | 'invalid' | undefined)[]
}

interface BucketVia {
  readonly name: string
  readonly key: string
  readonly rule: number
  readonly ancestor: boolean
  readonly readBy: string[]
}

/** Rule candidates of the non-derived changes of a pair, one per rule they point at on either side, most entries first, then by key. A longhand whose winning rule and declaration text stayed the same goes to the rules that changed the custom properties it reads, when any did. */
export function ruleCandidates(
  before: SnapshotV1,
  after: SnapshotV1,
  tables: RuleTables,
  changes: readonly StyleChange[]
): RuleCandidate[] {
  const buckets = new Map<string, RuleBucket>()
  const bucketOf = (identity: string): RuleBucket => {
    const bucket = buckets.get(identity) ?? {
      sets: [],
      changed: [],
      unsets: [],
      before: null,
      after: null,
      lost: new Set(),
      ancestor: false,
      vars: new Map(),
      via: new Map(),
      defaults: new Map(),
      values: [],
    }
    buckets.set(identity, bucket)
    return bucket
  }
  for (const change of changes) {
    const from = change.rule?.from ?? null
    const to = change.rule?.to ?? null
    const fromKey = from === null ? null : (tables.before.keys[from] ?? null)
    if (to !== null) {
      const toKey = tables.after.keys[to]
      if (toKey === undefined) continue
      if (fromKey === toKey && placeCulprits(before, after, tables, bucketOf, change)) continue
      const bucket = bucketOf(toKey)
      bucket.after ??= to
      bucket.values.push({ prop: change.prop, from: change.from, to: change.to })
      if (fromKey === toKey) {
        bucket.changed.push(change.prop)
        bucket.before ??= from
      } else {
        const browser = from === null ? browserDefault(before, change) : null
        bucket.sets.push(change.prop)
        bucket.lost.add(from ?? browser?.rule ?? null)
        if (browser !== null) bucket.defaults.set(change.prop, browser.value)
      }
      addVia(bucket, readsFromOthers(after, tables, change, toKey), after, tables, change.prop)
    } else if (from !== null && fromKey !== null) {
      const bucket = bucketOf(fromKey)
      bucket.before ??= from
      bucket.unsets.push(change.prop)
      bucket.values.push({ prop: change.prop, from: change.from, to: change.to })
    }
  }
  const size = (b: RuleBucket): number => b.sets.length + b.changed.length + b.unsets.length
  return [...buckets.entries()]
    .sort((a, b) => size(b[1]) - size(a[1]) || compare(a[0], b[0]))
    .flatMap(([identity, bucket]) => {
      const candidate = candidateOf(before, after, tables, identity, bucket)
      return candidate === null ? [] : [candidate]
    })
}

/** Puts each custom property behind a change into the bucket of the rule that declares it now, else of the one that declared it before; false when none of them has a rule on either side. */
function placeCulprits(
  before: SnapshotV1,
  after: SnapshotV1,
  tables: RuleTables,
  bucketOf: (identity: string) => RuleBucket,
  change: StyleChange
): boolean {
  let placed = false
  for (const culprit of culpritsOf(before, after, tables, change)) {
    const now = providerKey(tables.after, after, culprit.after)
    const was = providerKey(tables.before, before, culprit.before)
    const identity = now ?? was
    if (identity === null) continue
    const bucket = bucketOf(identity)
    if (now === null) {
      bucket.before ??= culprit.before?.rule ?? null
      bucket.ancestor ||= ancestral(before, culprit.before)
      bucket.unsets.push(culprit.name)
    } else {
      bucket.after ??= culprit.after?.rule ?? null
      bucket.ancestor ||= ancestral(after, culprit.after)
      if (was === now) {
        bucket.before ??= culprit.before?.rule ?? null
        bucket.changed.push(culprit.name)
      } else {
        bucket.sets.push(culprit.name)
        bucket.lost.add(culprit.before?.rule ?? null)
      }
    }
    recordVar(bucket, culprit, change.prop)
    placed = true
  }
  return placed
}

function recordVar(bucket: RuleBucket, culprit: Culprit, prop: string): void {
  const seen = bucket.vars.get(culprit.name) ?? {
    from: culprit.before?.value,
    to: culprit.after?.value,
    readBy: [],
    missing: [],
  }
  seen.readBy.push(prop)
  seen.missing.push(missingOf(culprit))
  bucket.vars.set(culprit.name, seen)
}

/** The browser's own declaration that won the longhand before, when the before side lists one. */
function browserDefault(
  before: SnapshotV1,
  change: StyleChange
): { readonly rule: number; readonly value: string } | null {
  const index = change.declaration?.from ?? null
  const entry = index === null ? undefined : before.declarations?.[index]
  if (entry?.rule === undefined || entry.value === undefined) return null
  return before.rules?.[entry.rule]?.userAgent === true
    ? { rule: entry.rule, value: entry.value }
    : null
}

function addVia(
  bucket: RuleBucket,
  reads: readonly DeclarationV1[],
  after: SnapshotV1,
  tables: RuleTables,
  prop: string
): void {
  for (const entry of reads) {
    const key = providerKey(tables.after, after, entry)
    if (key === null || entry.rule === undefined) continue
    const id = `${entry.prop}|${key}`
    const via = bucket.via.get(id) ?? {
      name: entry.prop,
      key,
      rule: entry.rule,
      ancestor: ancestral(after, entry),
      readBy: [],
    }
    via.readBy.push(prop)
    bucket.via.set(id, via)
  }
}

function candidateOf(
  before: SnapshotV1,
  after: SnapshotV1,
  tables: RuleTables,
  identity: string,
  bucket: RuleBucket
): RuleCandidate | null {
  const b = bucket.before ?? tables.before.first.get(identity) ?? null
  const a = bucket.after ?? tables.after.first.get(identity) ?? null
  const rule =
    a !== null
      ? providerRef(after, a, bucket.ancestor)
      : b !== null
        ? providerRef(before, b, bucket.ancestor)
        : null
  if (rule === null) return null
  const [from = null] = bucket.lost.size === 1 ? bucket.lost : []
  return {
    key: `${CLUSTER_RULES_VERSION}|rule|${identity}`,
    rule,
    after: a !== null,
    sets: unique(bucket.sets),
    changed: unique(bucket.changed),
    unsets: unique(bucket.unsets),
    loser: from === null ? null : (tables.before.keys[from] ?? null),
    loserRef: from === null ? null : ruleRef(before, from),
    layers: layersOf(before, b, after, a),
    vars: [...bucket.vars.entries()]
      .sort((x, y) => compare(x[0], y[0]))
      .map(([name, seen]) => varOf(name, seen)),
    via: [...bucket.via.values()]
      .sort((x, y) => compare(x.name, y.name) || compare(x.key, y.key))
      .flatMap(({ name, key, rule: index, ancestor, readBy }) => {
        const ref = providerRef(after, index, ancestor)
        return ref === null ? [] : [{ name, key, rule: ref, readBy: unique(readBy) }]
      }),
    defaults: [...bucket.defaults.entries()]
      .sort((x, y) => compare(x[0], y[0]))
      .map(([prop, value]) => ({ prop, value })),
    values: [...bucket.values].sort((x, y) => compare(x.prop, y.prop)),
  }
}

function varOf(name: string, seen: BucketVar): VarChange {
  const out: Mutable<VarChange> = { name, readBy: unique(seen.readBy) }
  if (seen.from !== undefined) out.from = seen.from
  if (seen.to !== undefined) out.to = seen.to
  const [missing] = seen.missing
  if (missing !== undefined && seen.missing.every((m) => m === missing)) out.missing = missing
  return out
}

function unique(list: readonly string[]): string[] {
  return [...new Set(list)].sort(compare)
}

function providerRef(snapshot: SnapshotV1, index: number, ancestor: boolean): RuleRef | null {
  const ref = ruleRef(snapshot, index)
  return ref === null || !ancestor ? ref : { ...ref, sheet: 'style attribute of an ancestor' }
}

function layersOf(
  before: SnapshotV1,
  b: number | null,
  after: SnapshotV1,
  a: number | null
): RuleCandidate['layers'] {
  if (b === null || a === null) return null
  const from = before.rules?.[b]?.layer
  const to = after.rules?.[a]?.layer
  return { ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) }
}

/** A rule of the snapshot as the report names it; null for an index outside `rules`. */
export function ruleRef(snapshot: SnapshotV1, index: number): RuleRef | null {
  const rule = snapshot.rules?.[index]
  if (rule === undefined) return null
  const out: Mutable<RuleRef> = {
    selector: rule.selector,
    sheet:
      rule.inline === true
        ? 'style attribute'
        : rule.userAgent === true
          ? 'user agent stylesheet'
          : ruleSheet(snapshot, index),
  }
  if (rule.layer !== undefined) out.layer = rule.layer
  if (rule.important === true) out.important = true
  if (rule.userAgent === true) out.userAgent = true
  return out
}

/** Keys of a cause that is not about styles; one level in effect. */
export function plainKeys(kind: string, summary: PlainSummary): KeySet {
  const family = summary.kind === 'content' ? `content:${summary.detail}` : summary.kind
  const fonts =
    summary.kind === 'content' && summary.from !== undefined && summary.to !== undefined
      ? `|${summary.from}>${summary.to}`
      : ''
  const key = prefix(kind, family).slice(0, -1) + fonts
  return { keys: [key, key, key], summaries: [summary, summary, summary] }
}

/** The content detail a cause kind stands for, or undefined for other kinds. */
export function contentDetail(kind: string): ContentDetail | undefined {
  if (kind === 'content:text') return 'text'
  if (kind === 'content:wrap') return 'wrap'
  if (kind === 'content:font-metrics') return 'font-metrics'
  return undefined
}

/** How a value changed, without the values: a length delta, a number delta, a colour, or the keyword pair. */
export function parameter(from: string, to: string): string {
  if (PX.test(from) && PX.test(to))
    return `<len ${signed(step(Number.parseFloat(to) - Number.parseFloat(from)))}px>`
  if (NUMBER.test(from) && NUMBER.test(to))
    return `<num ${signed(step(Number.parseFloat(to) - Number.parseFloat(from)))}>`
  if (parseColor(from) !== null && parseColor(to) !== null) return '<color>'
  return `<kw ${from}>${to}>`
}

function step(delta: number): number {
  return Math.round(delta / CLUSTER_LENGTH_STEP) * CLUSTER_LENGTH_STEP
}

function signed(value: number): string {
  return value > 0 ? `+${String(value)}` : String(value)
}
