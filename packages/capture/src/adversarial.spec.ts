import { readdirSync, readFileSync } from 'node:fs'
import { chromium, type Browser, type Page } from 'playwright-core'
import {
  parseSnapshot,
  serializeSnapshot,
  type NodeV1,
  type Rect,
  type SnapshotV1,
} from '@whydiff/core'

import { captureSnapshot } from './capture.js'
import { closeSessions, openSessions } from './protocol/sessions.js'
import { colorBox, decodePng } from './testing/png.js'
import { startFixtureServer, type FixtureServer } from './testing/server.js'

const FOLDER = new URL('../fixtures/pages/adversarial/', import.meta.url)
const PAGES = readdirSync(FOLDER)
  .filter((name) => name.endsWith('.html'))
  .sort()
const VIEWPORT = /<meta name="whydiff-viewport" content="(\d+)x(\d+)">/
const FULL_PAGE = '<meta name="whydiff-screenshot" content="full-page">'
const EXPECT_ATTRIBUTES = [
  'data-expect',
  'data-expect-flag',
  'data-expect-scroll',
  'data-expect-text',
]
const INVISIBLE: ReadonlySet<string> = new Set(['clipped', 'hidden'])
const TOLERANCE = 1

const KNOWN_WRONG: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
  [
    'clip-path.html',
    new Map([
      ['cp-cut', 'not flagged clipped: clip-path is not a clip source'],
      ['cp-corner', 'not flagged clipped: clip-path is not a clip source'],
      ['cp-rect', 'not flagged clipped: the clip property is not a clip source'],
    ]),
  ],
  [
    'ellipsis.html',
    new Map([['el-3', 'not flagged clipped: text-overflow hides a box that still meets the line']]),
  ],
  ['first-letter.html', new Map([['fl-text', 'text drops the letter ::first-letter renders']])],
  [
    'frame-in-transform.html',
    new Map([
      ['ft-scale', 'off by 20 px: the frame offset ignores the scale of an ancestor'],
      ['ft-rotate', 'off by 40 px: the frame offset ignores the rotation of an ancestor'],
    ]),
  ],
  [
    'hidden-variants.html',
    new Map([
      ['hv-filter', 'not flagged hidden: the hidden flag does not look at filter'],
      [
        'hv-filter-child',
        'not flagged hidden: the hidden flag does not look at an ancestor filter',
      ],
      ['hv-mask', 'not flagged hidden: the hidden flag does not look at mask-image'],
      ['hv-zero-alpha', 'not flagged hidden: only an opacity of exactly 0 counts'],
    ]),
  ],
  [
    'overflow-border.html',
    new Map([['in-corner', 'not flagged clipped: the clip ignores border-radius']]),
  ],
  [
    'paint-containment.html',
    new Map([
      ['pc-out', 'not flagged clipped: contain: paint is not a clip source'],
      ['cva-out', 'not flagged clipped: content-visibility: auto is not a clip source'],
      ['cs-out', 'not flagged clipped: contain: strict is not a clip source'],
    ]),
  ],
  [
    'rtl-full-page.html',
    new Map([
      ['rf-a', 'off by 1000 px: the full-page origin ignores the scroll origin of rtl'],
      ['rf-b', 'off by 1000 px: the full-page origin ignores the scroll origin of rtl'],
    ]),
  ],
  [
    'svg.html',
    new Map([['svg-outside', 'not flagged clipped: a nested svg clips to its content bounds']]),
  ],
  [
    'table-collapse.html',
    new Map([
      ['t12', 'not flagged hidden: a collapsed column does not reach its cells'],
      ['t23', 'not flagged hidden: a visible child of a collapsed row is not painted'],
    ]),
  ],
  [
    'zoom-frame.html',
    new Map([['zf-inset', 'off by 10 px: the iframe border and padding are read unzoomed']]),
  ],
  [
    'zoom.html',
    new Map([['z-scroller', 'scroll rect in the scroller own unzoomed px, not in page px']]),
  ],
])

interface Expectation {
  readonly id: string
  readonly color: string | null
  readonly box: Rect | null
  readonly flags: readonly string[]
  readonly scroll: Rect | null
  readonly text: string | null
}

interface DomNode {
  readonly attributes?: readonly string[]
  readonly children?: readonly DomNode[]
  readonly shadowRoots?: readonly DomNode[]
  readonly contentDocument?: DomNode
}

interface Shot {
  readonly fullPage: boolean
  readonly animations: 'disabled'
  readonly caret: 'hide'
  readonly scale: 'css'
}

interface PageRun {
  readonly snapshot: SnapshotV1
  readonly expectations: readonly Expectation[]
  readonly painted: ReadonlyMap<string, Rect | null>
  readonly ms: number
  readonly bytes: number
}

let browser: Browser
let server: FixtureServer
const runs: [string, PageRun][] = []

beforeAll(async () => {
  ;[browser, server] = await Promise.all([
    chromium.launch(
      process.env.WHYDIFF_CHROMIUM === undefined
        ? {}
        : { executablePath: process.env.WHYDIFF_CHROMIUM }
    ),
    startFixtureServer(),
  ])
}, 60_000)

afterAll(async () => {
  console.info(timingTable())
  await Promise.all([browser.close(), server.close()])
}, 60_000)

describe('captureSnapshot on adversarial pages', { timeout: 60_000 }, () => {
  for (const name of PAGES) {
    describe(name, () => {
      const known = KNOWN_WRONG.get(name) ?? new Map<string, string>()
      let run: PageRun

      beforeAll(async () => {
        run = await capturePage(name)
        runs.push([name, run])
      }, 120_000)

      it('paints every marker where the page states', () => {
        const colors = run.expectations.flatMap((e) => (e.color === null ? [] : [e.color]))
        expect(colors.filter((color, index) => colors.indexOf(color) !== index)).toEqual([])
        expect(run.expectations.flatMap((e) => fixtureProblems(run, e))).toEqual([])
      })

      it('round-trips through the parser', () => {
        const text = serializeSnapshot(run.snapshot)
        const parsed = parseSnapshot(text)
        expect(parsed).toEqual(run.snapshot)
        expect(serializeSnapshot(parsed)).toBe(text)
      })

      it('lands every marker, flag, scroll rect and text', () => {
        const ids = new Set(run.expectations.map((e) => e.id))
        expect([...known.keys()].filter((id) => !ids.has(id))).toEqual([])
        const checked = run.expectations.filter((e) => !known.has(e.id))
        expect(checked.flatMap((e) => captureProblems(run, e))).toEqual([])
      })

      for (const [id, reason] of known) {
        it.fails(`#${id}: ${reason}`, () => {
          const checked = run.expectations.filter((e) => e.id === id)
          expect(checked.flatMap((e) => captureProblems(run, e))).toEqual([])
        })
      }
    })
  }
})

async function capturePage(name: string): Promise<PageRun> {
  const html = readFileSync(new URL(name, FOLDER), 'utf8')
  const size = VIEWPORT.exec(html)
  const context = await browser.newContext({
    viewport: { width: Number(size?.[1] ?? 1000), height: Number(size?.[2] ?? 700) },
  })
  try {
    const page = await context.newPage()
    await page.goto(server.url(`/adversarial/${name}`))
    await page.waitForLoadState('networkidle')
    await scrollAsAsked(page)
    const shot: Shot = {
      fullPage: html.includes(FULL_PAGE),
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    }
    const pixels = decodePng(await page.screenshot(shot))
    const start = performance.now()
    const snapshot = await captureSnapshot(page, shot)
    const ms = performance.now() - start
    const expectations = await readExpectations(page)
    const painted = new Map<string, Rect | null>()
    for (const { color } of expectations) {
      if (color !== null) painted.set(color, colorBox(pixels, color))
    }
    const bytes = Buffer.byteLength(serializeSnapshot(snapshot))
    return { snapshot, expectations, painted, ms, bytes }
  } finally {
    await context.close()
  }
}

async function scrollAsAsked(page: Page): Promise<void> {
  const scroll = await page.evaluate(() => document.documentElement.dataset.scroll ?? null)
  if (scroll === null) return
  const [x = 0, y = 0] = scroll.split(',').map(Number)
  await page.evaluate(
    (to) =>
      new Promise<void>((resolve) => {
        window.scrollTo({ left: to.x, top: to.y, behavior: 'instant' })
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve()
          })
        })
      }),
    { x, y }
  )
}

// through the protocol because a page script cannot reach into a closed shadow root
async function readExpectations(page: Page): Promise<Expectation[]> {
  const sessions = await openSessions(page)
  try {
    const found: Expectation[] = []
    for (const session of [sessions.page, ...sessions.frames.map((f) => f.cdp)]) {
      const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true })
      collect(root, found)
    }
    return found
  } finally {
    await closeSessions(sessions)
  }
}

function collect(node: DomNode, found: Expectation[]): void {
  const pairs = node.attributes ?? []
  const attributes = new Map<string, string>()
  for (let i = 0; i + 1 < pairs.length; i += 2) attributes.set(pairs[i] ?? '', pairs[i + 1] ?? '')
  if (EXPECT_ATTRIBUTES.some((name) => attributes.has(name))) {
    found.push({
      id: attributes.get('id') ?? '',
      color: attributes.get('data-color') ?? null,
      box: rect(attributes.get('data-expect')),
      flags: (attributes.get('data-expect-flag') ?? '').split(' ').filter(Boolean),
      scroll: rect(attributes.get('data-expect-scroll')),
      text: attributes.get('data-expect-text') ?? null,
    })
  }
  for (const child of [...(node.shadowRoots ?? []), ...(node.children ?? [])]) collect(child, found)
  if (node.contentDocument !== undefined) collect(node.contentDocument, found)
}

function rect(value: string | undefined): Rect | null {
  if (value === undefined) return null
  const numbers = value.split(',').map(Number)
  if (numbers.length !== 4 || numbers.some(Number.isNaN)) {
    throw new Error(`"${value}" is not x,y,w,h`)
  }
  const [x = 0, y = 0, width = 0, height = 0] = numbers
  return [x, y, width, height]
}

function fixtureProblems(run: PageRun, e: Expectation): string[] {
  if (e.id === '') return ['an element states expectations without an id']
  const painted = e.color === null ? null : (run.painted.get(e.color) ?? null)
  if (e.box !== null) {
    if (e.color === null) return [`#${e.id}: data-expect without data-color`]
    if (painted === null) return [`#${e.id}: #${e.color} is not painted`]
    return distance(painted, e.box) > TOLERANCE
      ? [`#${e.id}: painted ${format(painted)}, the page states ${format(e.box)}`]
      : []
  }
  return painted !== null && e.flags.some((flag) => INVISIBLE.has(flag))
    ? [`#${e.id}: painted ${format(painted)} although expected ${e.flags.join(' ')}`]
    : []
}

function captureProblems(run: PageRun, e: Expectation): string[] {
  const nodes = run.snapshot.nodes.filter((n) => n.id === e.id)
  if (nodes.length > 1) return [`#${e.id}: ${String(nodes.length)} nodes carry the id`]
  const node = nodes[0]
  return [
    ...boxProblems(run, e, node),
    ...e.flags.flatMap((flag) => flagProblems(run.snapshot, e.id, node, flag)),
    ...scrollProblems(e, node),
    ...textProblems(e, node),
  ]
}

function boxProblems(run: PageRun, e: Expectation, node: NodeV1 | undefined): string[] {
  const painted = e.color === null ? null : (run.painted.get(e.color) ?? null)
  if (e.box === null || painted === null) return []
  if (node === undefined) return [`#${e.id}: not in the snapshot`]
  const problems: string[] = []
  const box = onImage(run.snapshot, node)
  const off = distance(box, painted)
  if (off > TOLERANCE) {
    problems.push(
      `#${e.id}: box ${format(box)} on the image, painted ${format(painted)}, off by ${String(off)} px`
    )
  }
  const flags = (node.flags ?? []).filter((flag) => INVISIBLE.has(flag))
  if (flags.length > 0) problems.push(`#${e.id}: painted but flagged ${flags.join(' ')}`)
  return problems
}

function flagProblems(
  snapshot: SnapshotV1,
  id: string,
  node: NodeV1 | undefined,
  flag: string
): string[] {
  // an element without a layout box is not in the snapshot, which is as good as hidden
  if (node === undefined) {
    return flag === 'hidden' ? [] : [`#${id}: not in the snapshot, expected ${flag}`]
  }
  // a pseudo-element is a node of its own whose parent is the element
  const carriers = flag.startsWith('pseudo:')
    ? snapshot.nodes.filter((n) => n.p === node.i)
    : [node]
  if (carriers.some((n) => (n.flags ?? []).some((f) => f === flag))) return []
  return [`#${id}: not flagged ${flag} (flags: ${(node.flags ?? []).join(' ') || 'none'})`]
}

function scrollProblems(e: Expectation, node: NodeV1 | undefined): string[] {
  if (e.scroll === null) return []
  if (node?.scroll === undefined) return [`#${e.id}: no scroll rect, expected ${format(e.scroll)}`]
  return distance(node.scroll, e.scroll) > TOLERANCE
    ? [`#${e.id}: scroll ${format(node.scroll)}, expected ${format(e.scroll)}`]
    : []
}

function textProblems(e: Expectation, node: NodeV1 | undefined): string[] {
  if (e.text === null) return []
  const text = node?.text ?? null
  return text === e.text
    ? []
    : [`#${e.id}: text ${JSON.stringify(text)}, expected ${JSON.stringify(e.text)}`]
}

function onImage(snapshot: SnapshotV1, node: NodeV1): Rect {
  const { origin, k } = snapshot.image
  return [
    (node.box[0] - origin[0]) * k,
    (node.box[1] - origin[1]) * k,
    node.box[2] * k,
    node.box[3] * k,
  ]
}

function distance(a: Rect, b: Rect): number {
  return Math.max(...a.map((value, i) => Math.abs(value - (b[i] ?? 0))))
}

function format(r: Rect): string {
  return r.join(',')
}

function timingTable(): string {
  const header = ['page', 'expectations', 'nodes', 'capture ms', 'snapshot bytes']
  const rows = runs.map(([name, run]) => [
    name,
    String(run.expectations.length),
    String(run.snapshot.nodes.length),
    run.ms.toFixed(1),
    String(run.bytes),
  ])
  return [header, ...rows]
    .map((row) => row.map((cell, i) => (i === 0 ? cell.padEnd(34) : cell.padStart(15))).join(''))
    .join('\n')
}
