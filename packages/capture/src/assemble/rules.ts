import type { DeclarationV1, RuleV1 } from '@whydiff/core'

import type { MatchedStyles, RawDeclaration, RawRule, RawStyle, RuleGroup } from '../raw.js'
import type { LayerNamer } from './layers.js'
import {
  DeclarationTable,
  namesRead,
  registrations,
  resolve,
  type Levels,
  type Registration,
} from './vars.js'

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

const IMPORTANT = /(?<!\s)\s*!\s*important\s*$/i
const SIDES = /^(margin|padding|border)-(block|inline)-(start|end)(-width|-style|-color)?$/
const CORNERS = /^border-(start|end)-(start|end)-radius$/
const AXES = /^overflow-(block|inline)$/
const HORIZONTAL: readonly [string, string, string, string] = ['top', 'bottom', 'left', 'right']
// block-start, block-end, line-left and line-right per writing mode (CSS Writing Modes 4, 6.4); inline-start is line-left in ltr
const FLOW_SIDES: Readonly<Record<string, readonly [string, string, string, string]>> = {
  'horizontal-tb': HORIZONTAL,
  'vertical-rl': ['right', 'left', 'top', 'bottom'],
  'vertical-lr': ['left', 'right', 'top', 'bottom'],
  'sideways-rl': ['right', 'left', 'top', 'bottom'],
  'sideways-lr': ['left', 'right', 'bottom', 'top'],
}

/** The element's own computed writing mode and direction, which map flow-relative declarations to physical sides. */
export interface Flow {
  readonly writingMode: string
  readonly direction: string
}

/** What attribution reads besides the groups, fixed for one capture. */
export interface RuleContext {
  readonly props: readonly string[]
  /** Snapshot sheet index per protocol style sheet id. */
  readonly sheetIndex: ReadonlyMap<string, number>
  readonly layerName: LayerNamer
  readonly shorthands: ReadonlyMap<string, readonly string[]>
}

/** One declaration of a style with the names it sets. */
interface Expanded {
  readonly names: readonly string[]
  readonly important: boolean
  /** As written, without `!important`; null for a longhand the browser set from a declaration capture could not expand. */
  readonly value: string | null
}

/** Where a declaration came from: a sheet rule by its place in the reported cascade order, the style attribute, presentational attributes or the browser's own sheet. */
interface Source {
  /** The rule entry without `important`; null for presentational attributes and for a sheet the snapshot does not list. */
  readonly rule: RuleV1 | null
  readonly inline: boolean
  readonly userAgent: boolean
  /** Rank of the rule's cascade layer by first appearance; unlayered rules come last. */
  readonly layer: number
}

/** One declaration as the cascade sees it. */
export interface Declared {
  readonly source: Source
  /** The rule entry it is attributed to, marked important when it is; null for no listed rule. */
  readonly rule: RuleV1 | null
  readonly important: boolean
  /** Position in the reported order, presentational attributes first, then the rules, then the style attribute. */
  readonly position: number
  /** As written, without `!important`; null for a longhand the browser set from a declaration capture could not expand. */
  readonly value: string | null
}

/** Rule entries, attribution rows and the declarations their `uses` rows point at, deduplicated in first-use order. */
export class RuleTable {
  readonly rules: RuleV1[] = []
  readonly rows: number[][] = []
  readonly uses: number[][] = []
  readonly declarations: DeclarationTable = new DeclarationTable()
  private readonly ruleIndex = new Map<string, number>()
  private readonly rowIndex = new Map<string, number>()

  rule(entry: RuleV1): number {
    const key = ruleKey(entry)
    let index = this.ruleIndex.get(key)
    if (index === undefined) {
      index = this.rules.length
      this.ruleIndex.set(key, index)
      this.rules.push(entry)
    }
    return index
  }

  row(entries: readonly number[], uses: readonly number[]): number {
    const key = `${entries.join(',')}|${uses.join(',')}`
    let index = this.rowIndex.get(key)
    if (index === undefined) {
      index = this.rows.length
      this.rowIndex.set(key, index)
      this.rows.push([...entries])
      this.uses.push([...uses])
    }
    return index
  }
}

/** Attribution row per node index of one document; the nodes of a group share their representative's row. */
export function attributeDocument(
  groups: readonly RuleGroup[],
  table: RuleTable,
  context: RuleContext,
  flowOf: (node: number) => Flow
): ReadonlyMap<number, number> {
  const rowOf = new Map<number, number>()
  const registered = registrations(
    groups.map((group) => group.matched),
    context.sheetIndex
  )
  for (const group of groups) {
    const flow = flowOf(group.nodes[0] ?? -1)
    const row = attributeGroup(group.matched, flow, registered, table, context)
    for (const node of group.nodes) rowOf.set(node, row)
  }
  return rowOf
}

function attributeGroup(
  matched: MatchedStyles,
  flow: Flow,
  registered: ReadonlyMap<string, Registration>,
  table: RuleTable,
  context: RuleContext
): number {
  const wanted = new Set(context.props)
  const own = cascade(
    sources(matched, context),
    (name) => wanted.has(name) || isCustom(name),
    flow,
    context.shorthands
  )
  const winners = context.props.map((prop) => own.get(prop))
  const row = winners.map((winner) =>
    winner?.rule == null || winner.source.userAgent ? -1 : table.rule(winner.rule)
  )
  const inherited = matched.inherited ?? []
  const levels: Levels = (level) => {
    if (level === 0) return own
    const ancestor = inherited[level - 1]
    return ancestor === undefined
      ? null
      : cascade(sources(ancestor, context), isCustom, flow, context.shorthands)
  }
  const resolution = { levels: memoize(levels), registrations: registered, rules: table }
  const uses: number[] = []
  winners.forEach((winner, column) => {
    if (winner === undefined) return
    const prop = context.props[column] ?? ''
    const value = winner.value ?? ''
    if (winner.source.userAgent) {
      const entry: Mutable<DeclarationV1> = { prop }
      if (winner.rule !== null) entry.rule = table.rule(winner.rule)
      if (value !== '') entry.value = value
      uses.push(table.declarations.entry(entry))
      return
    }
    const rule = row[column] ?? -1
    const names = rule < 0 ? [] : namesRead(value)
    if (names.length === 0) return
    const reads = names.map((name) => resolve(name, 0, [], resolution))
    uses.push(table.declarations.entry({ prop, rule, value, reads }))
  })
  return table.row(row, uses)
}

function memoize(levels: Levels): Levels {
  const known: (ReturnType<Levels> | undefined)[] = []
  return (level) => {
    let winners = known[level]
    if (winners === undefined) {
      winners = levels(level)
      known[level] = winners
    }
    return winners
  }
}

/** The styles of one element or ancestor with where each came from, in the reported order. */
function sources(
  matched: Pick<MatchedStyles, 'inlineStyle' | 'attributesStyle' | 'matchedCSSRules'>,
  context: RuleContext
): { readonly style: RawStyle; readonly source: Source }[] {
  const out: { style: RawStyle; source: Source }[] = []
  const author = { inline: false, userAgent: false, layer: 0 }
  if (matched.attributesStyle !== undefined) {
    out.push({ style: matched.attributesStyle, source: { ...author, rule: null } })
  }
  const layers = new Map<string, number>()
  for (const { rule } of matched.matchedCSSRules ?? []) {
    if (rule.origin === 'user-agent') {
      const entry: RuleV1 = { userAgent: true, selector: rule.selectorList.text }
      out.push({ style: rule.style, source: { ...author, rule: entry, userAgent: true } })
      continue
    }
    if (rule.origin !== 'regular') continue
    const path = rule.layers ?? []
    const layer = path.map(context.layerName).join('.')
    // anonymous layers of two sheets can share a name; the sheets that declare them tell them apart
    const key = [layer, ...path.filter((l) => l.text === '').map((l) => l.styleSheetId)].join('|')
    let rank = layers.get(key)
    if (rank === undefined) {
      rank = layers.size
      layers.set(key, rank)
    }
    const entry = sheetRule(rule, context.sheetIndex, layer)
    out.push({ style: rule.style, source: { ...author, rule: entry, layer: rank } })
  }
  if (matched.inlineStyle !== undefined) {
    const entry: RuleV1 = { inline: true, selector: '' }
    out.push({ style: matched.inlineStyle, source: { ...author, rule: entry, inline: true } })
  }
  return out
}

/** The winning declaration of each wanted name, flow-relative names mapped to their physical twins first. */
function cascade(
  styles: readonly { readonly style: RawStyle; readonly source: Source }[],
  wanted: (name: string) => boolean,
  flow: Flow,
  shorthands: ReadonlyMap<string, readonly string[]>
): Map<string, Declared> {
  const best = new Map<string, Declared>()
  let position = 0
  for (const { style, source } of styles) {
    for (const { names, important, value } of declarations(style, shorthands)) {
      const rule: RuleV1 | null =
        source.rule === null || !important ? source.rule : { ...source.rule, important: true }
      const candidate: Declared = { source, rule, important, position: position++, value }
      for (const name of names.map((n) => physical(n, flow))) {
        if (!wanted(name)) continue
        const current = best.get(name)
        if (current === undefined || beats(candidate, current)) best.set(name, candidate)
      }
    }
  }
  return best
}

/** The declarations of a style in order with the names each sets: the entries as written, then the browser's longhands that none of them accounts for, without text; a style the source does not cover keeps every entry. */
function declarations(
  style: RawStyle,
  shorthands: ReadonlyMap<string, readonly string[]>
): Expanded[] {
  const written = style.cssProperties.some((d) => d.source === true)
  const out: Expanded[] = []
  const covered = new Set<string>()
  for (const declaration of style.cssProperties) {
    if (written && declaration.source !== true) continue
    if (declaration.disabled === true || declaration.parsedOk === false) continue
    const longhands =
      declaration.longhandProperties?.map((l) => l.name) ?? shorthands.get(declaration.name) ?? []
    const names = [declaration.name, ...longhands]
    for (const name of names) covered.add(name)
    out.push({ names, ...text(declaration) })
  }
  if (!written) return out
  for (const declaration of style.cssProperties) {
    if (declaration.source === true || covered.has(declaration.name)) continue
    out.push({ names: [declaration.name], important: declaration.important === true, value: null })
  }
  return out
}

/** Importance from the flag or a trailing `!important`, which the browser keeps in the value of every source entry and flags only for regular properties. */
function text(declaration: RawDeclaration): { important: boolean; value: string } {
  const suffix = IMPORTANT.exec(declaration.value)
  return {
    important: declaration.important === true || suffix !== null,
    value: (suffix === null ? declaration.value : declaration.value.slice(0, suffix.index)).trim(),
  }
}

/** The physical twin of a flow-relative longhand for the element's writing mode and direction; any other name unchanged. */
export function physical(name: string, flow: Flow): string {
  const [blockStart, blockEnd, lineLeft, lineRight] = FLOW_SIDES[flow.writingMode] ?? HORIZONTAL
  const rtl = flow.direction === 'rtl'
  const side = (axis: string, edge: string): string => {
    if (axis === 'block') return edge === 'start' ? blockStart : blockEnd
    return (edge === 'start') !== rtl ? lineLeft : lineRight
  }
  const sides = SIDES.exec(name)
  if (sides !== null) {
    const [, box = '', axis = '', edge = '', part = ''] = sides
    return `${box}-${side(axis, edge)}${part}`
  }
  const corner = CORNERS.exec(name)
  if (corner !== null) {
    const block = side('block', corner[1] ?? '')
    const inline = side('inline', corner[2] ?? '')
    const [vertical, horizontal] =
      block === 'top' || block === 'bottom' ? [block, inline] : [inline, block]
    return `border-${vertical}-${horizontal}-radius`
  }
  const axis = AXES.exec(name)?.[1]
  if (axis === undefined) return name
  return (axis === 'inline') === (blockStart === 'top') ? 'overflow-x' : 'overflow-y'
}

function beats(a: Declared, b: Declared): boolean {
  const tier = tierOf(a) - tierOf(b)
  if (tier !== 0) return tier > 0
  if (a.source.inline !== b.source.inline) return a.source.inline
  if (a.important && !a.source.inline && a.source.layer !== b.source.layer) {
    return a.source.layer < b.source.layer
  }
  return a.position > b.position
}

// origin and importance, lowest first: the browser's normal, author normal, author important, the browser's important (CSS Cascade 5, 6.1)
function tierOf({ source, important }: Declared): number {
  if (source.userAgent) return important ? 3 : 0
  return important ? 2 : 1
}

function isCustom(name: string): boolean {
  return name.startsWith('--')
}

/** Content identity of a rule entry; indices differ between captures, this does not. */
function ruleKey(entry: RuleV1): string {
  const kind =
    entry.inline === true ? 'inline' : entry.userAgent === true ? 'user-agent' : String(entry.sheet)
  return [kind, entry.selector, entry.layer ?? '', entry.important === true ? '!' : ''].join('|')
}

function sheetRule(
  rule: RawRule,
  sheetIndex: ReadonlyMap<string, number>,
  layer: string
): RuleV1 | null {
  const sheet = rule.styleSheetId === undefined ? undefined : sheetIndex.get(rule.styleSheetId)
  if (sheet === undefined) return null
  const entry: Mutable<RuleV1> = { sheet, selector: rule.selectorList.text }
  if (layer !== '') entry.layer = layer
  return entry
}
