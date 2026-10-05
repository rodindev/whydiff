import {
  IMPLICIT_ROLES,
  OBSERVATION_FACTS,
  OBSERVATION_MAX_FACTS,
  OBSERVATION_MIN_PX,
  OBSERVATION_NAME_MIN,
  OBSERVATION_TEXT_LIMIT,
  ROLE_NOUNS,
  TEXT_TAGS,
} from '../constants.js'
import { px } from '../causes/context.js'
import type { CauseNode } from '../causes/types.js'
import { blockClass, classContext } from '../cluster/component.js'
import type { ScreenCauses } from '../cluster/types.js'
import { parseColor, type Rgba8 } from '../deltas/color.js'
import { sameValue } from '../deltas/equal.js'
import { normalizeValue } from '../deltas/normalize.js'
import type { PairDelta } from '../deltas/types.js'
import type { NodeV1, Rect, SnapshotV1 } from '../snapshot/types.js'
import { code, count, quoted, readable, safe } from './format.js'
import type { FactKind, FactV1, ObservationV1 } from './types.js'

type Element = ObservationV1['element']
type Lookup = (prop: string) => string | null
type Screen = Pick<ScreenCauses, 'before' | 'after' | 'deltas'>

interface Sides {
  readonly before: Lookup
  readonly after: Lookup
  readonly changed: ReadonlySet<string>
}

interface Words {
  readonly lead: string
  readonly tail: string
}

/** Roles whose text a person calls a label. */
export const LABEL_ROLES: ReadonlySet<string> = new Set(['button', 'link'])
/** Visibility values under which an element paints nothing. */
const HIDDEN: ReadonlySet<string> = new Set(['hidden', 'collapse'])
/** Border styles that paint nothing. */
const UNPAINTED: ReadonlySet<string> = new Set(['none', 'hidden'])
/** Facts about an element's text rather than its box. */
const TEXT_FACTS: ReadonlySet<FactKind> = new Set([
  'text',
  'font-size',
  'font-weight',
  'letter-spacing',
  'line-height',
  'font',
  'color',
  'uppercase',
])
const SIDES = ['top', 'right', 'bottom', 'left'] as const
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const
const BORDER_PARTS = ['width', 'style', 'color'] as const
const PLAIN_NUMBER = /^\d+(?:\.\d+)?$/
const VOWEL = /^[aeiou]/
/** Tags said letter by letter: a first part of one or two letters, digits aside, or without a vowel (`ul`, `h1`, `svg`, `kbd`, `ui-card`). */
const SPELLED_TAG = /^(?:[a-z]{1,2}\d*|[^aeiou-]+)(?:-|$)/
/** Letters whose English name starts with a vowel sound: "an <li>", "an <h1>", "an <svg>". */
const VOWEL_LETTER = /^[aefhilmnorsx]/
/** Tags said as a word take "an" before these; `u` reads "you" (`use`). */
const VOWEL_TAG = /^[aeio]/
/** WCAG 2 relative luminance: weights of linear R, G and B in ten-thousandths. */
const LUMINANCE_WEIGHTS = [2126, 7152, 722] as const
/** Steps a linear channel is rounded to, so that two luminances compare as integers. */
const LINEAR_STEPS = 10_000
/** WCAG 2 sRGB transfer: a channel up to the limit is divided by the slope, above it the offset curve is raised to the exponent. */
const SRGB_LINEAR_LIMIT = 0.04045
const SRGB_SLOPE = 12.92
const SRGB_OFFSET = 0.055
const SRGB_SCALE = 1.055
const SRGB_EXPONENT = 2.4
/** 8-bit channel and alpha range of a parsed colour. */
const CHANNEL_MAX = 255

/** What changed on a cause's element as a person would see it; undefined when nothing passed a threshold. */
export function observe(screen: Screen, node: CauseNode): ObservationV1 | undefined {
  const snapshot = 'added' in node ? screen.after : screen.before
  const target =
    snapshot.nodes['added' in node ? node.added : 'removed' in node ? node.removed : node.before]
  if (target === undefined) return undefined
  const element = elementOf(target, snapshot)
  const found: FactV1[] =
    'added' in node
      ? [{ kind: 'appears' }]
      : 'removed' in node
        ? [{ kind: 'gone' }]
        : pairFacts(screen, node)
  const kept = [...found]
    .sort((a, b) => OBSERVATION_FACTS.indexOf(a.kind) - OBSERVATION_FACTS.indexOf(b.kind))
    .slice(0, OBSERVATION_MAX_FACTS)
  if (kept.length === 0) return undefined
  return { element, facts: kept, text: observationText(element, kept) }
}

function elementOf(node: NodeV1, snapshot: SnapshotV1): Element {
  const { tag } = node
  const role = node.role ?? IMPLICIT_ROLES.get(tag)
  const text =
    node.text !== undefined && readable(node.text) && node.text.length <= OBSERVATION_TEXT_LIMIT
      ? node.text
      : undefined
  const block = (): string | undefined => blockClass(node, classContext(snapshot))
  if (role !== undefined && ROLE_NOUNS.has(role)) {
    const name = (node.name !== undefined && readable(node.name) ? node.name : undefined) ?? text
    if (name !== undefined) return { role, name, tag }
    const kind = block()
    return kind === undefined ? { role, tag } : { role, class: kind, tag }
  }
  if (text !== undefined && text.length >= OBSERVATION_NAME_MIN) return { name: text, tag }
  const kind = block()
  return kind === undefined ? { tag } : { class: kind, tag }
}

function pairFacts(
  screen: Screen,
  node: { readonly before: number; readonly after: number }
): FactV1[] {
  const pair = screen.deltas.pairs.find((p) => p.before === node.before)
  const before = screen.before.nodes[node.before]
  const after = screen.after.nodes[node.after]
  if (pair === undefined || before === undefined || after === undefined) return []
  const sides: Sides = {
    before: lookup(screen.before, before),
    after: lookup(screen.after, after),
    changed: new Set(pair.style.filter((c) => c.derived === undefined).map((c) => c.prop)),
  }
  const geometry = geometryFacts(before.box, after.box)
  const resized = geometry.some((f) => f.kind === 'width' || f.kind === 'height')
  return [
    ...presenceFacts(sides),
    ...geometry,
    ...textFacts(pair, sides),
    ...typeFacts(sides),
    ...boxFacts(sides, resized),
  ]
}

function lookup(snapshot: SnapshotV1, node: NodeV1): Lookup {
  const row = snapshot.styles[node.s]
  return (prop) => {
    const column = snapshot.props.indexOf(prop)
    return column < 0 ? null : (row?.[column] ?? null)
  }
}

function isFact(value: FactV1 | null): value is FactV1 {
  return value !== null
}

function presenceFacts(sides: Sides): FactV1[] {
  if (!sides.changed.has('opacity') && !sides.changed.has('visibility')) return []
  const shown = (side: Lookup): boolean =>
    Number.parseFloat(side('opacity') ?? '1') !== 0 && !HIDDEN.has(side('visibility') ?? '')
  const before = shown(sides.before)
  if (before === shown(sides.after)) return []
  return [{ kind: before ? 'invisible' : 'visible' }]
}

function geometryFacts(before: Rect, after: Rect): FactV1[] {
  const size = [
    axisFact('width', before[2], after[2]),
    axisFact('height', before[3], after[3]),
  ].filter(isFact)
  if (size.length > 0) return size
  return [axisFact('x', before[0], after[0]), axisFact('y', before[1], after[1])].filter(isFact)
}

function axisFact(kind: 'width' | 'height' | 'x' | 'y', from: number, to: number): FactV1 | null {
  const values = rounded(from, to)
  return values === null ? null : { kind, from: values[0], to: values[1] }
}

function rounded(from: number, to: number): readonly [number, number] | null {
  return Math.abs(to - from) < OBSERVATION_MIN_PX ? null : [Math.round(from), Math.round(to)]
}

function textFacts(pair: PairDelta, sides: Sides): FactV1[] {
  const out: FactV1[] = []
  if (pair.text !== undefined) out.push({ kind: 'text', from: pair.text.from, to: pair.text.to })
  if (pair.font !== undefined) out.push({ kind: 'font', from: pair.font.from, to: pair.font.to })
  return [...out, colourFact('color', 'color', sides), caseFact(sides)].filter(isFact)
}

function typeFacts(sides: Sides): FactV1[] {
  const facts: (FactV1 | null)[] = [
    ['font-size', numbers(sides, 'font-size', length)] as const,
    ['font-weight', numbers(sides, 'font-weight', fontWeight)] as const,
    ['letter-spacing', numbers(sides, 'letter-spacing', px)] as const,
    ['line-height', numbers(sides, 'line-height', length)] as const,
  ].map(([kind, values]) => (values === null ? null : { kind, ...values }))
  return facts.filter(isFact)
}

function numbers(
  sides: Sides,
  prop: string,
  read: (value: string) => number | null
): { from: number; to: number } | null {
  if (!sides.changed.has(prop)) return null
  const from = read(sides.before(prop) ?? '')
  const to = read(sides.after(prop) ?? '')
  return from === null || to === null || from === to ? null : { from, to }
}

function length(value: string): number | null {
  return value.endsWith('px') ? px(value) : null
}

function fontWeight(value: string): number | null {
  const weight = normalizeValue('font-weight', value)
  return PLAIN_NUMBER.test(weight) ? Number(weight) : null
}

function caseFact(sides: Sides): FactV1 | null {
  if (!sides.changed.has('text-transform')) return null
  const from = sides.before('text-transform') ?? 'none'
  const to = sides.after('text-transform') ?? 'none'
  if (to !== 'uppercase' && from !== 'uppercase') return null
  return { kind: 'uppercase', from, to }
}

function colourFact(kind: 'color' | 'background', prop: string, sides: Sides): FactV1 | null {
  if (!sides.changed.has(prop)) return null
  const before = parseColor(sides.before(prop) ?? '')
  const after = parseColor(sides.after(prop) ?? '')
  if (before === null || after === null) return null
  const from = hex(before)
  const to = hex(after)
  return from === to ? null : { kind, from, to }
}

/** Whether a colour of an observation, as `hexColor` prints it, turned darker or lighter; null when either is not opaque or the luminance stayed. */
export function hexShade(from: string, to: string): 'darker' | 'lighter' | null {
  const before = fromHex(from)
  const after = fromHex(to)
  return before === null || after === null ? null : shadeOf(before, after)
}

function fromHex(text: string): Rgba8 | null {
  const channels = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(text)
  if (channels === null) return null
  const [, r = '', g = '', b = '', a] = channels
  const channel = (pair: string): number => Number.parseInt(pair, 16)
  return {
    r: channel(r),
    g: channel(g),
    b: channel(b),
    a: a === undefined ? CHANNEL_MAX : channel(a),
  }
}

function shadeOf(before: Rgba8, after: Rgba8): 'darker' | 'lighter' | null {
  if (before.a !== CHANNEL_MAX || after.a !== CHANNEL_MAX) return null
  const from = luminance(before)
  const to = luminance(after)
  if (from === to) return null
  return to < from ? 'darker' : 'lighter'
}

function luminance({ r, g, b }: Rgba8): number {
  const [wr, wg, wb] = LUMINANCE_WEIGHTS
  return wr * linear(r) + wg * linear(g) + wb * linear(b)
}

function linear(channel: number): number {
  const value = channel / CHANNEL_MAX
  const light =
    value <= SRGB_LINEAR_LIMIT
      ? value / SRGB_SLOPE
      : ((value + SRGB_OFFSET) / SRGB_SCALE) ** SRGB_EXPONENT
  return Math.round(light * LINEAR_STEPS)
}

/** A computed colour as observations print it, `#rrggbb`, `#rrggbbaa` or `transparent`; null for any other value. */
export function hexColor(value: string): string | null {
  const colour = parseColor(value)
  return colour === null ? null : hex(colour)
}

function hex({ r, g, b, a }: Rgba8): string {
  if (a === 0) return 'transparent'
  const channels = a === CHANNEL_MAX ? [r, g, b] : [r, g, b, a]
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

function boxFacts(sides: Sides, resized: boolean): FactV1[] {
  return [
    colourFact('background', 'background-color', sides),
    borderFact(sides),
    cornersFact(sides),
    shadowFact(sides),
    resized ? null : paddingFact(sides),
  ].filter(isFact)
}

function borderFact(sides: Sides): FactV1 | null {
  const props = SIDES.flatMap((side) => BORDER_PARTS.map((part) => `border-${side}-${part}`))
  if (!props.some((prop) => sides.changed.has(prop))) return null
  const from = borderColour(sides.before)
  const to = borderColour(sides.after)
  return from === to ? null : { kind: 'border', from, to }
}

function borderColour(side: Lookup): string {
  for (const name of SIDES) {
    const colour = parseColor(side(`border-${name}-color`) ?? '')
    if (
      UNPAINTED.has(side(`border-${name}-style`) ?? 'none') ||
      px(side(`border-${name}-width`)) <= 0 ||
      colour === null ||
      colour.a === 0
    )
      continue
    return hex(colour)
  }
  return 'none'
}

function cornersFact(sides: Sides): FactV1 | null {
  if (!CORNERS.some((corner) => sides.changed.has(`border-${corner}-radius`))) return null
  const from = radius(sides.before)
  const to = radius(sides.after)
  return from === null || to === null || from === to ? null : { kind: 'corners', from, to }
}

function radius(side: Lookup): number | null {
  let largest = 0
  for (const corner of CORNERS) {
    const [horizontal = ''] = (side(`border-${corner}-radius`) ?? '0px').split(' ')
    const value = length(horizontal)
    if (value === null) return null
    largest = Math.max(largest, value)
  }
  return largest
}

function shadowFact(sides: Sides): FactV1 | null {
  if (!sides.changed.has('box-shadow')) return null
  return {
    kind: 'shadow',
    from: sides.before('box-shadow') ?? 'none',
    to: sides.after('box-shadow') ?? 'none',
  }
}

function paddingFact(sides: Sides): FactV1 | null {
  if (!SIDES.some((side) => sides.changed.has(`padding-${side}`))) return null
  const total = (side: Lookup): number =>
    SIDES.reduce((sum, name) => sum + px(side(`padding-${name}`)), 0)
  const values = rounded(total(sides.before), total(sides.after))
  return values === null ? null : { kind: 'padding', from: values[0], to: values[1] }
}

/** The line an observation prints for these facts of the element, in their order: `the "Save" button is 8 px wider (was 80, now 88) and its label is bolder`. */
export function observationText(
  element: ObservationV1['element'],
  facts: readonly FactV1[]
): string {
  const its = `its ${LABEL_ROLES.has(element.role ?? '') ? 'label' : 'text'}`
  const said = facts.map((fact) => wordsOf(fact, its))
  const [first = '', ...rest] = said.map(({ lead, tail }, index) =>
    lead === '' || said[index - 1]?.lead === lead ? tail : `${lead} ${tail}`
  )
  const textual = TEXT_FACTS.has(facts[0]?.kind ?? 'width')
  return listed([opening(element, textual, first), ...rest])
}

/** The words a fact is said in, `its` naming the element's text or label. */
function wordsOf(fact: FactV1, its: string): Words {
  const from = fact.from ?? ''
  const to = fact.to ?? ''
  const a = Number(from)
  const b = Number(to)
  const values = `(was ${String(from)}, now ${String(to)})`
  switch (fact.kind) {
    case 'appears':
      return { lead: '', tail: 'appears' }
    case 'gone':
      return { lead: '', tail: 'is gone' }
    case 'visible':
      return { lead: '', tail: 'becomes visible' }
    case 'invisible':
      return { lead: '', tail: 'becomes invisible' }
    case 'width':
    case 'height': {
      const word =
        fact.kind === 'width' ? (b < a ? 'narrower' : 'wider') : b < a ? 'shorter' : 'taller'
      return {
        lead: 'is',
        tail: `${count(Math.abs(b - a))} px ${word} (was ${count(a)}, now ${count(b)})`,
      }
    }
    case 'x':
    case 'y': {
      const word = fact.kind === 'x' ? (b < a ? 'left' : 'right') : b < a ? 'up' : 'down'
      return { lead: 'moved', tail: `${count(Math.abs(b - a))} px ${word}` }
    }
    case 'text': {
      const short =
        String(from).length <= OBSERVATION_TEXT_LIMIT && String(to).length <= OBSERVATION_TEXT_LIMIT
      return {
        lead: its,
        tail: short
          ? `changed (was ${quoted(String(from))}, now ${quoted(String(to))})`
          : 'changed',
      }
    }
    case 'font':
      return {
        lead: '',
        tail: `uses another font (was ${safe(String(from))}, now ${safe(String(to))})`,
      }
    case 'color':
    case 'background': {
      const lead = fact.kind === 'color' ? its : 'its background'
      const shade = hexShade(String(from), String(to))
      if (shade !== null) return { lead: `${lead} is`, tail: `${shade} ${values}` }
      return {
        lead,
        tail: fact.kind === 'color' ? `changed colour ${values}` : `changed ${values}`,
      }
    }
    case 'uppercase':
      return {
        lead: `${its} is`,
        tail: to === 'uppercase' ? 'now uppercase' : 'no longer uppercase',
      }
    case 'font-size':
      return {
        lead: `${its} is`,
        tail: `${b > a ? 'larger' : 'smaller'} (was ${String(a)} px, now ${String(b)} px)`,
      }
    case 'font-weight':
      return { lead: `${its} is`, tail: b > a ? 'bolder' : 'less bold' }
    case 'letter-spacing':
      return { lead: `${its} is`, tail: `spaced ${b > a ? 'wider' : 'tighter'}` }
    case 'line-height':
      return { lead: 'its lines are', tail: b > a ? 'taller' : 'shorter' }
    case 'border':
      return {
        lead: 'its border',
        tail: from === 'none' ? 'appears' : to === 'none' ? 'disappears' : 'changes colour',
      }
    case 'corners':
      return { lead: 'its corners are', tail: b > a ? 'rounder' : 'sharper' }
    case 'shadow': {
      const had = !sameValue('box-shadow', 'none', String(from))
      const has = !sameValue('box-shadow', 'none', String(to))
      return { lead: 'its shadow', tail: had && has ? 'changes' : has ? 'appears' : 'disappears' }
    }
    case 'padding':
      return {
        lead: 'its inner spacing',
        tail: `${b < a ? 'shrank' : 'grew'} by ${count(Math.abs(b - a))} px`,
      }
  }
}

/** An element named by its own words is its text when its tag holds text or the first fact is about the text. */
function opening(element: Element, textual: boolean, clause: string): string {
  const roleless = element.role === undefined && element.name !== undefined
  const text = roleless && (textual || TEXT_TAGS.has(element.tag))
  const name = nameOf(element, text)
  if (text && clause.startsWith('its text')) return `${name}${clause.slice('its text'.length)}`
  if (clause.startsWith('its ')) return `${name}'s ${clause.slice('its '.length)}`
  return `${name} ${clause}`
}

function nameOf(element: Element, text: boolean): string {
  const noun = element.role === undefined ? undefined : ROLE_NOUNS.get(element.role)
  if (noun !== undefined && element.name !== undefined) return `the ${quoted(element.name)} ${noun}`
  if (noun !== undefined && element.class === undefined) return `${article(noun)} ${noun}`
  if (element.name !== undefined) return `the ${quoted(element.name)} ${text ? 'text' : 'element'}`
  const kind = element.class === undefined ? '' : `.${element.class}`
  return `${tagArticle(element.tag)} ${code(`<${element.tag}${kind}>`)}`
}

function article(word: string): string {
  return VOWEL.test(word) ? 'an' : 'a'
}

function tagArticle(tag: string): string {
  return (SPELLED_TAG.test(tag) ? VOWEL_LETTER : VOWEL_TAG).test(tag) ? 'an' : 'a'
}

function listed(items: readonly string[]): string {
  const last = items.at(-1) ?? ''
  return items.length < 2 ? last : `${items.slice(0, -1).join(', ')} and ${last}`
}
