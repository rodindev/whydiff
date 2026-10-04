import { MASK_ATTRIBUTE, ROOT_ATTRIBUTE } from '../constants.js'
import type { AxNode, DocumentSnapshot, RawSheet, RuleGroup } from '../raw.js'
import { assemble, build, capture, main, PROPS, rawDocument } from '../testing/columns.js'
import { VERSION } from '../version.js'

describe('assembleSnapshot', () => {
  it('emits laid-out elements with the nearest emitted ancestor as parent and merges their text', () => {
    const raw = capture([
      rawDocument(
        main([
          { tag: 'html', parent: 0, box: [0, 0, 1000, 1000] },
          { tag: 'body', parent: 1, box: [0, 0, 1000, 1000] },
          { tag: 'div', parent: 2, style: { display: 'contents' } },
          { tag: 'p', parent: 3, box: [0, 0, 100, 36], attrs: { id: 'p', class: ' a  b ' } },
          {
            tag: '#text',
            parent: 4,
            box: [0, 0, 50, 18],
            text: 'one two',
            lines: [
              [0, 0, 50, 18],
              [0, 18, 30, 18],
            ],
          },
          { tag: 'b', parent: 4, box: [50, 0, 30, 18] },
          { tag: '#text', parent: 6, box: [50, 0, 30, 18], text: 'bold' },
          {
            tag: '#text',
            parent: 4,
            box: [80, 0, 20, 18],
            text: '  tail\n',
            lines: [[80, 0, 20, 18]],
          },
          { tag: '::before', parent: 4, box: [0, 0, 0, 0], pseudo: 'before' },
        ]),
        'MAIN',
        'http://app.test/'
      ),
    ])
    const { nodes } = assemble(raw)
    expect(nodes.map((n) => [n.i, n.p, n.tag])).toEqual([
      [0, -1, 'html'],
      [1, 0, 'body'],
      [2, 1, 'p'],
      [3, 2, 'b'],
      [4, 2, 'p'],
    ])
    expect(nodes[2]).toMatchObject({
      id: 'p',
      cls: ['a', 'b'],
      text: 'one two tail',
      lineBoxes: [
        [0, 0, 50, 18],
        [0, 18, 30, 18],
        [80, 0, 20, 18],
      ],
    })
    expect(nodes[3]?.text).toBe('bold')
    expect(nodes[3]?.lineBoxes).toBeUndefined()
    expect(nodes[4]?.flags).toEqual(['pseudo:before'])
  })

  it('places a child frame by its owner box, border, padding and scroll, and marks transformed ones', () => {
    const parent = main([
      { tag: 'html', parent: 0, box: [0, 0, 1000, 1000] },
      { tag: 'body', parent: 1, box: [0, 0, 1000, 1000] },
      {
        tag: 'iframe',
        parent: 2,
        box: [20, 400, 224, 224],
        style: {
          'border-left-width': '5px',
          'border-top-width': '5px',
          'padding-left': '7px',
          'padding-top': '7px',
        },
      },
      {
        tag: 'iframe',
        parent: 2,
        box: [300, 400, 100, 100],
        style: { transform: 'matrix(0.5, 0, 0, 0.5, 0, 0)' },
      },
    ])
    const child = build(
      [
        { tag: 'html', parent: 0, box: [0, 0, 200, 1000] },
        { tag: 'div', parent: 1, box: [30, 130, 40, 40], attrs: { id: 'marker' } },
      ],
      'CHILD',
      'http://app.test/inner'
    )
    const childDocument: DocumentSnapshot = { ...child.document, scrollOffsetY: 100 }
    const raw = capture([
      rawDocument(parent, 'MAIN', 'http://app.test/'),
      rawDocument({ ...child, document: childDocument }, 'CHILD', 'http://app.test/inner', {
        parentFrameId: 'MAIN',
        ownerBackendNodeId: 103,
      }),
      rawDocument(child, 'SCALED', 'http://app.test/inner', {
        parentFrameId: 'MAIN',
        ownerBackendNodeId: 104,
      }),
    ])
    const snapshot = assemble(raw)
    expect(snapshot.frames).toEqual([
      { url: 'http://app.test/', owner: null, offset: [0, 0], scroll: [0, 0], status: 'captured' },
      {
        url: 'http://app.test/inner',
        owner: 2,
        offset: [32, 312],
        scroll: [0, 100],
        status: 'captured',
      },
      {
        url: 'http://app.test/inner',
        owner: 3,
        offset: [300, 400],
        scroll: [0, 0],
        status: 'approximate',
      },
    ])
    const marker = snapshot.nodes.find((n) => n.id === 'marker' && n.f === 1)
    expect(marker?.box).toEqual([62, 442, 40, 40])
    expect(marker?.p).toBe(4)
  })

  it('lists frames whose document was not delivered as skipped', () => {
    const raw = capture(
      [
        rawDocument(
          main([
            { tag: 'html', parent: 0, box: [0, 0, 1000, 1000] },
            { tag: 'iframe', parent: 1, box: [0, 0, 100, 100] },
          ]),
          'MAIN',
          'http://app.test/'
        ),
      ],
      {
        skippedFrames: [
          { url: 'http://other.test/', parentFrameId: 'MAIN', ownerBackendNodeId: 102 },
        ],
      }
    )
    expect(assemble(raw).frames[1]).toEqual({
      url: 'http://other.test/',
      owner: 1,
      offset: [0, 0],
      scroll: [0, 0],
      status: 'skipped',
    })
  })

  it('derives hidden and clipped flags and inner scroll rects', () => {
    const raw = capture([
      rawDocument(
        main([
          { tag: 'html', parent: 0, box: [0, 0, 1000, 1000] },
          {
            tag: 'div',
            parent: 1,
            box: [0, 0, 100, 100],
            style: { 'overflow-x': 'hidden', 'overflow-y': 'hidden' },
          },
          { tag: 'span', parent: 2, box: [300, 0, 20, 20] },
          { tag: 'span', parent: 2, box: [50, 50, 20, 20] },
          { tag: 'div', parent: 1, box: [0, 200, 100, 50], style: { opacity: '0' } },
          { tag: 'span', parent: 5, box: [0, 200, 20, 20] },
          { tag: 'div', parent: 1, box: [0, 300, 100, 50], style: { visibility: 'hidden' } },
          {
            tag: 'div',
            parent: 1,
            box: [0, 400, 100, 50],
            style: { 'overflow-y': 'auto' },
            scroll: [0, 30, 100, 400],
            client: [0, 0, 100, 50],
          },
        ]),
        'MAIN',
        'http://app.test/'
      ),
    ])
    const { nodes } = assemble(raw)
    expect(nodes[2]?.flags).toEqual(['clipped'])
    expect(nodes[3]?.flags).toBeUndefined()
    expect(nodes[4]?.flags).toEqual(['hidden'])
    expect(nodes[5]?.flags).toEqual(['hidden'])
    expect(nodes[6]?.flags).toEqual(['hidden'])
    expect(nodes[7]?.scroll).toEqual([0, 30, 100, 400])
    expect(nodes[0]?.scroll).toBeUndefined()
  })

  it('joins roles, names and sampled fonts by backend node id', () => {
    const axNodes: AxNode[] = [
      { ignored: false, role: { value: 'button' }, name: { value: 'Save' }, backendDOMNodeId: 102 },
    ]
    const built = main([
      { tag: 'html', parent: 0, box: [0, 0, 1000, 1000] },
      {
        tag: 'button',
        parent: 1,
        box: [0, 0, 80, 30],
        style: { 'font-weight': '700' },
        attrs: { 'data-testid': 'save' },
      },
      { tag: '#text', parent: 2, box: [0, 0, 80, 30], text: 'Save' },
      { tag: 'button', parent: 1, box: [0, 40, 80, 30], style: { 'font-weight': '700' } },
      { tag: '#text', parent: 4, box: [0, 40, 80, 30], text: 'Other' },
    ])
    const raw = capture([
      rawDocument(built, 'MAIN', 'http://app.test/', {
        axNodes,
        fonts: new Map([[102, 'Times-Bold']]),
      }),
    ])
    const { nodes } = assemble(raw)
    expect(nodes[1]).toMatchObject({
      role: 'button',
      name: 'Save',
      testId: 'save',
      font: 'Times-Bold',
    })
    expect(nodes[2]?.font).toBe('Times-Bold')
    expect(nodes[2]?.role).toBeUndefined()
  })

  it('orders sheets by owner position, constructed ones last, and keeps inline and harness marks', () => {
    const sheet = (extra: Partial<RawSheet>): RawSheet => ({
      styleSheetId: '',
      frameId: 'MAIN',
      href: null,
      inline: true,
      hash: '',
      text: '',
      harness: false,
      ownerBackendNodeId: null,
      order: 0,
      ...extra,
    })
    const sheets: RawSheet[] = [
      sheet({ frameId: 'CHILD', hash: 'c', ownerBackendNodeId: 101 }),
      sheet({ hash: 'b', harness: true, ownerBackendNodeId: 104, order: 1 }),
      sheet({
        href: 'http://app.test/a.css',
        inline: false,
        hash: 'a',
        ownerBackendNodeId: 103,
        order: 2,
      }),
      sheet({ hash: 'd', order: 3 }),
    ]
    const parent = main([
      { tag: 'html', parent: 0, box: [0, 0, 1000, 1000] },
      { tag: 'iframe', parent: 1, box: [0, 0, 100, 100] },
      { tag: 'link', parent: 1 },
      { tag: 'style', parent: 1 },
    ])
    const child = build(
      [{ tag: 'html', parent: 0, box: [0, 0, 100, 100] }],
      'CHILD',
      'http://app.test/c'
    )
    const raw = capture(
      [
        rawDocument(parent, 'MAIN', 'http://app.test/'),
        rawDocument(child, 'CHILD', 'http://app.test/c', {
          parentFrameId: 'MAIN',
          ownerBackendNodeId: 102,
        }),
      ],
      { sheets }
    )
    expect(assemble(raw).sheets).toEqual([
      { href: 'http://app.test/a.css', hash: 'a' },
      { inline: true, hash: 'b', harness: true },
      { inline: true, hash: 'd' },
      { inline: true, hash: 'c' },
    ])
  })

  it('gives every node of a group the row of its representative, and no tables when a document skipped them', () => {
    const built = main([
      { tag: 'html', parent: 0, box: [0, 0, 1000, 1000] },
      { tag: 'p', parent: 1, box: [0, 0, 100, 20], attrs: { class: 'a' } },
      { tag: 'p', parent: 1, box: [0, 20, 100, 20], attrs: { class: 'a' } },
    ])
    const sheets: RawSheet[] = [
      {
        styleSheetId: 'S',
        frameId: 'MAIN',
        href: null,
        inline: true,
        hash: 'a',
        text: '',
        harness: false,
        ownerBackendNodeId: null,
        order: 0,
      },
    ]
    const groups: RuleGroup[] = [
      { nodes: [1], matched: {} },
      {
        nodes: [2, 3],
        matched: {
          matchedCSSRules: [
            {
              rule: {
                styleSheetId: 'S',
                origin: 'regular',
                selectorList: { text: '.a' },
                style: { cssProperties: [{ name: 'padding-left', value: '8px' }] },
              },
            },
          ],
        },
      },
    ]
    const recorded = assemble(
      capture([rawDocument(built, 'MAIN', 'http://app.test/', { ruleGroups: groups })], { sheets })
    )
    expect(recorded.rules).toEqual([{ sheet: 0, selector: '.a' }])
    expect(recorded.attributions).toEqual([
      PROPS.map(() => -1),
      PROPS.map((prop) => (prop === 'padding-left' ? 0 : -1)),
    ])
    expect(recorded.nodes.map((n) => n.a)).toEqual([0, 1, 1])
    expect([recorded.declarations, recorded.uses]).toEqual([[], [[], []]])
    const skipped = assemble(capture([rawDocument(built, 'MAIN', 'http://app.test/')], { sheets }))
    expect(skipped.rules).toBeUndefined()
    expect(skipped.attributions).toBeUndefined()
    expect([skipped.declarations, skipped.uses]).toEqual([undefined, undefined])
    expect(skipped.nodes.every((n) => n.a === undefined)).toBe(true)
  })

  it('clips to the marked root like a locator screenshot', () => {
    const raw = capture(
      [
        rawDocument(
          main([
            { tag: 'html', parent: 0, box: [0, 0, 1000, 2400] },
            { tag: 'body', parent: 1, box: [0, 0, 1000, 2400] },
            { tag: 'div', parent: 2, box: [10, 10, 40, 40], attrs: { id: 'far' } },
            {
              tag: 'div',
              parent: 2,
              box: [200.5, 900, 600, 400],
              attrs: { id: 'dialog', [ROOT_ATTRIBUTE]: '' },
            },
            { tag: 'div', parent: 4, box: [250.5, 950, 40, 40], attrs: { id: 'inner' } },
            { tag: 'div', parent: 4, box: [850.5, 910, 40, 40], attrs: { id: 'outside' } },
            { tag: 'div', parent: 2, box: [700, 1200, 200, 60], attrs: { id: 'toast' } },
          ]),
          'MAIN',
          'http://app.test/'
        ),
      ],
      {
        metrics: {
          viewportWidth: 1000,
          viewportHeight: 800,
          scrollX: 0,
          scrollY: 700,
          cssContentWidth: 1000,
          cssContentHeight: 2400,
          layoutFactor: 1,
        },
      }
    )
    const snapshot = assemble(raw, { root: {} as never }) // the marker attribute stands in for the locator
    expect(snapshot.image).toEqual({
      width: 601,
      height: 400,
      k: 1,
      layoutFactor: 1,
      origin: [200, 900],
      fullPage: false,
      root: 2,
    })
    expect(snapshot.nodes.map((n) => n.id ?? n.tag)).toEqual([
      'html',
      'body',
      'dialog',
      'inner',
      'outside',
      'toast',
    ])
    expect(snapshot.viewport.scrollY).toBe(700)
  })

  it('describes a full-page and a device-scaled image', () => {
    const raw = capture(
      [
        rawDocument(
          main([{ tag: 'html', parent: 0, box: [0, 0, 1000, 1000] }]),
          'MAIN',
          'http://app.test/'
        ),
      ],
      {
        devicePixelRatio: 2,
        metrics: {
          viewportWidth: 1000,
          viewportHeight: 800,
          scrollX: 0,
          scrollY: 300,
          cssContentWidth: 1000,
          cssContentHeight: 2400.5,
          layoutFactor: 1,
        },
      }
    )
    expect(assemble(raw, { fullPage: true }).image).toEqual({
      width: 1000,
      height: 2401,
      k: 1,
      layoutFactor: 1,
      origin: [0, 0],
      fullPage: true,
    })
    expect(assemble(raw, { scale: 'device' }).image).toEqual({
      width: 2000,
      height: 1600,
      k: 2,
      layoutFactor: 1,
      origin: [0, 300],
      fullPage: false,
    })
  })

  it('records the comparison settings and the boxes of the marked mask elements', () => {
    const raw = capture([
      rawDocument(
        main([
          { tag: 'html', parent: 0, box: [0, 0, 1000, 1000] },
          { tag: 'div', parent: 1, box: [1.001, 2, 3, 4], attrs: { [MASK_ATTRIBUTE]: '' } },
          { tag: 'div', parent: 1, box: [5, 6, 7, 8] },
        ]),
        'MAIN',
        'http://app.test/'
      ),
    ])
    const snapshot = assemble(raw, {
      compare: { threshold: 0.35, maxDiffPixels: 0 },
      animations: 'allow',
    })
    expect(snapshot.compare).toEqual({
      threshold: 0.35,
      maxDiffPixels: 0,
      animations: 'allow',
      caret: 'hide',
      scale: 'css',
    })
    expect(snapshot.masks).toEqual([[1, 2, 3, 4]])
    expect(snapshot.tool).toEqual({
      name: 'whydiff',
      version: VERSION,
      source: 'cdp',
      browser: 'chromium 147.0.0',
    })
  })
})
