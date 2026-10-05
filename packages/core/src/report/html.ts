import { REPORT_MAX_CLUSTERS } from '../constants.js'
import { codeSpans, plural } from './format.js'
import { withoutImpact } from './headline.js'
import {
  causeParts,
  changedScreenshots,
  handleOf,
  noneExplained,
  runTotals,
  summaryParts,
  tailParts,
} from './render.js'
import { SENTENCES } from './sentences.js'
import type { CauseV1, RenderOptions, ReportV1 } from './types.js'

const COMMAND = 'npx whydiff explain'
const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
}
// Nothing loads and nothing runs, whatever a title from the run holds: the page is styles and text only.
const POLICY = "default-src 'none'; style-src 'unsafe-inline'"
const STYLE = `:root{color-scheme:light dark;--fg:#1f2328;--muted:#59636e;--line:#d1d9e0;--code:#eff2f5;--accent:#0969da;--bg:#ffffff}
@media (prefers-color-scheme:dark){:root{--fg:#e6edf3;--muted:#9198a1;--line:#3d444d;--code:#212830;--accent:#4493f8;--bg:#0d1117}}
*{box-sizing:border-box}
body{margin:0 auto;max-width:64rem;padding:2rem 1.25rem 4rem;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);background:var(--bg)}
h1{font-size:1.75rem;line-height:1.25;margin:.25rem 0}
h2{font-size:1.125rem;line-height:1.4;margin:0 0 .5rem}
a{color:var(--accent)}
code{font:.875em/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code);padding:.1em .3em;border-radius:4px;overflow-wrap:anywhere}
ul,ol{margin:.25rem 0 .75rem;padding-left:1.5rem}
li{margin:.2rem 0}
.tool,.meta,.impact,.id,.where,.handle,footer{color:var(--muted)}
.impact{font-weight:400}
.tool{margin:0;font-weight:600;letter-spacing:.04em}
.meta{margin:0 0 2rem}
.summary{border:1px solid var(--line);border-radius:8px;padding:1rem 1.25rem;margin-bottom:2.5rem}
.summary p{margin:0}
.summary ol{margin:.5rem 0}
.cause{border-top:1px solid var(--line);padding:1.25rem 0 .75rem}
.id{font-weight:400;font-size:.875rem;margin-left:.5rem}
.example{margin:.25rem 0 .5rem}
.fix{margin:.5rem 0}
.handle{font-size:.875rem;margin:.5rem 0 0}
details{margin:.5rem 0}
summary{cursor:pointer;color:var(--accent)}
.more>summary,.tail>summary{font-size:1.125rem;font-weight:600;color:var(--fg);margin:1.5rem 0 .5rem}
footer{border-top:1px solid var(--line);margin-top:2.5rem;padding-top:1rem;font-size:.875rem}`

/** The run as one static HTML page that a person reads first: the summary, each cause with its headline, example, rule, where a fix goes and the screenshots it is on, then the unexplained regions grouped; inline styles only, no script, nothing loaded, the same bytes for the same report. */
export function renderRunPage(report: ReportV1, options: RenderOptions = {}): string {
  const { summary } = report
  const failed = summary.screenshots.changed === 0 ? (options.failed ?? 0) : 0
  const changed =
    failed > 0 ? noneExplained(failed) : changedScreenshots(report, options.totalUnknown ?? false)
  const sections =
    failed > 0
      ? [`<p>${escape(SENTENCES.noneExplained('in report.md'))}</p>`]
      : summary.screenshots.changed === 0
        ? [
            `<p>${escape(SENTENCES.noChange(pixelsOf(report)))}</p>`,
            `<p>${escape(SENTENCES.noChangeChecklist)}</p>`,
          ]
        : [summarySection(report), causesSection(report), tailSection(report)]
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    `<title>${escape(`whydiff: ${changed}`)}</title>`,
    `<style>\n${STYLE}\n</style>`,
    '</head>',
    '<body>',
    '<header>',
    '<p class="tool">whydiff</p>',
    `<h1>${escape(changed)}</h1>`,
    `<p class="meta">${escape(metaLine(report))}</p>`,
    '</header>',
    '<main>',
    ...sections.filter((section) => section !== ''),
    '</main>',
    `<footer>Every field of this run is in <code>report.json</code> next to this page; a cause, a screenshot or a region by its id: <code>${escape(COMMAND)} &lt;id&gt;</code>.</footer>`,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

/** `whydiff compared main with feat/x in chromium 147 at 1000x800 and found 3 causes and 38 unexplained regions.` */
function metaLine(report: ReportV1): string {
  const { summary, compared } = report
  const where = [
    compared.browser === undefined ? '' : ` in ${compared.browser}`,
    compared.viewport === undefined ? '' : ` at ${compared.viewport}`,
  ].join('')
  return `whydiff compared ${compared.before} with ${compared.after}${where} and found ${plural(summary.causes, 'cause')} and ${plural(summary.unexplained, 'unexplained region')}.`
}

function summarySection(report: ReportV1): string {
  const { lead, top, rest } = summaryParts(report)
  return [
    '<section class="summary">',
    `<p>${inline(lead)}</p>`,
    ...(top.length === 0
      ? []
      : [
          '<ol>',
          ...top.map((c) => `<li><a href="#${escape(c.id)}">${inline(c.headline)}</a></li>`),
          '</ol>',
        ]),
    ...(rest === null ? [] : [`<p>${inline(rest)}</p>`]),
    '</section>',
  ].join('\n')
}

function causesSection(report: ReportV1): string {
  const shown = report.causes.slice(0, REPORT_MAX_CLUSTERS)
  const rest = report.causes.slice(REPORT_MAX_CLUSTERS)
  return [
    '<section class="causes">',
    ...shown.map((cause) => causeArticle(cause, report)),
    ...(rest.length === 0
      ? []
      : [
          '<details class="more">',
          `<summary>${escape(`${plural(rest.length, 'more cause')}, ordered by changed pixels`)}</summary>`,
          ...rest.map((cause) => causeArticle(cause, report)),
          '</details>',
        ]),
    '</section>',
  ].join('\n')
}

function causeArticle(cause: CauseV1, report: ReportV1): string {
  const parts = causeParts(cause, report)
  const list = (name: string, lines: readonly string[]): string[] =>
    lines.length === 0
      ? []
      : [`<ul class="${name}">`, ...lines.map((line) => `<li>${inline(line)}</li>`), '</ul>']
  // the claim reads first, its share of the run quieter after it
  const claim = withoutImpact(cause, runTotals(report))
  const after = parts.heading.slice(claim.length)
  return [
    `<article class="cause" id="${escape(cause.id)}">`,
    `<h2>${inline(claim)}<span class="impact">${inline(after)}</span><span class="id">${inline(handleOf(cause))}</span></h2>`,
    `<p class="example">${inline(parts.example)}</p>`,
    ...list('why', parts.why),
    ...list('effects', parts.effects),
    ...(parts.ambiguous === null ? [] : [`<p>${inline(parts.ambiguous)}</p>`]),
    ...(parts.restore === null ? [] : [`<p class="fix">${inline(parts.restore)}</p>`]),
    screenshotList(cause, report),
    ...(parts.occurrences === null ? [] : [`<p class="handle">${inline(parts.occurrences)}</p>`]),
    '</article>',
  ].join('\n')
}

/** The screenshots a cause is on, in report order, with where each comes from and how many members it has there. */
function screenshotList(cause: CauseV1, report: ReportV1): string {
  const items = report.screenshots.flatMap((screenshot) => {
    const here = cause.members.filter((m) => m.screenshot === screenshot.id).length
    if (here === 0) return []
    const where = [
      screenshot.file === undefined
        ? undefined
        : `${screenshot.file}${screenshot.line === undefined ? '' : `:${String(screenshot.line)}`}`,
      screenshot.project,
    ].filter((part): part is string => part !== undefined && part !== '')
    return [
      `<li>${escape(screenshot.title)}${where.length === 0 ? '' : ` <span class="where">${escape(where.join(', '))}</span>`} <span class="id">${escape(`${screenshot.id}, ${plural(here, 'element')}`)}</span></li>`,
    ]
  })
  return [
    '<details>',
    `<summary>${escape(`on ${plural(items.length, 'screenshot')}`)}</summary>`,
    '<ul>',
    ...items,
    '</ul>',
    '</details>',
  ].join('\n')
}

function tailSection(report: ReportV1): string {
  const { groups, notes } = tailParts(report, COMMAND)
  if (groups.length === 0 && notes.length === 0) return ''
  const on = new Set(report.unexplained.map((u) => u.screenshot)).size
  const title =
    groups.length === 0
      ? plural(notes.length, 'screenshot note')
      : `${plural(report.unexplained.length, 'unexplained region')} on ${plural(on, 'screenshot')}`
  return [
    '<details class="tail">',
    `<summary>${escape(title)}</summary>`,
    ...(groups.length === 0
      ? []
      : [
          ...SENTENCES.unexplainedIntro.map((sentence) => `<p>${escape(sentence)}</p>`),
          '<ul>',
          ...groups.map((group) => `<li>${inline(group)}</li>`),
          '</ul>',
        ]),
    ...(notes.length === 0
      ? []
      : ['<ul class="notes">', ...notes.map((note) => `<li>${inline(note)}</li>`), '</ul>']),
    '</details>',
  ].join('\n')
}

function pixelsOf(report: ReportV1): number {
  return report.screenshots.reduce((sum, s) => sum + s.width * s.height, 0)
}

/** Markdown text whydiff wrote, as HTML: its code spans as code elements, as CommonMark reads them, and everything else as text. */
export function inline(text: string): string {
  return codeSpans(text)
    .map((span) => (span.code ? `<code>${escape(span.text)}</code>` : escape(span.text)))
    .join('')
}

/** Text as HTML, for an element's content and a quoted attribute alike. */
export function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)
}
