/// <reference lib="dom" />
import type { CDPSession } from 'playwright-core'

import type { RuleGroup } from '../raw.js'

// its own globals, so a page that patches CSSStyleDeclaration cannot change the answer
const WORLD = 'whydiff-shorthands'

const probed = new Map<string, Map<string, readonly string[]>>()

/** Names of the source declarations of the groups that came without longhands, sorted: shorthands holding a `var()` or a CSS-wide keyword, aliases and plain longhands. */
export function unexpanded(groups: readonly (readonly RuleGroup[] | null)[]): string[] {
  const names = new Set<string>()
  for (const { matched } of groups.flatMap((document) => document ?? [])) {
    const styles = [...(matched.matchedCSSRules ?? []).map(({ rule }) => rule.style)]
    if (matched.inlineStyle !== undefined) styles.push(matched.inlineStyle)
    for (const declaration of styles.flatMap((style) => style.cssProperties)) {
      if (declaration.source !== true || declaration.longhandProperties !== undefined) continue
      if (!declaration.name.startsWith('--')) names.add(declaration.name)
    }
  }
  return [...names].sort()
}

/** The longhands this browser expands each name to, an alias to its canonical name, probed once per browser version and name; a name the probe could not answer is missing. */
export async function shorthands(
  session: CDPSession,
  browser: string,
  names: readonly string[]
): Promise<ReadonlyMap<string, readonly string[]>> {
  let known = probed.get(browser)
  if (known === undefined) {
    known = new Map()
    probed.set(browser, known)
  }
  const missing = names.filter((name) => !known.has(name))
  if (missing.length > 0) {
    try {
      const answers = await probe(session, missing)
      missing.forEach((name, index) => known.set(name, answers[index] ?? []))
    } catch {
      // a page that cannot answer costs declarations their text, never the capture
    }
  }
  const out = new Map<string, readonly string[]>()
  for (const name of names) {
    const longhands = known.get(name)
    if (longhands !== undefined) out.set(name, longhands)
  }
  return out
}

async function probe(session: CDPSession, names: readonly string[]): Promise<string[][]> {
  const { frameTree } = await session.send('Page.getFrameTree')
  const { executionContextId } = await session.send('Page.createIsolatedWorld', {
    frameId: frameTree.frame.id,
    worldName: WORLD,
  })
  const { result, exceptionDetails } = await session.send('Runtime.callFunctionOn', {
    functionDeclaration: expandInPage.toString(),
    executionContextId,
    arguments: [{ value: names }],
    returnByValue: true,
  })
  if (exceptionDetails !== undefined) throw new Error(exceptionDetails.text)
  return result.value as string[][] // what expandInPage returns, by value
}

// runs inside the page: a `var()` value is accepted by every property and set on all its longhands
function expandInPage(names: readonly string[]): string[][] {
  const style = document.createElement('div').style
  return names.map((name) => {
    style.cssText = ''
    style.setProperty(name, 'var(--x)')
    return Array.from(style)
  })
}
