/** The selectors of a selector list as written, split at its top-level commas: `:is(.a, .b)` and `[title="a,b"]` stay whole. */
export function selectorList(selector: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i]
    if (char === '\\') i++
    else if (quote !== '') quote = char === quote ? '' : quote
    else if (char === '"' || char === "'") quote = char
    else if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    else if (char === ',' && depth === 0) {
      out.push(selector.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(selector.slice(start).trim())
  return out
}

/** The element one selector of a list styles: the classes of its last compound and of each compound before it, unescaped and outside functional pseudo-classes. */
export interface SelectorSubject {
  readonly classes: readonly string[]
  readonly context: readonly (readonly string[])[]
  /** A type selector in the last compound. */
  readonly typed: boolean
  /** A combinator, type, id or attribute narrows the last compound. */
  readonly qualified: boolean
}

const IDENT = /^(?:\\[0-9a-fA-F]{1,6}\s?|\\.|[\w\-\u0080-\uffff])+/
const HEX_ESCAPE = /^\\([0-9a-fA-F]{1,6})\s?$/
const COMBINATOR = /[\s>+~]/

/** The subject of one complex selector, such as one item of `selectorList`. */
export function selectorSubject(selector: string): SelectorSubject {
  let classes: string[] = []
  const context: string[][] = []
  let typed = false
  let qualified = false
  let i = 0
  const text = selector.trim()
  while (i < text.length) {
    const char = text[i] ?? ''
    if (char === '.' || char === '#') {
      const ident = IDENT.exec(text.slice(i + 1))?.[0] ?? ''
      if (char === '.') classes.push(unescape(ident))
      else qualified = true
      i += 1 + ident.length
    } else if (char === ':') {
      i = pseudoEnd(text, i)
    } else if (char === '[') {
      qualified = true
      i = closing(text, i)
    } else if (COMBINATOR.test(char)) {
      if (classes.length > 0) context.push(classes)
      classes = []
      typed = false
      qualified = true
      i++
    } else {
      const type = IDENT.exec(text.slice(i))?.[0] ?? ''
      if (type !== '') {
        typed = true
        qualified = true
      }
      i += Math.max(type.length, 1)
    }
  }
  return { classes, context, typed, qualified }
}

function pseudoEnd(text: string, start: number): number {
  let i = start
  while (text[i] === ':') i++
  i += IDENT.exec(text.slice(i))?.[0].length ?? 0
  return text[i] === '(' ? closing(text, i) : i
}

function closing(text: string, start: number): number {
  let depth = 0
  let quote = ''
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (char === '\\') i++
    else if (quote !== '') quote = char === quote ? '' : quote
    else if (char === '"' || char === "'") quote = char
    else if (char === '(' || char === '[') depth++
    else if ((char === ')' || char === ']') && --depth === 0) return i + 1
  }
  return text.length
}

function unescape(ident: string): string {
  return ident.replace(/\\[0-9a-fA-F]{1,6}\s?|\\./g, (escape) => {
    const hex = HEX_ESCAPE.exec(escape)?.[1]
    return hex === undefined ? escape.slice(1) : String.fromCodePoint(Number.parseInt(hex, 16))
  })
}
