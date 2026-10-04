import { readdirSync, readFileSync } from 'node:fs'
import { Parser, type Node } from 'commonmark'

import { parseReport } from './parse.js'
import { renderScreenshot } from './render.js'
import { SENTENCES } from './sentences.js'

const FIXTURES = new URL('../../fixtures/report/', import.meta.url)
/** Playwright prints a text attachment in the terminal cut at this many characters. */
const TERMINAL_CUT = 300
const BLOCKS: ReadonlySet<string> = new Set(['document', 'heading', 'paragraph', 'list', 'item'])
const INLINES: ReadonlySet<string> = new Set(['text', 'code', 'softbreak'])

interface Document {
  readonly name: string
  readonly text: string
  readonly locators: ReadonlySet<string>
}

/** Every Markdown a golden run shows a reader: its report and the page of each changed screenshot. */
function documents(): Document[] {
  const cases = readdirSync(FIXTURES)
    .filter((name) => name !== 'invalid')
    .sort()
  return cases.flatMap((name) => {
    const read = (file: string): string =>
      readFileSync(new URL(`${name}/${file}`, FIXTURES), 'utf8')
    const report = parseReport(read('report.json'))
    const locators = new Set([
      ...report.causes.flatMap((c) => [c.example.locator, ...c.members.map((m) => m.locator)]),
      ...report.unexplained.flatMap((u) => u.candidates.map((c) => c.locator)),
    ])
    return [
      { name: `${name}/report.md`, text: read('report.md'), locators },
      ...report.screenshots
        .filter((s) => s.status === 'changed')
        .map((s) => ({ name: `${name}/${s.id}`, text: renderScreenshot(report, s.id), locators })),
    ]
  })
}

function nodes(root: Node): Node[] {
  const out: Node[] = []
  const walker = root.walker()
  for (let event = walker.next(); event !== null; event = walker.next()) {
    if (event.entering) out.push(event.node)
  }
  return out
}

/** What a reader sees of a line once its code spans lose their fences: CommonMark keeps the content and drops one space each side when both are there. */
function shown(source: string): string {
  return source.replace(/(?<!`)(`+)(?!`)(.*?[^`])\1(?!`)/g, (_, fence: string, content: string) =>
    fence !== '' && content.startsWith(' ') && content.endsWith(' ') && content.trim() !== ''
      ? content.slice(1, -1)
      : content
  )
}

/** The source of a paragraph or a heading, without the heading's marker. */
function sourceOf(node: Node, lines: readonly string[]): string {
  const [[first, start], [last, end]] = node.sourcepos
  const text = lines
    .slice(first - 1, last)
    .map((line, i, all) =>
      line.slice(i === 0 ? start - 1 : 0, i === all.length - 1 ? end : undefined)
    )
    .join('\n')
  return node.type === 'heading' ? text.replace(/^#+ /, '') : text
}

function seen(node: Node): string {
  let out = ''
  for (let child = node.firstChild; child !== null; child = child.next) {
    out += child.type === 'softbreak' ? '\n' : (child.literal ?? '')
  }
  return out
}

describe('Markdown of the goldens, read by the CommonMark reference parser', () => {
  const all = documents()

  it.each(all.map((d) => [d.name, d]))(
    '%s renders as written: no raw HTML, emphasis, links or nested lists',
    (_, document) => {
      const root = new Parser().parse(document.text)
      const lines = document.text.split('\n')
      for (const node of nodes(root)) {
        expect(BLOCKS.has(node.type) || INLINES.has(node.type), node.type).toBe(true)
        if (node.type === 'item') expect(node.firstChild?.type).toBe('paragraph')
        if (node.type === 'paragraph' || node.type === 'heading') {
          expect(seen(node)).toBe(shown(sourceOf(node, lines)))
        }
        if (node.type === 'code' && /^(?:getBy|locator\()/.test(node.literal ?? '')) {
          expect(document.locators).toContain(node.literal)
        }
      }
    }
  )

  it('opens a screenshot page with the first thing that changed, inside the terminal cut', () => {
    const pages = all.filter(
      (d) => !d.name.endsWith('.md') && d.text.startsWith(SENTENCES.observed)
    )
    expect(pages.length).toBeGreaterThan(0)
    for (const page of pages) {
      const [, first = ''] = page.text.split('\n')
      expect(first).toMatch(/^- /)
      expect(page.text.slice(0, TERMINAL_CUT)).toContain(`${SENTENCES.observed}\n${first}\n`)
    }
  })
})
