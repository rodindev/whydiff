import type { RawLayer, RawSheet } from '../raw.js'

const HIDDEN = /\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*'|url\([^)]*\)/gi
// with urls and strings blanked, a bare `layer` right after `@import` follows only spaces
const ANONYMOUS_LAYER = /@layer\s*\{|@import\s+layer(?![\w(-])/gi
const ANONYMOUS = '<anonymous>'

/** Offsets where a sheet's anonymous layers start, in source order: `@layer` blocks without a name and `@import`s with a bare `layer`. */
export function anonymousLayers(cssText: string): number[] {
  const text = cssText.replace(HIDDEN, (hidden) => ' '.repeat(hidden.length))
  return [...text.matchAll(ANONYMOUS_LAYER)].map((match) => match.index)
}

/** Names one segment of a rule's layer path. */
export type LayerNamer = (layer: RawLayer) => string

interface SheetOffsets {
  readonly lines: readonly number[]
  readonly anonymous: readonly number[]
}

/** Layer segment names for one capture: a named layer keeps its name, an anonymous one reads `<anonymous #n>`, the n-th in the sheet that declares it, or `<anonymous>` without a position. */
export function layerNamer(sheets: readonly RawSheet[]): LayerNamer {
  const texts = new Map(sheets.map((sheet) => [sheet.styleSheetId, sheet.text]))
  const offsets = new Map<string, SheetOffsets>()
  return ({ text, styleSheetId = '', range }) => {
    if (text !== '') return text
    const sheet = texts.get(styleSheetId)
    if (sheet === undefined || range === undefined) return ANONYMOUS
    let known = offsets.get(styleSheetId)
    if (known === undefined) {
      known = { lines: lineStarts(sheet), anonymous: anonymousLayers(sheet) }
      offsets.set(styleSheetId, known)
    }
    const at = (known.lines[range.startLine] ?? sheet.length) + range.startColumn
    const n = known.anonymous.filter((start) => start <= at).length
    return n === 0 ? ANONYMOUS : `<anonymous #${String(n)}>`
  }
}

// the protocol counts lines by `\n` alone
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) starts.push(at + 1)
  return starts
}
