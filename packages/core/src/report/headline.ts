import {
  HEADLINE_MIN_SHARE,
  HEADLINE_NOUNS,
  HEADLINE_PROPS,
  OBSERVATION_FACTS,
  PAINT_ONLY_PROPS,
  ROLE_NOUNS,
} from '../constants.js'
import { sameValue } from '../deltas/equal.js'
import { code, compareText, count, safe } from './format.js'
import { hexShade, LABEL_ROLES } from './observe.js'
import type { CauseV1, FactKind, FactV1, ObservationV1 } from './types.js'

type Element = ObservationV1['element']

/** What a cause's impact is measured against: the run's changed screenshots and their changed pixels. */
export interface RunTotals {
  readonly screenshots: number
  readonly pixels: number
}

interface Held {
  readonly fact: FactV1
  readonly element: Element
}

interface Claim {
  readonly kind: FactKind
  readonly word: string
  readonly held: Held[]
}

/** Facts that say an element appeared or went away, which a person sees first. */
const PRESENCE: ReadonlySet<FactKind> = new Set(['appears', 'gone', 'visible', 'invisible'])

/** The run-wide sentence of a cause and its share of the run: what at least half of its members show that the cause's own properties can produce, and how many show it; the member's own line when it is one element; else which properties of how many elements changed. */
export function headlineOf(
  cause: Pick<CauseV1, 'members' | 'screenshots' | 'pixels' | 'summary'>,
  totals: RunTotals
): string {
  return `${claimOf(cause)}, ${impactOf(cause, totals)}`
}

/** A cause's headline without its share of the run: what the cause did. */
export function withoutImpact(cause: CauseV1, totals: RunTotals): string {
  const impact = `, ${impactOf(cause, totals)}`
  return cause.headline.endsWith(impact) ? cause.headline.slice(0, -impact.length) : cause.headline
}

/** `on 41 of 120 changed screenshots, 9% of changed pixels`. */
function impactOf(cause: Pick<CauseV1, 'screenshots' | 'pixels'>, totals: RunTotals): string {
  const on = onScreenshots(cause.screenshots, totals.screenshots)
  return totals.pixels === 0 ? on : `${on}, ${share(cause.pixels, totals.pixels)} of changed pixels`
}

/** `on 41 of 120 changed screenshots`, `on all 120 changed screenshots`, `on the changed screenshot`. */
export function onScreenshots(part: number, whole: number): string {
  if (part !== whole) return `on ${count(part)} of ${count(whole)} changed screenshots`
  return whole === 1 ? 'on the changed screenshot' : `on all ${count(whole)} changed screenshots`
}

/** A whole percentage, `under 1%` for a share that rounds to nothing. */
export function share(part: number, whole: number): string {
  const percent = Math.round((100 * part) / whole)
  return percent === 0 && part > 0 ? 'under 1%' : `${String(percent)}%`
}

/** Whether a cause with this summary can show as a fact of a kind: any kind for a cause that names no longhands. */
export function showsAs(summary: CauseV1['summary']): (kind: FactKind) => boolean {
  const props = propsOf(summary)
  return (kind) => props === null || produces(kind, props)
}

function claimOf(cause: Pick<CauseV1, 'members' | 'summary'>): string {
  const { members } = cause
  const props = propsOf(cause.summary)
  const shows = showsAs(cause.summary)
  const producible = (fact: FactV1): boolean => shows(fact.kind)
  const [single] = members
  if (members.length === 1 && single?.observation?.facts.every(producible) === true) {
    return single.observation.text
  }
  const observed = members.flatMap((m) => (m.observation === undefined ? [] : [m.observation]))
  const noun = nounOf(
    observed.map((o) => o.element),
    members.length
  )
  const [best] = claimsOf(observed, producible).filter(
    (claim) => claim.held.length >= members.length * HEADLINE_MIN_SHARE
  )
  if (best === undefined) {
    const what = props === null ? '' : families(props)
    return what === ''
      ? `${count(members.length)} ${noun} changed`
      : `${what} of ${count(members.length)} ${noun} changed`
  }
  const held = best.held.length
  const subject =
    held === members.length
      ? `${count(held)} ${noun}`
      : `${count(held)} of ${count(members.length)} ${noun}`
  return phrase(best, subject, held === 1)
}

/** The longhands behind a cause that a fact must come from: a rule's own and those it reached through custom properties, a style change's; null for a cause of another kind, which any fact may describe. */
export function propsOf(summary: CauseV1['summary']): readonly string[] | null {
  if (summary.kind === 'rule') {
    return [
      ...[...summary.sets, ...summary.changed, ...summary.unsets].filter(
        (p) => !p.startsWith('--')
      ),
      ...(summary.vars ?? []).flatMap((v) => v.readBy),
    ]
  }
  return 'changes' in summary ? summary.changes.map((c) => c.prop) : null
}

/** Whether a change of these longhands can show as a fact of this kind: a size or a move from any that is not paint only, a width or a height not from one that moves only the other axis, the others from the longhands they read. */
function produces(kind: FactKind, props: readonly string[]): boolean {
  const source = FACT_SOURCES[kind]
  if (source !== undefined) return props.some((prop) => source.test(prop))
  const other = OTHER_AXIS[kind]
  return props.some((prop) => !PAINT_ONLY_PROPS.includes(prop) && other?.test(prop) !== true)
}

/** The longhands that move only a box's top and bottom edges, which no width comes from, and only its left and right ones, which no height comes from. */
const OTHER_AXIS: Partial<Record<FactKind, RegExp>> = {
  width:
    /^(?:(?:padding|margin)-(?:top|bottom)|border-(?:top|bottom)-width|(?:min-|max-)?height|top|bottom|row-gap)$/,
  height:
    /^(?:(?:padding|margin)-(?:left|right)|border-(?:left|right)-width|(?:min-|max-)?width|left|right|column-gap)$/,
}

/** The longhands a fact of each kind reads; a kind left out is a size or a move. */
const FACT_SOURCES: Partial<Record<FactKind, RegExp>> = {
  appears: /^display$/,
  gone: /^display$/,
  visible: /^(?:opacity|visibility|filter|clip-path)$/,
  invisible: /^(?:opacity|visibility|filter|clip-path)$/,
  text: /^$/,
  'font-size': /^font-size$/,
  'font-weight': /^font-weight$/,
  'letter-spacing': /^(?:letter-spacing|font-size)$/,
  'line-height': /^(?:line-height|font-size)$/,
  font: /^font-(?:family|weight|style)$/,
  color: /^color$/,
  uppercase: /^text-transform$/,
  background: /^background-/,
  border: /^border-(?:top|right|bottom|left)-(?:color|style|width)$/,
  corners: /-radius$/,
  shadow: /^box-shadow$/,
  padding: /^padding-/,
}

/** Longhands by the shorthand family a person names them by, as properties: `the padding property`, `the border-color and border-width properties`; a few, else the first two and how many more; empty without any. */
function families(props: readonly string[]): string {
  const names = [
    ...new Set(
      props.map((prop) =>
        prop
          .replace(/-(?:top|bottom)-(?:left|right)-radius$/, '-radius')
          .replace(/-(?:top|right|bottom|left)(?=-|$)/, '')
      )
    ),
  ].sort(compareText)
  if (names.length === 0) return ''
  if (names.length === 1) return `the ${names.join('')} property`
  if (names.length <= HEADLINE_PROPS) return `the ${listed(names)} properties`
  return `the ${names.slice(0, 2).join(', ')} and ${count(names.length - 2)} more properties`
}

/** Every fact the cause can produce, with its direction, by how many members hold it: appearing and going first, then the most held, then in observation order. */
function claimsOf(
  observed: readonly ObservationV1[],
  producible: (fact: FactV1) => boolean
): Claim[] {
  const claims: Claim[] = []
  for (const { element, facts } of observed) {
    for (const fact of facts.filter(producible)) {
      const word = wordOf(fact)
      const claim = claims.find((c) => c.kind === fact.kind && c.word === word)
      if (claim === undefined) claims.push({ kind: fact.kind, word, held: [{ fact, element }] })
      else claim.held.push({ fact, element })
    }
  }
  const tier = (kind: FactKind): number => (PRESENCE.has(kind) ? 0 : 1)
  return claims.sort(
    (a, b) =>
      tier(a.kind) - tier(b.kind) ||
      b.held.length - a.held.length ||
      OBSERVATION_FACTS.indexOf(a.kind) - OBSERVATION_FACTS.indexOf(b.kind) ||
      compareText(a.word, b.word)
  )
}

/** The direction of a fact in the words its observation uses. */
function wordOf(fact: FactV1): string {
  const { kind, from, to } = fact
  const less = typeof from === 'number' && typeof to === 'number' && to < from
  switch (kind) {
    case 'width':
      return less ? 'narrower' : 'wider'
    case 'height':
    case 'line-height':
      return less ? 'shorter' : 'taller'
    case 'x':
      return less ? 'left' : 'right'
    case 'y':
      return less ? 'up' : 'down'
    case 'font-size':
      return less ? 'smaller' : 'larger'
    case 'font-weight':
      return less ? 'less bold' : 'bolder'
    case 'letter-spacing':
      return less ? 'tighter' : 'wider'
    case 'corners':
      return less ? 'sharper' : 'rounder'
    case 'padding':
      return less ? 'shrank' : 'grew'
    case 'color':
    case 'background':
      return hexShade(String(from ?? ''), String(to ?? '')) ?? 'changed'
    case 'uppercase':
      return to === 'uppercase' ? 'now' : 'no longer'
    case 'border':
      return from === 'none' ? 'appears' : to === 'none' ? 'disappears' : 'changes colour'
    case 'shadow': {
      const had = !sameValue('box-shadow', 'none', String(from ?? 'none'))
      const has = !sameValue('box-shadow', 'none', String(to ?? 'none'))
      return had && has ? 'changes' : has ? 'appears' : 'disappears'
    }
    default:
      return kind
  }
}

/** The claim as a sentence about its subject, in the words of the observations, plural unless one element holds it. */
function phrase(claim: Claim, subject: string, one: boolean): string {
  const { kind, word, held } = claim
  const is = one ? 'is' : 'are'
  const labels = held.every((h) => LABEL_ROLES.has(h.element.role ?? ''))
  const text = labels ? `the ${one ? 'label' : 'labels'} of ${subject}` : `the text of ${subject}`
  const textIs = labels && !one ? 'are' : 'is'
  const of = (part: string): string => `the ${part}${one ? '' : 's'} of ${subject}`
  const verb = (singular: string, plural: string): string => (one ? singular : plural)
  // `appears`, `changes colour`: the words of a single element's observation, their first verb made plural
  const agreed = one ? word : word.replace(/^(\S+)s(?=\s|$)/, '$1')
  switch (kind) {
    case 'appears':
      return `${subject} ${agreed}`
    case 'gone':
      return `${subject} ${is} gone`
    case 'visible':
    case 'invisible':
      return `${subject} ${verb('becomes', 'become')} ${kind}`
    case 'width':
    case 'height':
      return `${subject} ${is} ${range(held)} ${word}`
    case 'x':
    case 'y':
      return `${subject} moved ${range(held)} ${word}`
    case 'padding':
      return `the inner spacing of ${subject} ${word} by ${range(held)}`
    case 'text':
      return `${text} changed`
    case 'font-size':
      return `${text} ${textIs} ${word}${values(held, ' px')}`
    case 'font-weight':
      return `${text} ${textIs} ${word}`
    case 'letter-spacing':
      return `${text} ${textIs} spaced ${word}`
    case 'line-height':
      return `the lines of ${subject} are ${word}`
    case 'font':
      return `${subject} ${verb('uses', 'use')} another font${values(held, '')}`
    case 'color':
      return word === 'changed'
        ? `${text} changed colour${values(held, '')}`
        : `${text} ${textIs} ${word}${values(held, '')}`
    case 'uppercase':
      return `${text} ${textIs} ${word} uppercase`
    case 'background':
      return word === 'changed'
        ? `${of('background')} changed${values(held, '')}`
        : `${of('background')} ${is} ${word}${values(held, '')}`
    case 'border':
      return `${of('border')} ${agreed}`
    case 'corners':
      return `the corners of ${subject} are ${word}`
    case 'shadow':
      return `${of('shadow')} ${agreed}`
  }
}

/** `24 px`, or `12 to 224 px` when the members differ. */
function range(held: readonly Held[]): string {
  const sizes = held.map(({ fact }) => Math.abs(Number(fact.to) - Number(fact.from)))
  const low = Math.min(...sizes)
  const high = Math.max(...sizes)
  return low === high ? `${count(low)} px` : `${count(low)} to ${count(high)} px`
}

/** ` (was a, now b)` when every member went between the same two values. */
function values(held: readonly Held[], unit: string): string {
  const [first] = held
  const { from, to } = first?.fact ?? {}
  if (from === undefined || to === undefined) return ''
  if (!held.every(({ fact }) => fact.from === from && fact.to === to)) return ''
  return ` (was ${safe(String(from))}${unit}, now ${safe(String(to))}${unit})`
}

/** The members' elements as one plural noun: their role noun or their tag and class, up to a few kinds, else `elements`. */
function nounOf(elements: readonly Element[], members: number): string {
  const kinds: { key: string; count: number }[] = []
  for (const element of elements) {
    const key = nounKey(element)
    const kind = kinds.find((k) => k.key === key)
    if (kind === undefined) kinds.push({ key, count: 1 })
    else kind.count++
  }
  const one = members === 1
  const noun = one ? 'element' : 'elements'
  if (kinds.length === 0 || kinds.length > HEADLINE_NOUNS) return noun
  const keys = kinds
    .sort((a, b) => b.count - a.count || compareText(a.key, b.key))
    .map((k) => k.key)
  // tags alone share one noun: "`<div.a>` and `<div.b>` elements"
  if (keys.every((key) => key.startsWith('`'))) return `${listed(keys)} ${noun}`
  return listed(keys.map((key) => (key.startsWith('`') ? `${key} ${noun}` : plural(key, one))))
}

function listed(words: readonly string[]): string {
  const last = words.at(-1) ?? ''
  return words.length < 2 ? last : `${words.slice(0, -1).join(', ')} and ${last}`
}

function nounKey(element: Element): string {
  const noun = element.role === undefined ? undefined : ROLE_NOUNS.get(element.role)
  if (noun !== undefined) return noun
  return code(`<${element.tag}${element.class === undefined ? '' : `.${element.class}`}>`)
}

function plural(noun: string, one: boolean): string {
  if (one) return noun
  return /(?:x|s|ch|sh)$/.test(noun) ? `${noun}es` : `${noun}s`
}
