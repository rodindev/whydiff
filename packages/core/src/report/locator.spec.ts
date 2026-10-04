import type { NodeV1, SnapshotV1 } from '../snapshot/types.js'
import { buildSnapshot, type TreeSpec } from '../testing/snapshots.js'
import { locatorFor } from './locator.js'

function locate(spec: TreeSpec): string {
  const snapshot = buildSnapshot([spec])
  const [first] = snapshot.nodes
  if (first === undefined) throw new Error('empty tree')
  return locatorFor(first, snapshot)
}

function locateAll(snapshot: SnapshotV1): string[] {
  return snapshot.nodes.map((node) => locatorFor(node, snapshot))
}

describe('locatorFor', () => {
  it('prefers a test id', () => {
    expect(locate({ tag: 'button', testId: 'save', role: 'button', name: 'Save' })).toBe(
      "getByTestId('save')"
    )
  })

  it('uses role and name next', () => {
    expect(locate({ tag: 'button', role: 'button', name: "Don't", id: 'x' })).toBe(
      "getByRole('button', { name: 'Don\\'t' })"
    )
  })

  it('falls back to the id, then short own text', () => {
    expect(locate({ tag: 'div', id: 'main', text: 'Hello' })).toBe("locator('#main')")
    expect(locate({ tag: 'div', id: 'site-header_main' })).toBe("locator('#site-header_main')")
    expect(locate({ tag: 'p', text: 'Hello' })).toBe("getByText('Hello')")
    expect(locate({ tag: 'p', text: 'x'.repeat(41), cls: ['note'] })).toBe("locator('p.note')")
  })

  it('skips ids that look generated', () => {
    expect(locate({ tag: 'input', id: 'input-6', role: 'textbox' })).toBe("locator('input')")
    expect(locate({ tag: 'div', id: 'radix-:r1:', text: 'Menu' })).toBe("getByText('Menu')")
    expect(locate({ tag: 'div', id: 'v_12' })).toBe("locator('div')")
  })

  it('takes a test id, role and name, id or text only where it selects the node alone', () => {
    expect(
      locateAll(
        buildSnapshot([
          { tag: 'button', role: 'button', name: 'Open' },
          { tag: 'button', role: 'button', name: 'OPEN ALL' },
          { tag: 'p', text: 'Col' },
          { tag: 'p', text: 'Col two' },
          { tag: 'li', testId: 'row', id: 'dup' },
          { tag: 'li', testId: 'row', id: 'dup' },
        ])
      )
    ).toEqual([
      "locator('button').nth(0)",
      "getByRole('button', { name: 'OPEN ALL' })",
      "locator('p').nth(0)",
      "getByText('Col two')",
      "locator('li').nth(0)",
      "locator('li').nth(1)",
    ])
  })

  it('never names a role that prohibits naming and takes text only from a node that holds all of it', () => {
    expect(
      locateAll(
        buildSnapshot([
          { tag: 'dt', role: 'term', name: 'Size', text: 'Size' },
          { tag: 'p', text: 'Run and', children: [{ tag: 'code', text: 'lint' }] },
        ])
      )
    ).toEqual(["getByText('Size')", "locator('p')", "getByText('lint')"])
  })

  it('never finds an element by an own text a reader cannot see', () => {
    const texts = (text: string): string[] =>
      locateAll(
        buildSnapshot([
          { tag: 'span', text, cls: ['ui-icon'] },
          { tag: 'span', text: 'Save', cls: ['ui-label'] },
        ])
      )
    expect(['\ue901', ' \u200b '].map(texts)).toEqual(
      ['\ue901', ' \u200b '].map(() => ["locator('span.ui-icon')", "getByText('Save')"])
    )
  })

  it('never names a role by an empty, blank or icon-glyph name, which matches every element of the role', () => {
    const named = (name: string): string[] =>
      locateAll(
        buildSnapshot([
          { tag: 'button', role: 'button', name, cls: ['ui-close'] },
          { tag: 'button', role: 'button', cls: ['ui-menu'] },
        ])
      )
    expect(['', ' ', '\ue5cd'].map(named)).toEqual(
      ['', ' ', '\ue5cd'].map(() => ["locator('button.ui-close')", "locator('button.ui-menu')"])
    )
    expect(named('Close \ue5cd')[0]).toBe("getByRole('button', { name: 'Close \ue5cd' })")
  })

  it('scopes a plain css locator to the nearest specific ancestor and numbers twins', () => {
    const snapshot = buildSnapshot([
      {
        tag: 'section',
        id: 'main',
        children: [
          { tag: 'div', cls: ['card'] },
          { tag: 'div', cls: ['card'], children: [{ tag: 'p', cls: ['note'] }] },
        ],
      },
      { tag: 'footer' },
    ])
    const at = (index: number): NodeV1 => {
      const found = snapshot.nodes[index]
      if (found === undefined) throw new Error('missing node')
      return found
    }
    expect(locatorFor(at(1), snapshot)).toBe("locator('#main').locator('div.card').nth(0)")
    expect(locatorFor(at(2), snapshot)).toBe("locator('#main').locator('div.card').nth(1)")
    expect(locatorFor(at(3), snapshot)).toBe("locator('#main').locator('p.note')")
    expect(locatorFor(at(4), snapshot)).toBe("locator('footer')")
  })

  it('scopes to the nearest ancestor its own css finds alone, never to html or body', () => {
    const snapshot = buildSnapshot([
      {
        tag: 'html',
        children: [
          {
            tag: 'body',
            children: [
              { tag: 'section', cls: ['ui-panel'], children: [{ tag: 'div' }, { tag: 'div' }] },
              { tag: 'div' },
            ],
          },
        ],
      },
    ])
    expect(locateAll(snapshot).slice(2)).toEqual([
      "locator('section.ui-panel')",
      "locator('section.ui-panel').locator('div').nth(0)",
      "locator('section.ui-panel').locator('div').nth(1)",
      "locator('div').nth(2)",
    ])
  })

  it('takes the class that selects the fewest twins, utility or hashed, as the page carries it', () => {
    expect(
      locateAll(
        buildSnapshot([
          { tag: 'li', cls: ['ui-row', 'p-2'] },
          { tag: 'li', cls: ['ui-row', 'p-4'] },
          { tag: 'li', cls: ['ui-row', 'p-2'] },
          { tag: 'div', cls: ['Card_root__k3Jd9'] },
          { tag: 'span', cls: ['css-1q2w3e-Label'] },
        ])
      )
    ).toEqual([
      "locator('li.p-2').nth(0)",
      "locator('li.p-4')",
      "locator('li.p-2').nth(1)",
      "locator('div.Card_root__k3Jd9')",
      "locator('span.css-1q2w3e-Label')",
    ])
  })

  it('counts as a twin every node the selector matches, whatever other classes it carries', () => {
    expect(
      locateAll(
        buildSnapshot([
          { tag: 'div', cls: ['ui-card'] },
          { tag: 'div', cls: ['ui-card', 'ui-x'] },
          { tag: 'div', cls: ['ui-card'] },
        ])
      )
    ).toEqual([
      "locator('div.ui-card').nth(0)",
      "locator('div.ui-x')",
      "locator('div.ui-card').nth(2)",
    ])
  })

  it('counts twins in the scope, then in the whole frame, then prefers no digits, then code point', () => {
    const scoped = buildSnapshot([
      {
        tag: 'section',
        id: 'main',
        children: [
          { tag: 'div', cls: ['ui-a', 'ui-b'] },
          { tag: 'div', cls: ['ui-c', 'ui-d'] },
          { tag: 'div', cls: ['ui-d'] },
        ],
      },
      { tag: 'div', cls: ['ui-a'] },
      { tag: 'div', cls: ['ui-c'] },
      { tag: 'div', cls: ['ui-c'] },
    ])
    expect(locateAll(scoped).slice(1, 3)).toEqual([
      "locator('#main').locator('div.ui-b')",
      "locator('#main').locator('div.ui-c')",
    ])
    expect(locate({ tag: 'div', cls: ['u-mt-2', 'ui-field--wide', 'ui-field'] })).toBe(
      "locator('div.ui-field')"
    )
    expect(locate({ tag: 'div', cls: ['u-px-6', 'u-mt-2'] })).toBe("locator('div.u-mt-2')")
  })

  it('escapes what CSS would read as syntax in a class or an id', () => {
    expect(
      locateAll(
        buildSnapshot([
          { tag: 'div', cls: ['md:p-4'] },
          { tag: 'span', cls: ['w-1/2'] },
          { tag: 'p', cls: ['2xl:px-8'] },
          { tag: 'i', cls: ['[&>*]:mx-0'] },
          { tag: 'b', cls: ['-1x'] },
          { tag: 'ul', id: '1-col' },
        ])
      )
    ).toEqual([
      String.raw`locator('div.md\\:p-4')`,
      String.raw`locator('span.w-1\\/2')`,
      String.raw`locator('p.\\32 xl\\:px-8')`,
      String.raw`locator('i.\\[\\&\\>\\*\\]\\:mx-0')`,
      String.raw`locator('b.-\\31 x')`,
      String.raw`locator('#\\31 -col')`,
    ])
  })

  it('finds a pseudo-element as its element and never counts it as a twin', () => {
    const marker: TreeSpec = { tag: 'li', flags: ['pseudo:marker'] }
    expect(
      locateAll(
        buildSnapshot([
          { tag: 'li', children: [marker] },
          { tag: 'li', children: [marker] },
          { tag: 'li' },
        ])
      )
    ).toEqual([
      "locator('li').nth(0)",
      "locator('li').nth(0)",
      "locator('li').nth(1)",
      "locator('li').nth(1)",
      "locator('li').nth(2)",
    ])
  })

  it('finds a node in a closed shadow root as its host', () => {
    const snapshot = buildSnapshot([
      {
        tag: 'ui-menu',
        children: [
          {
            tag: 'div',
            flags: ['shadow:closed'],
            children: [{ tag: 'span', flags: ['shadow:open'] }],
          },
        ],
      },
    ])
    expect(locateAll(snapshot)).toEqual([
      "locator('ui-menu')",
      "locator('ui-menu')",
      "locator('ui-menu')",
    ])
  })

  it('numbers shadow root twins after the light tree and keeps slotted nodes out of shadow scopes', () => {
    const snapshot = buildSnapshot([
      {
        tag: 'ui-badge',
        children: [
          { tag: 'span', flags: ['shadow:open'] },
          { tag: 'span' },
          { tag: 'div', id: 'panel', flags: ['shadow:open'], children: [{ tag: 'span' }] },
        ],
      },
      { tag: 'span' },
    ])
    expect(locateAll(snapshot)).toEqual([
      "locator('ui-badge')",
      "locator('ui-badge').locator('span').nth(2)",
      "locator('ui-badge').locator('span').nth(0)",
      "locator('#panel')",
      "locator('ui-badge').locator('span').nth(1)",
      "locator('span').nth(2)",
    ])
  })

  it('enters a frame through its iframe and counts twins in that frame alone', () => {
    const page = buildSnapshot([
      { tag: 'div' },
      { tag: 'iframe', id: 'pay' },
      {
        tag: 'html',
        f: 1,
        children: [
          { tag: 'div', f: 1 },
          { tag: 'div', f: 1 },
        ],
      },
    ])
    const [main] = page.frames
    if (main === undefined) throw new Error('no main frame')
    const frame = { ...main, url: 'http://app.test/pay', owner: 1 }
    expect(locateAll({ ...page, frames: [main, frame] })).toEqual([
      "locator('div')",
      "locator('#pay')",
      "locator('#pay').contentFrame().locator('html')",
      "locator('#pay').contentFrame().locator('div').nth(0)",
      "locator('#pay').contentFrame().locator('div').nth(1)",
    ])
  })
})
