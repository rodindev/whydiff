import { chromium, selectors, type Browser, type BrowserContext, type Page } from 'playwright-core'
import {
  parseSnapshot,
  serializeSnapshot,
  type NodeV1,
  type Rect,
  type RuleV1,
  type SnapshotV1,
} from '@whydiff/core'

import { captureSnapshot } from './capture.js'
import {
  FRAME_SCRIPT_TIMEOUT_MS,
  FREEZE_ATTRIBUTE,
  MASK_ATTRIBUTE,
  ROOT_ATTRIBUTE,
} from './constants.js'
import type { CaptureOptions } from './options.js'
import { STYLE_PROPS } from './props.js'
import { chains, type Chain } from './testing/chains.js'
import { colorBox, decodePng, type Pixels } from './testing/png.js'
import { startFixtureServer, type FixtureServer } from './testing/server.js'

let browser: Browser
let server: FixtureServer
let context: BrowserContext
let page: Page

beforeAll(async () => {
  // `once=` finds each element for one query; the next query removes it, as a page could in between
  await selectors.register('once', () => {
    const seen = new WeakSet<Element>()
    const queryAll = (root: ParentNode, selector: string): Element[] =>
      [...root.querySelectorAll(selector)].filter((element) => {
        if (seen.has(element)) element.remove()
        seen.add(element)
        return element.isConnected
      })
    return {
      query: (root: ParentNode, selector: string) => queryAll(root, selector)[0] ?? null,
      queryAll,
    }
  })
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
  await Promise.all([browser.close(), server.close()])
}, 60_000)

beforeEach(async () => {
  context = await browser.newContext({ viewport: { width: 1000, height: 700 } })
  page = await context.newPage()
})

afterEach(async () => {
  await context.close()
})

async function open(path: string): Promise<void> {
  await page.goto(server.url(path))
  await page.waitForLoadState('networkidle')
}

/** Captures and runs the result through the public parser, so every snapshot here is also validated. */
async function capture(options: CaptureOptions = {}): Promise<SnapshotV1> {
  return parseSnapshot(serializeSnapshot(await captureSnapshot(page, options)))
}

function byId(snapshot: SnapshotV1, id: string): NodeV1 {
  const node = snapshot.nodes.find((n) => n.id === id)
  if (node === undefined) throw new Error(`no node with id ${id}`)
  return node
}

/** Node box relative to the PNG, in PNG pixels. */
function onImage(snapshot: SnapshotV1, node: NodeV1): Rect {
  const { origin, k } = snapshot.image
  return [
    (node.box[0] - origin[0]) * k,
    (node.box[1] - origin[1]) * k,
    node.box[2] * k,
    node.box[3] * k,
  ]
}

function expectPainted(pixels: Pixels, hex: string, box: Rect): void {
  const painted = colorBox(pixels, hex)
  expect(painted, hex).not.toBeNull()
  const delta = Math.max(...(painted ?? []).map((value, i) => Math.abs(value - (box[i] ?? 0))))
  expect(delta, `${hex}: painted ${String(painted)}, snapshot ${String(box)}`).toBeLessThanOrEqual(
    1
  )
}

/** The declarations of a node's row written out, by the longhand each wins. */
function declared(snapshot: SnapshotV1, id: string): Record<string, Chain> {
  const row = snapshot.uses?.[byId(snapshot, id).a ?? -1] ?? []
  const written = chains(
    { rules: snapshot.rules ?? [], declarations: snapshot.declarations ?? [] },
    row
  )
  return Object.fromEntries(written.map((chain) => [chain.prop, chain]))
}

/** Each var() of `text` replaced by what `resolve` gives for its name and its substituted fallback; null once one is invalid. */
function substitute(
  text: string,
  resolve: (name: string, fallback: string | null) => string | null
): string | null {
  const start = text.search(/var\(/i)
  if (start < 0) return text
  let depth = 0
  let comma = -1
  let end = start + 4
  for (; end < text.length; end++) {
    const char = text[end]
    if (char === '(') depth++
    else if (char === ',' && depth === 0 && comma < 0) comma = end
    else if (char === ')' && depth-- === 0) break
  }
  const name = text.slice(start + 4, comma < 0 ? end : comma).trim()
  const fallback = comma < 0 ? null : substitute(text.slice(comma + 1, end).trim(), resolve)
  const value = resolve(name, fallback)
  const rest = substitute(text.slice(end + 1), resolve)
  return value === null || rest === null ? null : text.slice(0, start) + value + rest
}

/** A custom property entry's value with every name it reads substituted from the snapshot, as the browser computes it; empty when invalid: nothing gave a value, or a name read was left out as a cycle without a fallback. */
function substituted(snapshot: SnapshotV1, index: number): string {
  const declarations = snapshot.declarations ?? []
  const entry = declarations[index]
  if (entry?.value === undefined) return ''
  const reads = new Map((entry.reads ?? []).map((read) => [declarations[read]?.prop, read]))
  const text = substitute(entry.value, (name, fallback) => {
    const read = reads.get(name)
    const value = read === undefined ? '' : substituted(snapshot, read)
    return value === '' ? fallback : value
  })
  return text ?? ''
}

/** Every custom property a recorded longhand of an element with an id reads, resolved from the snapshot and as the browser computes it on that element. */
async function tokens(snapshot: SnapshotV1): Promise<{ recorded: string[]; computed: string[] }> {
  const recorded: string[] = []
  const computed: string[] = []
  for (const node of snapshot.nodes) {
    const id = node.id
    if (id === undefined) continue
    const reads = (snapshot.uses?.[node.a ?? -1] ?? []).flatMap(
      (use) => snapshot.declarations?.[use]?.reads ?? []
    )
    const names = reads.map((read) => snapshot.declarations?.[read]?.prop ?? '')
    recorded.push(
      ...reads.map((read, at) => `#${id} ${names[at] ?? ''}: ${substituted(snapshot, read)}`)
    )
    const values = await page
      .locator(`#${id}`)
      .evaluate(
        (element, list) => list.map((name) => getComputedStyle(element).getPropertyValue(name)),
        names
      )
    computed.push(...values.map((value, at) => `#${id} ${names[at] ?? ''}: ${value}`))
  }
  return { recorded, computed }
}

describe('captureSnapshot', { timeout: 60_000 }, () => {
  it('maps every frame onto the screenshot and records how each was reached', async () => {
    await open('/frames.html')
    const pixels = decodePng(await page.screenshot())
    const snapshot = await capture({
      mask: [page.locator('#same'), page.frameLocator('#cross').locator('#marker')],
    })
    expect(snapshot.props).toEqual(STYLE_PROPS)
    expect(snapshot.frames.map((f) => f.status)).toEqual([
      'captured',
      'captured',
      'captured',
      'captured',
      'captured',
      'captured',
      'approximate',
      'captured',
    ])
    const innerOwner = snapshot.nodes.find((n) => n.tag === 'iframe' && n.f === 3)?.i
    expect(snapshot.frames.map((f) => f.owner)).toEqual([
      null,
      ...['same', 'cross', 'nested'].map((id) => byId(snapshot, id).i),
      innerOwner,
      ...['styled', 'transformed', 'scrolled'].map((id) => byId(snapshot, id).i),
    ])
    const markers = snapshot.nodes.filter((n) => n.id === 'marker')
    expect(markers).toHaveLength(7)
    const colours = ['ff0000', '00ff00', '0000ff', 'ff00ff', 'ffff00', '00ffff', 'ff8800']
    for (const [index, hex] of colours.entries()) {
      const marker = markers[index]
      if (marker === undefined || hex === '00ffff') continue
      expectPainted(pixels, hex, onImage(snapshot, marker))
    }
    expect(snapshot.masks).toEqual([byId(snapshot, 'same').box, markers[1]?.box])
  })

  it('does not wait for a lazy frame that never loaded', async () => {
    await open('/adversarial/iframes.html')
    const start = performance.now()
    const snapshot = await capture()
    expect(performance.now() - start).toBeLessThan(FRAME_SCRIPT_TIMEOUT_MS)
    expect(snapshot.frames).toHaveLength(6)
  })

  it('freezes the page the way the screenshot saw it and restores it afterwards', async () => {
    await open('/freeze.html')
    await page.waitForTimeout(300)
    const style = '#hidden { display: none !important; }'
    const options: CaptureOptions = {
      style,
      animations: 'disabled',
      caret: 'hide',
      mask: [page.locator('#shadow-spinner')],
    }
    const pixels = decodePng(
      await page.screenshot({ style, animations: 'disabled', caret: 'hide' })
    )
    const before = await page.evaluate(() => document.getAnimations().length)
    const snapshot = await capture(options)
    expectPainted(pixels, 'ff0000', onImage(snapshot, byId(snapshot, 'spinner')))
    expectPainted(pixels, '00ff00', onImage(snapshot, byId(snapshot, 'slider')))
    expectPainted(pixels, '0000ff', onImage(snapshot, byId(snapshot, 'fader')))
    expectPainted(pixels, '00ffff', onImage(snapshot, byId(snapshot, 'shadow-spinner')))
    expect(byId(snapshot, 'shadow-spinner').flags).toEqual(['shadow:open'])
    expect(snapshot.masks).toEqual([byId(snapshot, 'shadow-spinner').box])
    expect(snapshot.nodes.some((n) => n.id === 'hidden')).toBe(false)
    expect(
      await page.evaluate(
        ({ freeze, root, mask }) => ({
          animations: document.getAnimations().length,
          freezeStyles: document.querySelectorAll(`[${freeze}]`).length,
          marks: [document, document.getElementById('host')?.shadowRoot].map(
            (scope) => scope?.querySelectorAll(`[${root}], [${mask}]`).length
          ),
          hidden: getComputedStyle(document.querySelector('#hidden') ?? document.body).display,
        }),
        { freeze: FREEZE_ATTRIBUTE, root: ROOT_ATTRIBUTE, mask: MASK_ATTRIBUTE }
      )
    ).toEqual({ animations: before, freezeStyles: 0, marks: [0, 0], hidden: 'block' })
  })

  it('captures a locator the way locator.screenshot() frames it', async () => {
    await open('/root.html')
    const dialog = page.locator('#dialog')
    const pixels = decodePng(await dialog.screenshot())
    const snapshot = await capture({ root: dialog })
    expect([snapshot.image.width, snapshot.image.height]).toEqual([pixels.width, pixels.height])
    expect(snapshot.image.root).toBe(byId(snapshot, 'dialog').i)
    expect(snapshot.image.origin).toEqual([200, 900])
    expectPainted(pixels, 'ff0000', onImage(snapshot, byId(snapshot, 'inner')))
    expect(snapshot.nodes.map((n) => n.id ?? n.tag)).toEqual([
      'html',
      'body',
      'dialog',
      'inner',
      'outside',
      'toast',
    ])
    expect(snapshot.viewport.scrollY).toBeGreaterThan(0)
  })

  it('refuses a root that is not one element without waiting for it', async () => {
    await open('/root.html')
    const dialog = page.locator('#dialog')
    expect(await dialog.count()).toBe(1)
    await page.evaluate(() => document.getElementById('dialog')?.remove())
    const start = performance.now()
    await expect(capture({ root: dialog })).rejects.toThrow(
      "locator('#dialog') matches no element, and whydiff does not wait for one. Make it match the one element the screenshot shows."
    )
    await expect(capture({ root: page.locator('#far, #toast') })).rejects.toThrow(
      "locator('#far, #toast') matches 2 elements, and whydiff captures one. Make it match the one element the screenshot shows."
    )
    expect(performance.now() - start).toBeLessThan(FRAME_SCRIPT_TIMEOUT_MS)
  })

  it('refuses a root that leaves the page during the capture', async () => {
    await open('/leaving.html')
    const start = performance.now()
    await expect(capture({ root: page.locator('#dialog') })).rejects.toThrow(
      "locator('#dialog') matched one element, but it left the page or was not rendered when whydiff read it. Make it match the one element the screenshot shows."
    )
    expect(performance.now() - start).toBeLessThan(FRAME_SCRIPT_TIMEOUT_MS)
  })

  it('reads each mask with one query and never waits: a locator that matches nothing masks nothing', async () => {
    await open('/root.html')
    const start = performance.now()
    const snapshot = await capture({ mask: [page.locator('once=#toast'), page.locator('#none')] })
    expect(performance.now() - start).toBeLessThan(FRAME_SCRIPT_TIMEOUT_MS)
    expect(snapshot.masks).toEqual([byId(snapshot, 'toast').box])
  })

  it('describes a full-page screenshot at device scale', async () => {
    await context.close()
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
    })
    page = await context.newPage()
    await open('/fullpage.html')
    await page.evaluate(() => {
      window.scrollTo(0, 1200)
    })
    const pixels = decodePng(await page.screenshot({ fullPage: true, scale: 'device' }))
    const snapshot = await capture({ fullPage: true, scale: 'device' })
    expect([snapshot.image.width, snapshot.image.height, snapshot.image.k]).toEqual([
      pixels.width,
      pixels.height,
      2,
    ])
    expect(snapshot.image.layoutFactor).toBe(1)
    expectPainted(pixels, 'ff0000', onImage(snapshot, byId(snapshot, 'header')))
    expectPainted(pixels, '0000ff', onImage(snapshot, byId(snapshot, 'sticky')))
    expectPainted(pixels, '00aa00', onImage(snapshot, byId(snapshot, 'marker')))
    expect(snapshot.viewport).toEqual({ width: 1280, height: 800, scrollX: 0, scrollY: 1200 })
  })

  it('records a style element of a document without a url as an inline sheet', async () => {
    await page.setContent('<style>#card { padding-left: 4px }</style><div id="card">x</div>')
    const snapshot = await capture()
    expect(snapshot.sheets.map(({ hash, ...rest }) => ({ ...rest, hashed: hash.length }))).toEqual([
      { inline: true, hashed: 16 },
    ])
    expect(snapshot.rules?.flatMap((rule) => (rule.sheet === 0 ? [rule.selector] : []))).toEqual([
      '#card',
    ])
  })

  it('records sheets, fonts, form state, roles and visibility', async () => {
    await open('/styles.html')
    const snapshot = await capture()
    expect(snapshot.page.title).toBe('Styles')
    expect(snapshot.sheets.map(({ hash, ...rest }) => ({ ...rest, hashed: hash.length }))).toEqual([
      { href: server.url('/styles.css'), hashed: 16 },
      { inline: true, hashed: 16 },
      { inline: true, harness: true, hashed: 16 },
      { inline: true, hashed: 16 },
    ])
    const card = byId(snapshot, 'card')
    expect(card.text).toBe('Title tail')
    expect(card.font).toEqual(expect.any(String))
    const bold = snapshot.nodes.find((n) => n.tag === 'b' && n.p === card.i)
    expect(bold?.font).not.toBe(card.font)
    expect(byId(snapshot, 'wrap').lineBoxes?.length).toBeGreaterThan(1)
    expect(byId(snapshot, 'save')).toMatchObject({
      role: 'button',
      name: 'Save',
      testId: 'save-button',
    })
    expect(byId(snapshot, 'email').value).toBe('john@example.com')
    expect(byId(snapshot, 'remember').checked).toBe(true)
    expect(byId(snapshot, 'notes').value).toBe('note')
    expect(byId(snapshot, 'scroller').scroll).toEqual([0, 30, 100, 400])
    expect(byId(snapshot, 'clipped').flags).toEqual(['clipped'])
    expect(byId(snapshot, 'ghost').flags).toEqual(['hidden'])
    expect(byId(snapshot, 'faded-child').flags).toEqual(['hidden'])
    expect(byId(snapshot, 'logo').img).toHaveLength(16)
    expect(byId(snapshot, 'logo').role).toBe('img')
    expect(snapshot.styles.every((row) => row.length === snapshot.props.length)).toBe(true)
  })

  it('records the rule that won each property, one answer per style group', async () => {
    await open('/rules.html')
    const snapshot = await capture()
    expect(snapshot.sheets.map(({ hash, ...rest }) => ({ ...rest, hashed: hash.length }))).toEqual([
      { href: server.url('/rules.css'), hashed: 16 },
      { inline: true, hashed: 16 },
      { hashed: 16 },
    ])
    const authored = snapshot.rules?.filter((rule) => rule.userAgent !== true) ?? []
    expect(authored).toEqual([
      { inline: true, selector: '' },
      { sheet: 1, selector: '.card' },
      { sheet: 1, selector: '#card' },
      { sheet: 2, selector: '#card' },
      { sheet: 1, selector: '#card.card', layer: 'components' },
      { sheet: 1, selector: '.card', layer: 'base', important: true },
      { sheet: 0, selector: '.card' },
      { sheet: 1, selector: '.card::before' },
    ])
    const winners = (node: NodeV1 | undefined): Record<string, number> =>
      Object.fromEntries(
        (snapshot.attributions?.[node?.a ?? -1] ?? []).flatMap((rule, column) =>
          rule === -1
            ? []
            : [
                [
                  snapshot.props[column] ?? '',
                  authored.findIndex((entry) => entry === snapshot.rules?.[rule]),
                ],
              ]
        )
      )
    const border = (part: string, rule: number): Record<string, number> =>
      Object.fromEntries(
        ['top', 'right', 'bottom', 'left'].map((side) => [`border-${side}-${part}`, rule])
      )
    const card = byId(snapshot, 'card')
    expect(winners(card)).toEqual({
      'margin-left': 0,
      'padding-left': 1,
      ...border('width', 2),
      ...border('style', 2),
      ...border('color', 2),
      'font-size': 3,
      'font-weight': 4,
      'text-align': 5,
      color: 5,
      'background-color': 6,
    })
    const before = snapshot.nodes.find((n) => n.p === card.i && n.flags?.includes('pseudo:before'))
    expect(winners(before)).toEqual({ display: 7, 'padding-left': 7 })
    expect(winners(byId(snapshot, 'child'))).toEqual({})
    expect(snapshot.uses?.[byId(snapshot, 'child').a ?? -1]).toEqual([])
    expect(snapshot.attributions?.every((row) => row.length === snapshot.props.length)).toBe(true)
  })

  it('records an anonymous cascade layer as a layer, numbered within the sheet that declares it', async () => {
    await open('/layers.html')
    const snapshot = await capture()
    const won = (from: SnapshotV1, id: string): Record<string, RuleV1 | undefined> =>
      Object.fromEntries(
        (from.attributions?.[byId(from, id).a ?? -1] ?? []).flatMap((rule, column) =>
          rule === -1 ? [] : [[from.props[column] ?? '', from.rules?.[rule]]]
        )
      )
    expect(
      Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((id) => [id, won(snapshot, id)]))
    ).toEqual({
      a: {
        'padding-left': { sheet: 0, selector: '.ui-a', layer: '<anonymous #2>' },
        'padding-top': { sheet: 0, selector: '.ui-a', layer: '<anonymous #3>' },
      },
      b: { 'padding-left': { sheet: 0, selector: '.ui-b', layer: '<anonymous #4>.inner' } },
      c: { 'padding-left': { sheet: 0, selector: '.ui-c', layer: 'outer.<anonymous #5>' } },
      d: {
        color: { sheet: 0, selector: '.ui-d' },
        'text-align': { sheet: 0, selector: '#d.ui-d', layer: '<anonymous #6>', important: true },
      },
      e: {
        'padding-left': { sheet: 1, selector: '.ui-e', layer: '<anonymous #1>' },
        'padding-top': { sheet: 1, selector: '.ui-e', layer: '<anonymous #1>.<anonymous #1>' },
      },
    })
    const d = byId(snapshot, 'd')
    expect(
      ['color', 'text-align'].map((prop) => snapshot.styles[d.s]?.[snapshot.props.indexOf(prop)])
    ).toEqual(['rgb(4, 5, 6)', 'right'])

    await page.evaluate(() => document.getElementById('a')?.remove())
    expect(won(await capture(), 'b')).toEqual(won(snapshot, 'b'))
  })

  it('leaves the hash of a sheet the browser cannot read back empty, and reads one it may take from its cache', async () => {
    const css =
      '@layer base { .ui-a { padding-left: 1px; } }\n@layer { .ui-a { padding-top: 2px; } }'
    const routed = async (headers: Record<string, string>): Promise<SnapshotV1> => {
      await page.route(server.url('/routed.css'), (route) =>
        route.fulfill({ contentType: 'text/css', headers, body: css })
      )
      await open('/routed.html')
      const snapshot = await capture()
      await page.unroute(server.url('/routed.css'))
      return snapshot
    }
    const winners = (snapshot: SnapshotV1): (RuleV1 | undefined)[] =>
      ['padding-left', 'padding-top'].map(
        (prop) =>
          snapshot.rules?.[
            snapshot.attributions?.[byId(snapshot, 'a').a ?? -1]?.[snapshot.props.indexOf(prop)] ??
              -1
          ]
      )
    const unread = await routed({})
    expect(unread.sheets).toEqual([{ href: server.url('/routed.css'), hash: '' }])
    expect(winners(unread)).toEqual([
      { sheet: 0, selector: '.ui-a', layer: 'base' },
      { sheet: 0, selector: '.ui-a', layer: '<anonymous>' },
    ])
    const cached = await routed({ 'cache-control': 'max-age=3600' })
    expect(cached.sheets.map(({ hash, ...rest }) => ({ ...rest, hashed: hash.length }))).toEqual([
      { href: server.url('/routed.css'), hashed: 16 },
    ])
    expect(winners(cached)).toEqual([
      { sheet: 0, selector: '.ui-a', layer: 'base' },
      { sheet: 0, selector: '.ui-a', layer: '<anonymous #1>' },
    ])
  })

  it('records what an element paints as Chromium computes it, with the rule that set it', async () => {
    await open('/paint.html')
    const snapshot = await capture()
    const initial: Readonly<Record<string, string>> = {
      'mask-image': 'none',
      'clip-path': 'none',
      filter: 'none',
      'backdrop-filter': 'none',
      'text-shadow': 'none',
      'mix-blend-mode': 'normal',
      'outline-style': 'none',
      'outline-offset': '0px',
    }
    const paint = Object.keys(initial)
    const probes = snapshot.nodes.filter((n) => n.id !== undefined)
    const value = (node: NodeV1, prop: string): string | undefined =>
      snapshot.styles[node.s]?.[snapshot.props.indexOf(prop)]
    expect(probes.map((node) => paint.map((prop) => value(node, prop)))).toEqual(
      await page.evaluate(
        (props) =>
          Array.from(document.querySelectorAll('[id]'), (element) => {
            const style = getComputedStyle(element)
            return props.map((prop) => style.getPropertyValue(prop))
          }),
        paint
      )
    )
    const set: Record<string, Record<string, string | undefined>> = {}
    for (const node of probes) {
      const id = node.id ?? ''
      const changed = paint.filter((prop) => value(node, prop) !== initial[prop])
      set[id] = Object.fromEntries(changed.map((prop) => [prop, value(node, prop)]))
      const row = snapshot.attributions?.[node.a ?? -1] ?? []
      for (const prop of changed) {
        const rule = snapshot.rules?.[row[snapshot.props.indexOf(prop)] ?? -1]
        expect(rule?.selector, `${id} ${prop}`).toBe(`.ui-${id}`)
      }
    }
    expect(set).toEqual({
      mask: {
        'mask-image':
          'linear-gradient(rgba(0, 0, 0, 0) 0px, rgb(0, 0, 0) 16px), linear-gradient(to right, rgba(0, 0, 0, 0), rgb(0, 0, 0) 16px)',
      },
      fade: { 'mask-image': 'linear-gradient(rgb(0, 0, 0), rgba(0, 0, 0, 0))' },
      clip: { 'clip-path': 'circle(40% at 50% 50%)' },
      filter: { filter: 'drop-shadow(rgba(0, 0, 0, 0.5) 0px 1px 2px) blur(1px)' },
      backdrop: { 'backdrop-filter': 'saturate(1.8) blur(20px)' },
      shadow: { 'text-shadow': 'rgb(255, 0, 0) 0px 1px 0px' },
      blend: { 'mix-blend-mode': 'multiply' },
      outline: { 'outline-style': 'dashed', 'outline-offset': '4px' },
      plain: {},
    })
  })

  it('follows the custom properties a winning declaration reads to the rules that declare them, as the browser resolves them', async () => {
    await open('/tokens.html')
    const snapshot = await capture()
    const theme: RuleV1 = { sheet: 0, selector: ':root', layer: 'theme' }
    const rule = (selector: string): RuleV1 => ({ sheet: 0, selector })
    const registered = (name: string): RuleV1 => rule(`@property ${name}`)
    const space: Chain = { prop: '--ui-space', rule: theme, value: '4px', inherited: true }
    const pad: Chain = {
      prop: '--ui-pad',
      rule: theme,
      value: 'calc(var(--ui-space) * 2)',
      inherited: true,
      reads: [space],
    }
    const card = declared(snapshot, 'card')
    expect(card['padding-top']).toEqual({
      prop: 'padding-top',
      rule: rule('.ui-card'),
      value: 'var(--ui-pad) calc(var(--ui-space) * 3)',
      reads: [pad, space],
    })
    expect(
      ['border-top-width', 'border-top-style', 'border-top-color', 'background-color'].map(
        (prop) => card[prop]?.reads
      )
    ).toEqual([
      [{ prop: '--ui-edge', rule: { ...theme, important: true }, value: '2px', inherited: true }],
      [
        {
          prop: '--ui-border-style',
          rule: registered('--ui-border-style'),
          value: 'solid',
          initial: true,
        },
      ],
      [
        {
          prop: '--ui-accent',
          rule: { inline: true, selector: '' },
          value: 'rgb(0, 128, 0)',
          inherited: true,
        },
      ],
      [{ prop: '--ui-surface', rule: theme, value: 'rgb(255, 255, 255)', inherited: true }],
    ])
    const dark = declared(snapshot, 'dark-card')
    expect([dark['padding-top']?.reads, dark['background-color']?.reads]).toEqual([
      [pad, { prop: '--ui-space', rule: rule('.ui-dark'), value: '8px', inherited: true }],
      [{ prop: '--ui-surface', rule: rule('.ui-dark'), value: 'rgb(20, 20, 20)', inherited: true }],
    ])
    expect(declared(snapshot, 'cycle')['margin-top']?.reads).toEqual([
      {
        prop: '--ui-a',
        rule: rule('.ui-cycle'),
        value: 'var(--ui-b)',
        reads: [{ prop: '--ui-b', rule: rule('.ui-cycle'), value: 'var(--ui-a)' }],
      },
    ])
    expect(
      [
        ['gap', 'column-gap'],
        ['tinted', 'outline-color'],
        ['outlined', 'outline-width'],
        ['inner', 'background-color'],
      ].map(([id = '', prop = '']) => declared(snapshot, id)[prop]?.reads)
    ).toEqual([
      [{ prop: '--ui-gap' }],
      [{ prop: '--ui-tint', rule: registered('--ui-tint') }],
      [{ prop: '--ui-line', value: '2px', initial: true }],
      [{ prop: '--ui-shade' }],
    ])
    const keywords = declared(snapshot, 'keywords')
    expect(
      ['color', 'background-color', 'border-top-style'].map((prop) => keywords[prop]?.reads)
    ).toEqual([
      [{ prop: '--ui-ink', rule: theme, value: 'rgb(17, 17, 17)', inherited: true }],
      [{ prop: '--ui-surface', rule: theme, value: 'rgb(255, 255, 255)', inherited: true }],
      [
        {
          prop: '--ui-border-style',
          rule: registered('--ui-border-style'),
          value: 'solid',
          initial: true,
        },
      ],
    ])
    // sampled per style group: the second child carries the chain of the first child's scope
    const marked = snapshot.nodes.filter((node) => node.cls?.includes('ui-marked'))
    expect(marked.map((node) => node.a)).toEqual([marked[0]?.a, marked[0]?.a])
    const sampled = chains(
      { rules: snapshot.rules ?? [], declarations: snapshot.declarations ?? [] },
      snapshot.uses?.[marked[0]?.a ?? -1] ?? []
    )
    expect(sampled.map((chain) => chain.reads)).toEqual([
      [{ prop: '--ui-mark', rule: rule('.ui-warm'), value: 'rgb(1, 1, 1)', inherited: true }],
    ])
    const { recorded, computed } = await tokens(snapshot)
    expect(recorded.length).toBeGreaterThan(30)
    expect(recorded).toEqual(computed)
  })

  it('attributes the utilities of a utility-first page: logical spacing to its physical sides, transforms and the tokens behind them', async () => {
    await open('/utilities.html')
    const snapshot = await capture()
    const utility = (selector: string): RuleV1 => ({ sheet: 0, selector, layer: 'utilities' })
    const won = (id: string, props: readonly string[]): (string | undefined)[] =>
      props.map((prop) => {
        const row = snapshot.attributions?.[byId(snapshot, id).a ?? -1]
        return snapshot.rules?.[row?.[snapshot.props.indexOf(prop)] ?? -1]?.selector
      })
    const padding = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']
    const reset = '*, ::before, ::after'
    expect(
      Object.fromEntries(['card', 'ring', 'rtl', 'vertical'].map((id) => [id, won(id, padding)]))
    ).toEqual({
      card: ['.ui-p-4', '.ui-px-4', '.ui-p-4', '.ui-px-4'],
      ring: ['.ui-py-2', '.ui-px-4', '.ui-py-2', '.ui-px-4'],
      rtl: [reset, '.ui-ps-2', reset, '.ui-px-4'],
      vertical: ['.ui-px-4', reset, '.ui-px-4', reset],
    })
    expect(won('rtl', ['margin-left', 'margin-right'])).toEqual(['.ui-mx-auto', '.ui-mx-auto'])
    expect(won('moved', ['margin-top', 'translate', 'rotate', 'scale'])).toEqual([
      '.ui-my-2',
      '.ui-translate-x-2',
      '.ui-rotate-3',
      '.ui-scale-95',
    ])
    const moved = byId(snapshot, 'moved')
    expect(
      ['translate', 'rotate', 'scale'].map(
        (prop) => snapshot.styles[moved.s]?.[snapshot.props.indexOf(prop)]
      )
    ).toEqual(['8px', '3deg', '0.95'])
    const theme: RuleV1 = { sheet: 0, selector: ':root, :host', layer: 'theme' }
    const spacing: Chain = { prop: '--ui-spacing', rule: theme, value: '0.25rem', inherited: true }
    const initial = (name: string, value: string): Chain => ({
      prop: name,
      rule: { sheet: 0, selector: `@property ${name}` },
      value,
      initial: true,
    })
    expect(declared(snapshot, 'card')['padding-left']).toEqual({
      prop: 'padding-left',
      rule: utility('.ui-px-4'),
      value: 'calc(var(--ui-spacing) * 4)',
      reads: [spacing],
    })
    expect(declared(snapshot, 'card')['box-shadow']?.reads).toEqual([
      initial('--ui-inset-shadow', '0 0 #0000'),
      initial('--ui-inset-ring-shadow', '0 0 #0000'),
      initial('--ui-ring-offset-shadow', '0 0 #0000'),
      initial('--ui-ring-shadow', '0 0 #0000'),
      {
        prop: '--ui-shadow',
        rule: utility('.ui-shadow-md'),
        value: '0 4px 6px -1px var(--ui-color-shadow)',
        reads: [
          { prop: '--ui-color-shadow', rule: theme, value: 'rgb(0 0 0 / 0.1)', inherited: true },
        ],
      },
    ])
    expect(declared(snapshot, 'text')['line-height']?.reads).toEqual([
      { prop: '--ui-leading', rule: { sheet: 0, selector: '@property --ui-leading' } },
      {
        prop: '--ui-text-sm--line-height',
        rule: theme,
        value: 'calc(1.25 / 0.875)',
        inherited: true,
      },
    ])
    expect(declared(snapshot, 'moved').translate?.reads).toEqual([
      {
        prop: '--ui-translate-x',
        rule: utility('.ui-translate-x-2'),
        value: 'calc(var(--ui-spacing) * 2)',
        reads: [spacing],
      },
      initial('--ui-translate-y', '0'),
    ])
    const { recorded, computed } = await tokens(snapshot)
    expect(recorded.length).toBeGreaterThan(30)
    expect(recorded).toEqual(computed)
  })

  it("records the browser's declaration a longhand takes where no author rule sets it, and the author rule once one does", async () => {
    await open('/defaults.html')
    const width = (snapshot: SnapshotV1): Record<string, unknown> => {
      const button = byId(snapshot, 'button')
      const column = snapshot.props.indexOf('border-top-width')
      return {
        value: snapshot.styles[button.s]?.[column],
        rule: snapshot.rules?.[snapshot.attributions?.[button.a ?? -1]?.[column] ?? -1],
        declared: declared(snapshot, 'button')['border-top-width'],
      }
    }
    const before = await capture()
    const browser: RuleV1 = { userAgent: true, selector: 'button' }
    expect(width(before)).toEqual({
      value: '2px',
      rule: undefined,
      declared: { prop: 'border-top-width', rule: browser, value: '2px' },
    })
    expect(declared(before, 'button')['padding-left']).toEqual({
      prop: 'padding-left',
      rule: browser,
      value: '6px',
    })
    await page.evaluate(() => {
      document.body.classList.add('ui-reset')
    })
    expect(width(await capture())).toEqual({
      value: '3px',
      rule: { sheet: 0, selector: '.ui-reset .ui-btn' },
      declared: undefined,
    })
  })

  it('keeps roles on a page of 20000 elements', async () => {
    await open('/adversarial/stress-20000.html')
    const snapshot = await capture()
    const roles = (tag: string): Set<string | undefined> =>
      new Set(snapshot.nodes.filter((n) => n.tag === tag).map((n) => n.role))
    expect(snapshot.nodes.length).toBeGreaterThan(19_000)
    expect(roles('button')).toEqual(new Set(['button']))
    expect(roles('a')).toEqual(new Set(['link']))
    expect(roles('input')).toEqual(new Set(['checkbox']))
  })

  it('produces the same bytes for the same page', async () => {
    await open('/styles.html')
    const first = serializeSnapshot(await captureSnapshot(page))
    await context.close()
    context = await browser.newContext({ viewport: { width: 1000, height: 700 } })
    page = await context.newPage()
    await open('/styles.html')
    expect(serializeSnapshot(await captureSnapshot(page))).toBe(first)
  })
})
