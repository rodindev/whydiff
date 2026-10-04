import { readdirSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { chromium, type Browser, type Locator, type Page } from 'playwright-core'
import { locatorFor, type NodeV1, type SnapshotV1 } from '@whydiff/core'

import { captureSnapshot } from './capture.js'
import { startFixtureServer, type FixtureServer } from './testing/server.js'

const PAGES = new URL('../fixtures/pages/', import.meta.url)
const PATHS = ['', 'adversarial/', 'locators/']
  .flatMap((folder) =>
    readdirSync(new URL(folder, PAGES))
      .filter((name) => name.endsWith('.html'))
      .map((name) => `${folder}${name}`)
  )
  // the stress pages repeat one row thousands of times; they time the capture, not the locators
  .filter((path) => !path.startsWith('adversarial/stress-'))
  .sort()
const ORACLE = 'data-oracle'
const NO_BOX =
  'an element without a box is no node of the snapshot, yet css counts it among the twins'

/** Locators that miss by page, with the reason the snapshot cannot do better. */
const KNOWN: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
  [
    'adversarial/details.html',
    new Map([
      ["locator('div').nth(1)", `${NO_BOX}: the content of a closed details element`],
      ["locator('div').nth(2)", `${NO_BOX}: the content of a closed details element`],
    ]),
  ],
  [
    'adversarial/display-contents.html',
    new Map([["locator('div').nth(6)", `${NO_BOX}: a display: contents div`]]),
  ],
  [
    'adversarial/iframes.html',
    new Map([
      ["locator('#far').contentFrame().locator('html')", 'a lazy frame that never loads'],
      ["locator('#far').contentFrame().locator('body')", 'a lazy frame that never loads'],
    ]),
  ],
])

let browser: Browser
let server: FixtureServer
let page: Page

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
  await Promise.all([browser.close(), server.close()])
}, 60_000)

beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
})

afterEach(async () => {
  await page.close()
})

/** Gives every element of every frame and open shadow root an oracle id; returns the test ids by oracle id. */
async function mark(): Promise<Map<string, string>> {
  const testIds = new Map<string, string>()
  for (const [index, frame] of page.frames().entries()) {
    // a lazy frame far below the viewport never loads: there is no document to mark
    if (frame.url() === '') continue
    const pairs = await frame.evaluate(
      ({ attribute, prefix }) => {
        const out: [string, string][] = []
        let count = 0
        const visit = (root: Document | ShadowRoot): void => {
          for (const element of root.querySelectorAll('*')) {
            const id = `${prefix}-${String(count++)}`
            element.setAttribute(attribute, id)
            const testId = element.getAttribute('data-testid')
            if (testId !== null) out.push([id, testId])
            if (element.shadowRoot !== null) visit(element.shadowRoot)
          }
        }
        visit(document)
        return out
      },
      { attribute: ORACLE, prefix: String(index) }
    )
    for (const [id, testId] of pairs) testIds.set(id, testId)
  }
  return testIds
}

/** The snapshot as a default capture records it: the page's own test ids in place of the oracle ids. */
function withTestIds(snapshot: SnapshotV1, testIds: ReadonlyMap<string, string>): SnapshotV1 {
  const nodes = snapshot.nodes.map(({ testId: oracle, ...node }): NodeV1 => {
    const testId = oracle === undefined ? undefined : testIds.get(oracle)
    return testId === undefined ? node : { ...node, testId }
  })
  return { ...snapshot, nodes }
}

/** The oracle id a locator should find: the node's own, else that of the nearest element a page script could mark. */
function expected(index: number, oracle: SnapshotV1): string | null {
  for (let at = oracle.nodes[index]; at !== undefined; at = oracle.nodes[at.p]) {
    if (at.testId !== undefined) return at.testId
  }
  return null
}

async function resolve(locator: string): Promise<string> {
  try {
    // run as the code a user pastes after `page.`, the printed locator builds a Locator
    const found = runInNewContext(`page.${locator}`, { page }) as Locator
    const ids = await found.evaluateAll(
      (elements, attribute) => elements.map((element) => element.getAttribute(attribute) ?? '-'),
      ORACLE
    )
    return ids.join(',') || 'nothing'
  } catch (error) {
    return error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)
  }
}

describe('locatorFor in Chromium', { timeout: 120_000 }, () => {
  it.each(PATHS)('finds every node of %s', async (path) => {
    await page.goto(server.url(`/${path}`))
    const testIds = await mark()
    const oracle = await captureSnapshot(page, { testIdAttribute: ORACLE })
    const snapshot = withTestIds(oracle, testIds)
    const misses = new Map<string, string>()
    for (const node of snapshot.nodes) {
      const locator = locatorFor(node, snapshot)
      const want = expected(node.i, oracle)
      const found = want === null ? 'unmarked' : await resolve(locator)
      if (found !== want)
        misses.set(locator, `${String(node.i)} ${node.tag}: ${found}, want ${String(want)}`)
    }
    expect([...misses.keys()].sort(), [...misses.values()].join('\n')).toEqual(
      [...(KNOWN.get(path)?.keys() ?? [])].sort()
    )
  })
})
