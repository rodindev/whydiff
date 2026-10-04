import { ROLLUP_HASH_LENGTH, SHEET_HASH_LENGTH, SHEET_HASH_SUFFIXES } from '../constants.js'
import type { RuleV1, SnapshotV1 } from './types.js'

const SEPARATOR = /[?#]/
const EXTENSION = '.css'
const HASH_CHARS = /^[A-Za-z0-9_]+$/
const ROLLUP_CHARS = /^[A-Za-z0-9_-]+$/
const HASH_MARK = /[0-9A-Z_]/
const DIGIT = /[0-9]/
const SEPARATED = /[-.]$/
const LOWERCASE = /^[a-z0-9-]+$/
const HEX = /^[0-9a-f]+$/

/** The basename of a linked sheet's href with a content hash read as `*` unless another file of the snapshot reads the same, `<style> #n` by owner order, or `constructed #n`. */
export function sheetName(snapshot: SnapshotV1, index: number): string {
  const sheet = snapshot.sheets[index]
  if (sheet === undefined) return 'unknown sheet'
  if (sheet.href !== undefined) {
    const name = basename(sheet.href)
    const stripped = withoutHash(name)
    const others = snapshot.sheets.flatMap((s) => (s.href === undefined ? [] : [basename(s.href)]))
    const shared = others.some((other) => other !== name && withoutHash(other) === stripped)
    return shared ? name : stripped
  }
  const inline = sheet.inline === true
  const ordinal = snapshot.sheets
    .slice(0, index + 1)
    .filter((s) => s.href === undefined && (s.inline === true) === inline).length
  return `${inline ? '<style>' : 'constructed'} #${String(ordinal)}`
}

const ruleSheets = new WeakMap<SnapshotV1, readonly string[]>()

/** The name of the sheet a rule comes from: as `sheetName` says it, except that a sheet named apart from another file of the snapshot by its hash reads `*` for a selector and importance that the other file does not hold, so the rule keeps its name across rebuilds. */
export function ruleSheet(snapshot: SnapshotV1, rule: number): string {
  let names = ruleSheets.get(snapshot)
  if (names === undefined) {
    names = ruleSheetNames(snapshot)
    ruleSheets.set(snapshot, names)
  }
  return names[rule] ?? 'unknown sheet'
}

function ruleSheetNames(snapshot: SnapshotV1): string[] {
  const rules = snapshot.rules ?? []
  const stems = snapshot.sheets.map((sheet) =>
    sheet.href === undefined ? undefined : withoutHash(basename(sheet.href))
  )
  const keyOf = (stem: string, rule: RuleV1): string =>
    `${stem}|${rule.selector}|${rule.important === true ? '!' : ''}`
  const holders = new Map<string, Set<number>>()
  for (const rule of rules) {
    const stem = stems[rule.sheet ?? -1]
    if (stem === undefined || rule.sheet === undefined) continue
    const key = keyOf(stem, rule)
    holders.set(key, (holders.get(key) ?? new Set()).add(rule.sheet))
  }
  return rules.map((rule) => {
    const stem = stems[rule.sheet ?? -1]
    return stem !== undefined && (holders.get(keyOf(stem, rule))?.size ?? 0) < 2
      ? stem
      : sheetName(snapshot, rule.sheet ?? -1)
  })
}

function basename(href: string): string {
  const path = href.split(SEPARATOR)[0] ?? ''
  return path.slice(path.lastIndexOf('/') + 1) || href
}

/** Whether a sheet name is a bundler's output: its content hash read as `*`, or kept because another file of the snapshot reads the same without it. */
export function builtName(name: string): boolean {
  return name.includes('*') || withoutHash(name) !== name
}

/** `index-DNgj_66d.css`, `_layout.DHzLV-Oq.css` and `main.3f9a2c1b.chunk.css` read as `index-*.css`, `_layout.*.css` and `main.*.chunk.css`, so a rebuilt bundle keeps its name. */
function withoutHash(name: string): string {
  if (!name.endsWith(EXTENSION)) return name
  const full = name.slice(0, -EXTENSION.length)
  const suffix = SHEET_HASH_SUFFIXES.find((s) => full.endsWith(`.${s}`))
  const stem = suffix === undefined ? full : full.slice(0, -suffix.length - 1)
  const end = name.slice(stem.length)
  const tail = stem.slice(-ROLLUP_HASH_LENGTH)
  const head = stem.slice(0, -ROLLUP_HASH_LENGTH)
  if (tail.includes('-') && head.length > 1 && SEPARATED.test(head) && isHash(tail, ROLLUP_CHARS)) {
    return `${head}*${end}`
  }
  const start = Math.max(stem.lastIndexOf('-'), stem.lastIndexOf('.')) + 1
  const segment = stem.slice(start)
  // A whole name needs a digit, so `Header.css` and `global_styles.css` keep theirs.
  const hashed = isHash(segment, HASH_CHARS) && (start > 0 || DIGIT.test(segment))
  return hashed ? `${stem.slice(0, start)}*${end}` : name
}

function isHash(segment: string, chars: RegExp): boolean {
  return (
    segment.length >= SHEET_HASH_LENGTH.min &&
    segment.length <= SHEET_HASH_LENGTH.max &&
    chars.test(segment) &&
    HASH_MARK.test(segment) &&
    // Lowercase letters and digits alone are a hash only in hex, so `theme-dark12.css` keeps its name.
    (!LOWERCASE.test(segment) || HEX.test(segment))
  )
}
