import type { RuleTable, RuleTables } from '../deltas/rules.js'
import type { StyleChange } from '../deltas/types.js'
import type { DeclarationV1, SnapshotV1 } from '../snapshot/types.js'

/** A custom property behind a changed longhand whose provider, value or registration changed, with each side's entry and the value of the declaration that read it there. */
export interface Culprit {
  readonly name: string
  readonly before: DeclarationV1 | undefined
  readonly after: DeclarationV1 | undefined
  readonly readers: readonly [before: string | undefined, after: string | undefined]
}

const SPACES = /\s+/g
const SPECIAL = /[.*+?^${}()|[\]\\]/g

/** The custom properties behind a longhand whose winning declaration kept its text, compared by name down both chains in the before side's reading order: those that differ in provider, value or registration; empty when the declaration itself changed or a side lists none. */
export function culpritsOf(
  before: SnapshotV1,
  after: SnapshotV1,
  tables: RuleTables,
  change: StyleChange
): Culprit[] {
  const consumer = entryAt(before, change.declaration?.from)
  const twin = entryAt(after, change.declaration?.to)
  if (consumer === undefined || twin === undefined) return []
  if (collapsed(consumer.value) !== collapsed(twin.value)) return []
  const found: Culprit[] = []
  const visit = (x: DeclarationV1, y: DeclarationV1): void => {
    for (const name of namesRead(before, x, after, y)) {
      if (found.some((culprit) => culprit.name === name)) continue
      const p = readOf(before, x, name)
      const q = readOf(after, y, name)
      if (p !== undefined && q !== undefined && sameEntry(tables, before, p, after, q)) visit(p, q)
      else found.push({ name, before: p, after: q, readers: [x.value, y.value] })
    }
  }
  visit(consumer, twin)
  return found
}

/** The identity of the rule that gave an entry its value, the style attribute of an ancestor apart from the element's own; null without a rule. */
export function providerKey(
  table: RuleTable,
  snapshot: SnapshotV1,
  entry: DeclarationV1 | undefined
): string | null {
  if (entry?.rule === undefined) return null
  const key = table.keys[entry.rule]
  if (key === undefined) return null
  return ancestral(snapshot, entry) ? `${key}|ancestor` : key
}

/** Whether an entry comes from the style attribute of an ancestor. */
export function ancestral(snapshot: SnapshotV1, entry: DeclarationV1 | undefined): boolean {
  return entry?.inherited === true && snapshot.rules?.[entry.rule ?? -1]?.inline === true
}

/** What the declarations reading a culprit did on the side where it had no value: used their `var()` fallback, or had none; undefined when it had a value on both sides. */
export function missingOf(culprit: Culprit): 'fallback' | 'invalid' | undefined {
  const side =
    culprit.after?.value === undefined ? 1 : culprit.before?.value === undefined ? 0 : null
  if (side === null) return undefined
  const name = culprit.name.replace(SPECIAL, '\\$&')
  const read = new RegExp(`var\\(\\s*${name}\\s*([,)])`).exec(culprit.readers[side] ?? '')
  return read?.[1] === ',' ? 'fallback' : 'invalid'
}

/** The entries an after-side declaration reads directly that another author rule declared, by name. */
export function readsFromOthers(
  after: SnapshotV1,
  tables: RuleTables,
  change: StyleChange,
  consumerKey: string
): DeclarationV1[] {
  const consumer = entryAt(after, change.declaration?.to)
  return (consumer?.reads ?? []).flatMap((index) => {
    const entry = after.declarations?.[index]
    if (entry?.rule === undefined || entry.initial === true) return []
    if (after.rules?.[entry.rule]?.userAgent === true) return []
    const key = providerKey(tables.after, after, entry)
    return key === null || key === consumerKey ? [] : [entry]
  })
}

function entryAt(
  snapshot: SnapshotV1,
  index: number | null | undefined
): DeclarationV1 | undefined {
  return index === null || index === undefined ? undefined : snapshot.declarations?.[index]
}

function namesRead(
  before: SnapshotV1,
  x: DeclarationV1,
  after: SnapshotV1,
  y: DeclarationV1
): string[] {
  const names = (snapshot: SnapshotV1, entry: DeclarationV1): string[] =>
    (entry.reads ?? []).flatMap((index) => snapshot.declarations?.[index]?.prop ?? [])
  const first = names(before, x)
  return [...first, ...names(after, y).filter((name) => !first.includes(name))]
}

function readOf(
  snapshot: SnapshotV1,
  entry: DeclarationV1,
  name: string
): DeclarationV1 | undefined {
  return (entry.reads ?? [])
    .map((index) => snapshot.declarations?.[index])
    .find((read) => read?.prop === name)
}

function sameEntry(
  tables: RuleTables,
  before: SnapshotV1,
  p: DeclarationV1,
  after: SnapshotV1,
  q: DeclarationV1
): boolean {
  return (
    providerKey(tables.before, before, p) === providerKey(tables.after, after, q) &&
    collapsed(p.value) === collapsed(q.value) &&
    (p.initial === true) === (q.initial === true)
  )
}

function collapsed(value: string | undefined): string | undefined {
  return value?.replace(SPACES, ' ').trim()
}
