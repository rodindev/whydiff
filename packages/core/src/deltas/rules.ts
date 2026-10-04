import { ruleSheet } from '../snapshot/sheets.js'
import type { SnapshotV1 } from '../snapshot/types.js'
import type { StyleChange } from './types.js'

/** Rule identities of one side of a pair. */
export interface RuleTable {
  /** Identity per index into `rules`. */
  readonly keys: readonly string[]
  /** First index into `rules` of each identity, so a rule met on one side is found on the other. */
  readonly first: ReadonlyMap<string, number>
}

/** Rule identities of both sides of a pair. */
export interface RuleTables {
  readonly before: RuleTable
  readonly after: RuleTable
}

/** Identity of every rule of a pair across captures: the sheet as the report names it or inline, selector, important, so an edited or rebuilt sheet and a move between layers keep it; the layer joins it when either side holds that sheet, selector and importance in more than one layer. */
export function ruleTables(before: SnapshotV1, after: SnapshotV1): RuleTables {
  const b = identities(before)
  const a = identities(after)
  const layered = new Set([...ambiguous(b), ...ambiguous(a)])
  const keys = (side: readonly Identity[]): string[] =>
    side.map(({ key, layer }) =>
      layered.has(key) ? `${key}|${layer === undefined ? 'unlayered' : `layer ${layer}`}` : key
    )
  return { before: table(keys(b)), after: table(keys(a)) }
}

interface Identity {
  readonly key: string
  readonly layer: string | undefined
}

function identities(snapshot: SnapshotV1): Identity[] {
  return (snapshot.rules ?? []).map((rule, index) => {
    const sheet =
      rule.inline === true
        ? 'inline'
        : rule.userAgent === true
          ? 'user agent'
          : ruleSheet(snapshot, index)
    return {
      key: [sheet, rule.selector, rule.important === true ? '!' : ''].join('|'),
      layer: rule.layer,
    }
  })
}

function ambiguous(side: readonly Identity[]): string[] {
  const layers = new Map<string, string | undefined>()
  const out: string[] = []
  for (const { key, layer } of side) {
    if (!layers.has(key)) layers.set(key, layer)
    else if (layers.get(key) !== layer) out.push(key)
  }
  return out
}

function table(keys: readonly string[]): RuleTable {
  const first = new Map<string, number>()
  keys.forEach((key, index) => {
    if (!first.has(key)) first.set(key, index)
  })
  return { keys, first }
}

/** Index into `rules` of the declaration that set `prop` on the node; null for -1 or a node without a row. */
export function ruleIndex(snapshot: SnapshotV1, node: number, prop: string): number | null {
  const row = snapshot.nodes[node]?.a
  const column = snapshot.props.indexOf(prop)
  const index = row === undefined || column < 0 ? undefined : snapshot.attributions?.[row]?.[column]
  return index === undefined || index < 0 ? null : index
}

/** Whether one rule, by identity, set `prop` on the pair on both sides; false without attributions. */
export function sameRule(
  tables: RuleTables,
  before: SnapshotV1,
  b: number,
  after: SnapshotV1,
  a: number,
  prop: string
): boolean {
  const from = ruleIndex(before, b, prop)
  const to = ruleIndex(after, a, prop)
  const key = from === null ? undefined : tables.before.keys[from]
  return key !== undefined && to !== null && tables.after.keys[to] === key
}

/** Index into `declarations` of the winning declaration of `prop` on the node that its `uses` row lists; null when the row lists none or the node has no row. */
function declarationIndex(snapshot: SnapshotV1, node: number, prop: string): number | null {
  const row = snapshot.nodes[node]?.a
  const uses = row === undefined ? undefined : snapshot.uses?.[row]
  const index = uses?.find((entry) => snapshot.declarations?.[entry]?.prop === prop)
  return index ?? null
}

/** The change with the rule index of each side when both snapshots carry attributions, and the declaration index of each side when both carry declarations. */
export function withRule(
  change: StyleChange,
  before: SnapshotV1,
  b: number,
  after: SnapshotV1,
  a: number
): StyleChange {
  if (before.attributions === undefined || after.attributions === undefined) return change
  const out: StyleChange = {
    ...change,
    rule: { from: ruleIndex(before, b, change.prop), to: ruleIndex(after, a, change.prop) },
  }
  if (before.declarations === undefined || after.declarations === undefined) return out
  return {
    ...out,
    declaration: {
      from: declarationIndex(before, b, change.prop),
      to: declarationIndex(after, a, change.prop),
    },
  }
}
