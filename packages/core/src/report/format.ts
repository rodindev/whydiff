/** Characters that can start Markdown markup in the middle of a line: an escape, a code span, emphasis, strikethrough, raw HTML, a link or an entity; an underscore inside a word never does. */
const MARKUP = /[\\`*~<[&]|(?:^|[^A-Za-z0-9])_|_(?:$|[^A-Za-z0-9])/
const BACKTICKS = /`+/g
// A character a reader sees: not white space, a control or format character, nor a private-use one,
// where icon fonts put their glyphs.
const SEEN = /[^\s\p{Cc}\p{Cf}\p{Co}]/u

/** Whether a name or a text holds a character a reader sees; an icon glyph or blank alone is no name. */
export function readable(text: string): boolean {
  return SEEN.test(text)
}

/** Thousands separated by commas without Intl, so the output is the same on every platform. */
export function count(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Strings in code unit order, without the locale, so every list the report sorts comes out the same on every platform. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** `1 cause`, `2 causes`; the words used here all take a plain `s`. */
export function plural(value: number, word: string): string {
  return `${count(value)} ${word}${value === 1 ? '' : 's'}`
}

/** A Markdown code span that shows `text` as written: the fence is longer than any backtick run inside, padded where the span would lose a space or a backtick. */
export function code(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  const pad =
    text.startsWith('`') ||
    text.endsWith('`') ||
    (text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '')
  return pad ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`
}

/** Text from the page or the run as Markdown shows it: as is, or in a code span when a character in it would start markup. */
export function safe(text: string): string {
  return MARKUP.test(text) ? code(text) : text
}

/** Markdown text whydiff wrote, cut into its code spans and the text between them, as CommonMark reads them: a backtick run opens a span the next run of the same length closes, one space is stripped from each end when both ends have one, and a run nothing closes is text. */
export function codeSpans(text: string): { readonly text: string; readonly code: boolean }[] {
  const runs = [...text.matchAll(BACKTICKS)].map((run) => ({
    at: run.index,
    length: run[0].length,
  }))
  const out: { text: string; code: boolean }[] = []
  let at = 0
  for (let open = 0; open < runs.length; open++) {
    const fence = runs[open]
    if (fence === undefined || fence.at < at) continue
    const close = runs.findIndex((run, index) => index > open && run.length === fence.length)
    const end = runs[close]
    if (end === undefined) continue
    const body = text.slice(fence.at + fence.length, end.at)
    const padded = body.startsWith(' ') && body.endsWith(' ') && body.trim() !== ''
    if (fence.at > at) out.push({ text: text.slice(at, fence.at), code: false })
    out.push({ text: padded ? body.slice(1, -1) : body, code: true })
    at = end.at + end.length
    open = close
  }
  if (at < text.length) out.push({ text: text.slice(at), code: false })
  return out
}

/** Markdown text whydiff wrote as plain text: its code spans without their fences. */
export function plain(text: string): string {
  return codeSpans(text)
    .map((span) => span.text)
    .join('')
}

/** Text in double quotes, made safe for Markdown: `"Save"`, or a code span when the text holds markup. */
export function quoted(text: string): string {
  return safe(JSON.stringify(text))
}
