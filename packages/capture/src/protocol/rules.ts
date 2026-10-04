import type { CDPSession } from 'playwright-core'

import { RULE_GROUP_LIMIT } from '../constants.js'
import type {
  DocumentSnapshot,
  MatchedStyles,
  RawDeclaration,
  RawInheritedStyle,
  RawLayer,
  RawPropertyRegistration,
  RawPropertyRule,
  RawRule,
  RawStyle,
  RuleGroup,
} from '../raw.js'

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

const ELEMENT_NODE = 1
const PSEUDO_TYPES: ReadonlySet<string> = new Set(['before', 'after', 'marker'])
const WHITESPACE = /\s+/
const ORIGINS: ReadonlySet<string> = new Set(['regular', 'user-agent'])
const DESCRIPTORS: ReadonlySet<string> = new Set(['inherits', 'initial-value'])

// the parts of a `CSS.getMatchedStylesForNode` answer the trimmer reads
interface AnswerDeclaration {
  readonly name: string
  readonly value: string
  readonly important?: boolean
  readonly parsedOk?: boolean
  readonly disabled?: boolean
  readonly range?: object
  readonly longhandProperties?: readonly { readonly name: string }[]
}

interface AnswerStyle {
  readonly styleSheetId?: string
  readonly range?: {
    readonly startLine: number
    readonly startColumn: number
    readonly endLine: number
    readonly endColumn: number
  }
  readonly cssProperties: readonly AnswerDeclaration[]
}

interface AnswerMatch {
  readonly rule: {
    readonly styleSheetId?: string
    readonly origin: string
    readonly selectorList: {
      readonly text: string
      readonly selectors: readonly { readonly text: string }[]
    }
    readonly layers?: readonly RawLayer[]
    readonly style: AnswerStyle
  }
  readonly matchingSelectors: readonly number[]
}

interface Answer {
  readonly inlineStyle?: AnswerStyle
  readonly attributesStyle?: AnswerStyle
  readonly matchedCSSRules?: readonly AnswerMatch[]
  readonly inherited?: readonly {
    readonly inlineStyle?: AnswerStyle
    readonly matchedCSSRules: readonly AnswerMatch[]
  }[]
  readonly cssPropertyRules?: readonly {
    readonly styleSheetId?: string
    readonly propertyName: { readonly text: string }
    readonly style: AnswerStyle
  }[]
  readonly cssPropertyRegistrations?: readonly RawPropertyRegistration[]
}

// which declarations of a style are kept: every entry, the custom properties, or the `@property` descriptors
type Kept = 'all' | 'custom' | 'descriptors'

/** Nodes that share one attribution answer, in document order of their first member. */
export interface Grouping {
  readonly nodes: readonly number[]
  /** Backend node id of the first member, the one asked for the whole group. */
  readonly backendNodeId: number
}

/** The groups of one document and the session that serves it. */
export interface GroupedDocument {
  readonly session: CDPSession
  readonly groups: readonly Grouping[]
}

/** Groups the laid-out elements and pseudo elements by style row, tag, classes, id and pseudo type. */
export function ruleGroups(document: DocumentSnapshot, strings: readonly string[]): Grouping[] {
  const { nodes, layout } = document
  const rowOf = new Map<number, number>()
  layout.nodeIndex.forEach((nodeIndex, row) => {
    if (!rowOf.has(nodeIndex)) rowOf.set(nodeIndex, row)
  })
  const pseudoOf = new Map<number, string>()
  nodes.pseudoType?.index.forEach((nodeIndex, at) => {
    pseudoOf.set(nodeIndex, strings[nodes.pseudoType?.value[at] ?? -1] ?? '')
  })
  const groups = new Map<string, { nodes: number[]; backendNodeId: number }>()
  nodes.parentIndex.forEach((parentIndex, nodeIndex) => {
    const row = rowOf.get(nodeIndex)
    const backendNodeId = nodes.backendNodeId[nodeIndex]
    if (nodes.nodeType[nodeIndex] !== ELEMENT_NODE || row === undefined) return
    if (backendNodeId === undefined) return
    const pseudo = pseudoOf.get(nodeIndex) ?? ''
    if (pseudo !== '' && !PSEUDO_TYPES.has(pseudo)) return
    const element = pseudo === '' ? nodeIndex : parentIndex
    const attributes = nodes.attributes[element] ?? []
    const key = [
      (layout.styles[row] ?? []).join(','),
      strings[nodes.nodeName[element] ?? -1] ?? '',
      classes(attribute(strings, attributes, 'class')),
      attribute(strings, attributes, 'id'),
      pseudo,
    ].join('|')
    const group = groups.get(key)
    if (group === undefined) groups.set(key, { nodes: [nodeIndex], backendNodeId })
    else group.nodes.push(nodeIndex)
  })
  return [...groups.values()]
}

/** Matched styles of every group when their total is within the budget; null per document otherwise. */
export async function readRuleGroups(
  documents: readonly GroupedDocument[]
): Promise<(RuleGroup[] | null)[]> {
  const total = documents.reduce((sum, document) => sum + document.groups.length, 0)
  if (total > RULE_GROUP_LIMIT) return documents.map(() => null)
  const out: RuleGroup[][] = []
  for (const { session, groups } of documents) out.push(await readMatchedStyles(session, groups))
  return out
}

/** One `CSS.getMatchedStylesForNode` per group, all in flight at once on the session. */
async function readMatchedStyles(
  session: CDPSession,
  groups: readonly Grouping[]
): Promise<RuleGroup[]> {
  if (groups.length === 0) return []
  const { nodeIds } = await session.send('DOM.pushNodesByBackendIdsToFrontend', {
    backendNodeIds: groups.map((group) => group.backendNodeId),
  })
  const trim = trimmer()
  const answers = await Promise.all(
    nodeIds.map((nodeId) =>
      session
        .send('CSS.getMatchedStylesForNode', { nodeId })
        .then(trim)
        // a node the CSS agent cannot resolve, such as a detached pseudo element, has no rules
        .catch((): MatchedStyles => ({}))
    )
  )
  return groups.map((group, index) => ({ nodes: group.nodes, matched: answers[index] ?? {} }))
}

/** Trims each answer of one document as it arrives to what the assembler reads, sharing the kept declarations of a style among the answers it appears in: the inherited chain shrinks to its custom properties; pseudo elements, keyframes and the rest go. */
export function trimmer(): (answer: Answer) => MatchedStyles {
  const shared = new Map<string, RawStyle>()
  return (answer) => {
    const out: Mutable<MatchedStyles> = {
      matchedCSSRules: (answer.matchedCSSRules ?? []).flatMap((match) =>
        ORIGINS.has(match.rule.origin)
          ? [{ rule: rule(match, style(match.rule.style, 'all', shared)) }]
          : []
      ),
    }
    if (answer.inlineStyle !== undefined) out.inlineStyle = style(answer.inlineStyle, 'all', shared)
    if (answer.attributesStyle !== undefined) {
      out.attributesStyle = style(answer.attributesStyle, 'all', shared)
    }
    if (answer.inherited !== undefined) {
      out.inherited = answer.inherited.map((level) => inheritedStyle(level, shared))
    }
    if (answer.cssPropertyRules !== undefined) {
      out.cssPropertyRules = answer.cssPropertyRules.map(
        ({ styleSheetId, propertyName, style: descriptors }): RawPropertyRule => ({
          ...(styleSheetId === undefined ? {} : { styleSheetId }),
          propertyName: { text: propertyName.text },
          style: style(descriptors, 'descriptors', shared),
        })
      )
    }
    if (answer.cssPropertyRegistrations !== undefined) {
      out.cssPropertyRegistrations = answer.cssPropertyRegistrations.map(
        ({ propertyName, initialValue, inherits }) => ({
          propertyName,
          ...(initialValue === undefined ? {} : { initialValue: { text: initialValue.text } }),
          inherits,
        })
      )
    }
    return out
  }
}

function inheritedStyle(
  level: NonNullable<Answer['inherited']>[number],
  shared: Map<string, RawStyle>
): RawInheritedStyle {
  const out: Mutable<RawInheritedStyle> = {
    matchedCSSRules: level.matchedCSSRules.flatMap((match) => {
      if (match.rule.origin !== 'regular') return []
      const custom = style(match.rule.style, 'custom', shared)
      return custom.cssProperties.length === 0 ? [] : [{ rule: rule(match, custom) }]
    }),
  }
  if (level.inlineStyle !== undefined) out.inlineStyle = style(level.inlineStyle, 'custom', shared)
  return out
}

function rule({ rule: raw, matchingSelectors }: AnswerMatch, kept: RawStyle): RawRule {
  const { selectors } = raw.selectorList
  // the browser's own rules list many selectors; DevTools names one by those that matched
  const text =
    raw.origin === 'user-agent' && matchingSelectors.length > 0
      ? matchingSelectors.map((index) => selectors[index]?.text ?? '').join(', ')
      : raw.selectorList.text
  const out: Mutable<RawRule> = { origin: raw.origin, selectorList: { text }, style: kept }
  if (raw.styleSheetId !== undefined) out.styleSheetId = raw.styleSheetId
  if (raw.layers !== undefined) out.layers = raw.layers.map(layer)
  return out
}

function layer({ text, styleSheetId, range }: RawLayer): RawLayer {
  const out: Mutable<RawLayer> = { text }
  if (styleSheetId !== undefined) out.styleSheetId = styleSheetId
  if (range !== undefined) {
    out.range = { startLine: range.startLine, startColumn: range.startColumn }
  }
  return out
}

// once per style source range, which identifies a style while the page is frozen; a filtered style keeps only the entries as written when it has some, the browser's duplicates add nothing to it
function style(raw: AnswerStyle, kind: Kept, shared: Map<string, RawStyle>): RawStyle {
  const { styleSheetId, range } = raw
  const key =
    styleSheetId === undefined || range === undefined
      ? null
      : [
          kind,
          styleSheetId,
          range.startLine,
          range.startColumn,
          range.endLine,
          range.endColumn,
        ].join('|')
  const known = key === null ? undefined : shared.get(key)
  if (known !== undefined) return known
  const sourced = raw.cssProperties.some((d) => d.range !== undefined)
  const keep = (d: AnswerDeclaration): boolean =>
    (kind === 'custom' ? d.name.startsWith('--') : DESCRIPTORS.has(d.name)) &&
    (!sourced || d.range !== undefined)
  const kept = {
    cssProperties: (kind === 'all' ? raw.cssProperties : raw.cssProperties.filter(keep)).map(
      declaration
    ),
  }
  if (key !== null) shared.set(key, kept)
  return kept
}

function declaration(raw: AnswerDeclaration): RawDeclaration {
  const out: Mutable<RawDeclaration> = { name: raw.name, value: raw.value }
  if (raw.important === true) out.important = true
  if (raw.parsedOk === false) out.parsedOk = false
  if (raw.disabled === true) out.disabled = true
  if (raw.range !== undefined) out.source = true
  if (raw.longhandProperties !== undefined && raw.longhandProperties.length > 0) {
    out.longhandProperties = raw.longhandProperties.map(({ name }) => ({ name }))
  }
  return out
}

function attribute(strings: readonly string[], pairs: readonly number[], name: string): string {
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    if (strings[pairs[i] ?? -1] === name) return strings[pairs[i + 1] ?? -1] ?? ''
  }
  return ''
}

/** Class names sorted and deduplicated, so the order in the attribute never splits a group. */
function classes(value: string): string {
  return [...new Set(value.split(WHITESPACE).filter(Boolean))].sort().join(' ')
}
