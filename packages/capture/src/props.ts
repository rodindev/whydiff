import type { CDPSession } from 'playwright-core'

/** Computed longhands every snapshot records, in the order their values are stored. */
export const STYLE_PROPS: readonly string[] = [
  'display',
  'position',
  'box-sizing',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'overflow-x',
  'overflow-y',
  'z-index',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'justify-content',
  'align-items',
  'align-self',
  'order',
  'row-gap',
  'column-gap',
  'grid-template-columns',
  'grid-template-rows',
  'float',
  'direction',
  'contain',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'text-decoration-line',
  'white-space',
  'text-overflow',
  'text-shadow',
  'color',
  'background-color',
  'background-image',
  'opacity',
  'visibility',
  'box-shadow',
  'outline-style',
  'outline-width',
  'outline-color',
  'outline-offset',
  'transform',
  'translate',
  'rotate',
  'scale',
  'filter',
  'backdrop-filter',
  'mix-blend-mode',
  'clip-path',
  'mask-image',
]

/** Computed longhands the assembler reads to find containing blocks and clip edges and to map flow-relative declarations; never written into a snapshot. */
export const RULE_PROPS: readonly string[] = [
  'overflow-clip-margin',
  'perspective',
  'offset-path',
  'transform-style',
  'will-change',
  'content-visibility',
  'container-type',
  'writing-mode',
]

/** The names of STYLE_PROPS and of RULE_PROPS that a browser accepts. */
export interface AcceptedProps {
  readonly props: readonly string[]
  readonly ruleProps: readonly string[]
}

const accepted = new Map<string, Promise<AcceptedProps>>()

/** The subsets of STYLE_PROPS and RULE_PROPS this browser accepts, probed once per browser version. */
export function acceptedProps(session: CDPSession, browser: string): Promise<AcceptedProps> {
  let pending = accepted.get(browser)
  if (pending === undefined) {
    pending = bisect(session, [...STYLE_PROPS, ...RULE_PROPS])
      .then(split)
      .catch((error: unknown) => {
        accepted.delete(browser)
        throw error
      })
    accepted.set(browser, pending)
  }
  return pending
}

function split(names: readonly string[]): AcceptedProps {
  return {
    props: STYLE_PROPS.filter((name) => names.includes(name)),
    ruleProps: RULE_PROPS.filter((name) => names.includes(name)),
  }
}

async function bisect(session: CDPSession, names: readonly string[]): Promise<readonly string[]> {
  if (await probe(session, names)) return names
  if (names.length === 1) return []
  const half = names.length >> 1
  const head = await bisect(session, names.slice(0, half))
  const tail = await bisect(session, names.slice(half))
  return [...head, ...tail]
}

async function probe(session: CDPSession, names: readonly string[]): Promise<boolean> {
  try {
    await session.send('DOMSnapshot.captureSnapshot', { computedStyles: [...names] })
    return true
  } catch (error) {
    if (error instanceof Error && error.message.includes('invalid CSS property')) return false
    throw error
  }
}
