import { readdirSync, readFileSync } from 'node:fs'
import fc from 'fast-check'

import { clusterCauses } from '../cluster/cluster.js'
import { button, page, screenOf } from '../testing/screens.js'
import { buildReport } from './build.js'
import { code, safe } from './format.js'
import { escape, inline, renderRunPage } from './html.js'
import { parseReport } from './parse.js'

const fixtures = new URL('../../fixtures/report/', import.meta.url)
const pages = readdirSync(fixtures, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'invalid')
  .map((entry) => entry.name)
const read = (name: string, file: string): string =>
  readFileSync(new URL(`${name}/${file}`, fixtures), 'utf8')
/** Elements HTML closes on its own. */
const VOID = new Set(['meta', 'br', 'hr', 'img', 'input', 'link'])

/** The elements of a page, as a list of what stays open after each tag; throws on a tag closed out of order. */
function balance(html: string): void {
  const open: string[] = []
  for (const [, slash = '', name = ''] of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>/g)) {
    if (VOID.has(name)) continue
    if (slash === '') open.push(name)
    else if (open.pop() !== name) throw new Error(`</${name}> closes ${open.join(' > ')}`)
  }
  if (open.length > 0) throw new Error(`left open: ${open.join(' > ')}`)
}

describe('renderRunPage', () => {
  it.each(pages)(
    'writes %s/report.html from report.json: balanced, nothing loaded, no script',
    (name) => {
      const html = renderRunPage(parseReport(read(name, 'report.json')))
      expect(html).toBe(read(name, 'report.html'))
      expect(() => {
        balance(html.replace(/^<!doctype html>\n/, ''))
      }).not.toThrow()
      expect(html).not.toMatch(/<script|<link|<img|<iframe|\bsrc=|url\(|@import|href="(?!#)/i)
      expect(html).toContain(
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`
      )
      expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<title>'))
    }
  )

  it('heads a run whose failed screenshots it holds no pair for with how many failed, in place of 0 of 0 changed', () => {
    const report = buildReport({
      version: '0.0.1',
      compared: { before: 'expected', after: 'actual' },
      screens: [],
      clusters: clusterCauses([]),
    })
    const html = renderRunPage(report, { failed: 1 })
    expect(html).toContain('<title>whydiff: 1 failed screenshot, none explained</title>')
    expect(html).toContain('<h1>1 failed screenshot, none explained</h1>')
    expect(html).toContain(
      '<p>Each is listed in report.md, under No baseline snapshot or Not explained, with what whydiff lacked to explain it.</p>'
    )
    expect(html).not.toContain('No visible change')
    expect(renderRunPage(report)).toContain('<h1>0 of 0 screenshots changed</h1>')
  })

  it('escapes what a run names: a title, a locator and a compared label', () => {
    const screens = ['s1', 's2'].map((name) =>
      screenOf(
        name,
        page([button(10, {}, `<b onclick="x">Save ${name}</b>`)]),
        page([button(10, { 'padding-left': '8px' }, `<b onclick="x">Save ${name}</b>`)]),
        [[10, 10, 80, 30]],
        { title: `renders <img src=x onerror=alert(1)> & "${name}"` }
      )
    )
    const html = renderRunPage(
      buildReport({
        version: '0.0.1',
        compared: { before: 'main', after: '<script>alert(1)</script>' },
        screens,
        clusters: clusterCauses(screens),
      })
    )
    expect(html).not.toMatch(/<script|<img|<b /)
    expect(html).toContain(
      'whydiff compared main with &lt;script&gt;alert(1)&lt;/script&gt; and found 1 cause and 0 unexplained regions.'
    )
    expect(html).toContain('renders &lt;img src=x onerror=alert(1)&gt; &amp; &quot;s1&quot;')
    expect(() => {
      balance(html.replace(/^<!doctype html>\n/, ''))
    }).not.toThrow()
  })

  it('gives the same bytes for the same report and for its text read back', () => {
    const report = parseReport(read('run', 'report.json'))
    expect(renderRunPage(report)).toBe(renderRunPage(parseReport(read('run', 'report.json'))))
  })

  it('names where a screenshot comes from without an empty project', () => {
    const screens = [
      screenOf(
        's1',
        page([button(10)]),
        page([button(10, { 'padding-left': '8px' })]),
        [[10, 10, 80, 30]],
        { file: 'tests/settings.spec.ts', line: 3, project: '' }
      ),
    ]
    const report = buildReport({
      version: '0.0.1',
      compared: { before: 'expected', after: 'actual' },
      screens,
      clusters: clusterCauses(screens),
    })
    expect(renderRunPage(report)).toContain('<span class="where">tests/settings.spec.ts:3</span>')
  })
})

describe('the golden reports', () => {
  it.each(pages)('write for example, never e.g., in %s', (name) => {
    for (const file of ['report.md', 'report.html']) expect(read(name, file)).not.toContain('e.g.')
  })
})

describe('inline', () => {
  it('turns a code span into a code element and escapes the rest, as CommonMark reads them', () => {
    expect(inline('the `<div>` is `` a`b ``, not `open')).toBe(
      'the <code>&lt;div&gt;</code> is <code>a`b</code>, not `open'
    )
    expect(inline("``` `` ``` & it's")).toBe('<code>``</code> &amp; it&#x27;s')
  })

  it('shows any text without a line break exactly, in a code span or as it is', () => {
    const text = fc.string({
      unit: fc.constantFrom('a', ' ', '`', '<', '>', '&', '"', "'", '*', '_'),
      minLength: 1,
    })
    fc.assert(
      fc.property(text, (value) => {
        expect(inline(code(value))).toBe(`<code>${escape(value)}</code>`)
        expect(inline(safe(value)).replace(/<\/?code>/g, '')).toBe(escape(value))
      })
    )
  })
})
