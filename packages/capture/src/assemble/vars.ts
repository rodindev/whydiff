import type { DeclarationV1, RuleV1 } from '@whydiff/core'

import { VAR_DEPTH_LIMIT } from '../constants.js'
import type { MatchedStyles } from '../raw.js'
import type { Declared, RuleTable } from './rules.js'

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

const VAR = /var\(\s*(--[^\s,)]+)/gi
const KEYWORDS: ReadonlySet<string> = new Set([
  'initial',
  'inherit',
  'unset',
  'revert',
  'revert-layer',
])

/** Declaration entries deduplicated by content in first-use order. */
export class DeclarationTable {
  readonly entries: DeclarationV1[] = []
  private readonly index = new Map<string, number>()

  entry(entry: DeclarationV1): number {
    const key = JSON.stringify([
      entry.prop,
      entry.rule ?? -1,
      entry.value ?? null,
      entry.initial === true,
      entry.inherited === true,
      entry.reads ?? [],
    ])
    let index = this.index.get(key)
    if (index === undefined) {
      index = this.entries.length
      this.index.set(key, index)
      this.entries.push(entry)
    }
    return index
  }
}

/** A custom property registration: an `@property` rule, or a script's with no rule. */
export interface Registration {
  readonly rule: RuleV1 | null
  readonly inherits: boolean
  readonly initial: string | null
}

/** The registered custom properties of a document by name; each answer lists only the names its element has a value for, so a registration without an initial value shows only where one is declared. */
export function registrations(
  answers: readonly MatchedStyles[],
  sheetIndex: ReadonlyMap<string, number>
): ReadonlyMap<string, Registration> {
  const out = new Map<string, Registration>()
  const rules = answers.flatMap((matched) => matched.cssPropertyRules ?? [])
  for (const { styleSheetId, propertyName, style } of rules) {
    const descriptor = (name: string): string | undefined =>
      style.cssProperties.find((declaration) => declaration.name === name)?.value
    const sheet = styleSheetId === undefined ? undefined : sheetIndex.get(styleSheetId)
    out.set(propertyName.text, {
      rule: sheet === undefined ? null : { sheet, selector: `@property ${propertyName.text}` },
      inherits: descriptor('inherits')?.trim().toLowerCase() === 'true',
      initial: descriptor('initial-value') ?? null,
    })
  }
  const scripted = answers.flatMap((matched) => matched.cssPropertyRegistrations ?? [])
  for (const { propertyName, initialValue, inherits } of scripted) {
    out.set(propertyName, { rule: null, inherits, initial: initialValue?.text ?? null })
  }
  return out
}

/** The winning custom property declarations of the element at level 0 and of its ancestors above it; null past the root. */
export type Levels = (level: number) => ReadonlyMap<string, Declared> | null

/** What resolving a chain reads, and the table its entries go to. */
export interface Resolution {
  readonly levels: Levels
  readonly registrations: ReadonlyMap<string, Registration>
  readonly rules: RuleTable
}

/** The custom properties a value reads through `var()`, in order of first appearance, each once. */
export function namesRead(value: string): string[] {
  const names = Array.from(value.matchAll(VAR), (match) => match[1] ?? '')
  return names.filter((name, index) => names.indexOf(name) === index)
}

/** The entry of custom property `name` seen from `level`, after the entries of the names it reads, which resolve from the level that declared it (substitution happens there, before inheritance); `path` holds the names between it and the longhand. */
export function resolve(
  name: string,
  level: number,
  path: readonly string[],
  resolution: Resolution
): number {
  const { rules } = resolution
  const registration = resolution.registrations.get(name)
  const found = declaring(name, level, registration?.inherits ?? true, resolution.levels)
  const entry: Mutable<DeclarationV1> = { prop: name }
  if (found === null) {
    if (registration?.rule != null) entry.rule = rules.rule(registration.rule)
    if (registration?.initial != null) {
      entry.value = registration.initial
      entry.initial = true
    }
    return rules.declarations.entry(entry)
  }
  const { declared, at } = found
  if (declared.rule !== null) entry.rule = rules.rule(declared.rule)
  if (declared.value !== null && declared.value !== '') entry.value = declared.value
  if (at > 0) entry.inherited = true
  const next = [...path, name]
  if (entry.value !== undefined && next.length < VAR_DEPTH_LIMIT) {
    // a name already on the path is a cycle, which the browser makes invalid; it is not followed
    const reads = namesRead(entry.value)
      .filter((read) => !next.includes(read))
      .map((read) => resolve(read, at, next, resolution))
    if (reads.length > 0) entry.reads = reads
  }
  return rules.declarations.entry(entry)
}

/** The declaration that gives `name` its value seen from `level` and the level it is on: the walk goes up while nothing is declared, for `inherit`, and for an inheriting property also for `unset`, `revert` and `revert-layer`; null for the initial value. */
function declaring(
  name: string,
  level: number,
  inherits: boolean,
  levels: Levels
): { readonly declared: Declared; readonly at: number } | null {
  for (let at = level; ; at++) {
    const winners = levels(at)
    if (winners === null) return null
    const declared = winners.get(name)
    const keyword = declared?.value == null ? null : keywordOf(declared.value)
    if (declared !== undefined && keyword === null) return { declared, at }
    if (keyword === 'initial' || (keyword !== 'inherit' && !inherits)) return null
  }
}

function keywordOf(value: string): string | null {
  const keyword = value.trim().toLowerCase()
  return KEYWORDS.has(keyword) ? keyword : null
}
