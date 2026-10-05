import { INHERITED_PROPS, UTILITY_MAX_LONGHANDS, UTILITY_PREFIX_MIN_NAMES } from '../constants.js'
import { normalizeClasses } from '../match/classes.js'
import { selectorList, selectorSubject, type SelectorSubject } from '../snapshot/selectors.js'
import type { NodeV1, SnapshotV1 } from '../snapshot/types.js'

/** What one snapshot shows about its class names: those that name a component, and among them the BEM blocks and elements. */
export interface ClassContext {
  readonly names: ReadonlySet<string>
  readonly blocks: ReadonlySet<string>
}

interface Context extends ClassContext {
  /** Modifiers nothing extends and, with rules recorded, classes its selectors use only next to another class. */
  readonly states: ReadonlySet<string>
  /** Per rule of the snapshot, the classes of the compounds its selectors style; empty without attributions. */
  readonly subjects: readonly (readonly string[])[]
}

type Evidence = 'block' | 'styled' | 'utility' | 'unknown'

// What only utility syntax writes into a class: variants, arbitrary values, fractions, decimals, important markers, breakpoints, a negative value's leading hyphen.
const VALUE_SYNTAX = /[:[\]()/.!@%]|^-/
// Margin and padding utilities share one shape across utility systems: m or p, a side, a hyphen, a step, auto or a negative step.
const SPACING = /^[mp][abtrlxyse]?-(?:\d|auto$|n\d)/
// A BEM element's suffix is lowercase words; a CSS Modules hash after `__` has a capital or a digit.
const BEM_ELEMENT = /$(?<=__[a-z][a-z_-]*)/
const SEPARATORS = ['--', '__'] as const
const NAMESPACE = /^([^-_]+)-/
const DIGIT = /\d/
const TEST_ID_INDEX = /([-_]\d+|\[\d+\]|(?<!\d)\d+)$/
// Everything from a class's first hyphen or underscore on; what is left is a library's namespace or a BEM block's own name.
const AFTER_PREFIX = /[-_].*/

const contexts = new WeakMap<SnapshotV1, Context>()

/** What a cause on `node` is grouped by: its test id stem; else the BEM block of a class naming it, the one whose prefix holds the most BEM names on the page; else its tag and classes, states left out and, with rules recorded, only those setting its box other than colours, else any styling it (`td.py-2`); else its role or tag. */
export function componentKind(node: NodeV1, snapshot: SnapshotV1): string {
  if (node.testId !== undefined) {
    const stem = node.testId.replace(TEST_ID_INDEX, '')
    if (stem !== '') return stem
  }
  const context = contextOf(snapshot)
  const own = classNames(node)
  const names = own.filter((name) => context.names.has(name))
  const [name] = names.sort(byPrefix(context.blocks))
  if (name !== undefined) {
    const element = name.indexOf('__')
    return element > 0 ? name.slice(0, element) : name
  }
  const kept = classList(node, own, snapshot, context)
  return kept.length === 0 ? (node.role ?? node.tag) : [node.tag, ...kept].join('.')
}

/** The class that names a node's component, blocks before other names, then without digits, shortest, alphabetical; undefined when no class names one. */
export function blockClass(node: NodeV1, classes: ClassContext): string | undefined {
  const rank = (name: string): number => Number(!classes.blocks.has(name))
  const [block] = classNames(node)
    .filter((name) => classes.names.has(name))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        Number(DIGIT.test(a)) - Number(DIGIT.test(b)) ||
        a.length - b.length ||
        (a < b ? -1 : a > b ? 1 : 0)
    )
  return block
}

/** Which class names of a snapshot name a component, decided once per snapshot from how its rules style them and how its elements combine them. */
export function classContext(snapshot: SnapshotV1): ClassContext {
  return contextOf(snapshot)
}

function contextOf(snapshot: SnapshotV1): Context {
  const known = contexts.get(snapshot)
  if (known !== undefined) return known
  const all = new Set(snapshot.nodes.flatMap(classNames))
  const blocks = blockNames(all)
  const evidence = new Map<string, Evidence>()
  const states = new Set<string>()
  for (const name of all) {
    const modifier = name.includes('--') && !blocks.has(name)
    if (modifier) states.add(name)
    if (modifier || VALUE_SYNTAX.test(name) || SPACING.test(name)) continue
    evidence.set(name, blocks.has(name) ? 'block' : 'unknown')
  }
  // only rules that win a longhand: those that declare custom properties alone, register them or come from the browser say nothing about how a class is styled
  const won = new Set(snapshot.attributions?.flat())
  const subjects =
    snapshot.attributions === undefined
      ? []
      : (snapshot.rules ?? []).map((rule, index) =>
          won.has(index) ? selectorList(rule.selector).map(selectorSubject) : []
        )
  if (snapshot.rules !== undefined && snapshot.attributions !== undefined) {
    ruleEvidence(snapshot, subjects, evidence)
    for (const name of pairedOnly(subjects)) states.add(name)
  } else {
    namespaceEvidence(snapshot, evidence)
  }
  const names = new Set(
    [...evidence].filter(([, said]) => said !== 'utility').map(([name]) => name)
  )
  const context = {
    names,
    blocks: new Set([...blocks].filter((name) => names.has(name))),
    states,
    subjects: subjects.map((list) => list.flatMap(({ classes }) => classes.flatMap(className))),
  }
  contexts.set(snapshot, context)
  return context
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function classList(
  node: NodeV1,
  own: readonly string[],
  snapshot: SnapshotV1,
  context: Context
): string[] {
  const kept = own.filter((name) => !context.states.has(name)).sort(compare)
  if (snapshot.attributions === undefined) return kept
  const row = node.a === undefined ? [] : (snapshot.attributions[node.a] ?? [])
  const through = (styles: (prop: string) => boolean): string[] => {
    const styled = new Set(
      row.flatMap((rule, i) =>
        styles(snapshot.props[i] ?? '') ? (context.subjects[rule] ?? []) : []
      )
    )
    return kept.filter((name) => styled.has(name))
  }
  // Colour longhands stay out of the box: one template's instances differ in them by tint and by state (an active item's background).
  const box = through((prop) => !INHERITED_PROPS.includes(prop) && !prop.endsWith('color'))
  return box.length > 0 ? box : through(() => true)
}

function byPrefix(blocks: ReadonlySet<string>): (a: string, b: string) => number {
  const held = new Map<string, number>()
  for (const block of blocks) {
    const prefix = block.replace(AFTER_PREFIX, '')
    held.set(prefix, (held.get(prefix) ?? 0) + 1)
  }
  const count = (name: string): number => held.get(name.replace(AFTER_PREFIX, '')) ?? 0
  return (a, b) =>
    count(b) - count(a) ||
    Number(DIGIT.test(a)) - Number(DIGIT.test(b)) ||
    a.length - b.length ||
    compare(a, b)
}

function classNames(node: NodeV1): string[] {
  return [...new Set((node.cls ?? []).flatMap(className))]
}

function className(name: string): string[] {
  return BEM_ELEMENT.test(name) ? [name] : normalizeClasses([name])
}

function blockNames(all: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  for (const name of all) {
    if (name.includes('__')) out.add(name)
    for (const separator of SEPARATORS) {
      const at = name.lastIndexOf(separator)
      if (at > 0) out.add(name.slice(0, at))
    }
  }
  return out
}

function ruleEvidence(
  snapshot: SnapshotV1,
  subjects: readonly (readonly SelectorSubject[])[],
  evidence: Map<string, Evidence>
): void {
  const rules = snapshot.rules ?? []
  const styled = new Set<string>()
  for (const { classes, context, typed } of subjects.flat()) {
    if (!typed && classes.every((name) => VALUE_SYNTAX.test(name))) continue
    for (const compound of context) {
      if (compound.length === 1) for (const name of compound.flatMap(className)) styled.add(name)
    }
  }
  const alone = subjects.map((list) =>
    list
      .filter((subject) => subject.classes.length === 1)
      .flatMap(({ classes, qualified }) =>
        classes.flatMap(className).map((name) => ({ name, qualified }))
      )
  )
  const own = new Map<string, Map<number, Set<number>>>()
  for (const node of snapshot.nodes) {
    const row = node.a === undefined ? undefined : snapshot.attributions?.[node.a]
    if (row === undefined) continue
    const names = new Set(classNames(node))
    row.forEach((rule, prop) => {
      for (const { name, qualified } of alone[rule] ?? []) {
        if (!names.has(name)) continue
        if (qualified) styled.add(name)
        else {
          const byRule = own.get(name) ?? new Map<number, Set<number>>()
          own.set(name, byRule.set(rule, (byRule.get(rule) ?? new Set<number>()).add(prop)))
        }
      }
    })
  }
  for (const [name, said] of evidence) {
    if (said === 'block') continue
    const sets = [...(own.get(name) ?? [])].some(
      ([rule, props]) => props.size > UTILITY_MAX_LONGHANDS && rules[rule]?.important !== true
    )
    evidence.set(name, styled.has(name) || sets ? 'styled' : 'utility')
  }
}

function pairedOnly(subjects: readonly (readonly SelectorSubject[])[]): string[] {
  const alone = new Set<string>()
  const paired = new Set<string>()
  for (const { classes, context } of subjects.flat()) {
    for (const compound of [...context, classes]) {
      for (const name of compound.flatMap(className)) {
        if (compound.length === 1) alone.add(name)
        else paired.add(name)
      }
    }
  }
  return [...paired].filter((name) => !alone.has(name))
}

function namespaceEvidence(snapshot: SnapshotV1, evidence: Map<string, Evidence>): void {
  const owned = new Set<string>()
  for (const [name, said] of evidence) {
    const space = NAMESPACE.exec(name)?.[1]
    if (said === 'block' && space !== undefined) owned.add(space)
  }
  const utility = new Set<string>()
  for (const node of snapshot.nodes) {
    const names = classNames(node).filter((name) => evidence.get(name) === 'unknown')
    const roots = new Map<string, number>()
    for (const name of names) {
      const space = NAMESPACE.exec(name)?.[1]
      if (space === undefined || names.some((other) => name.startsWith(`${other}-`))) continue
      roots.set(space, (roots.get(space) ?? 0) + 1)
    }
    for (const [space, count] of roots) {
      if (count >= UTILITY_PREFIX_MIN_NAMES && !owned.has(space)) utility.add(space)
    }
  }
  for (const [name, said] of evidence) {
    const space = NAMESPACE.exec(name)?.[1]
    if (said === 'unknown' && space !== undefined && utility.has(space)) {
      evidence.set(name, 'utility')
    }
  }
}
