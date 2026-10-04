import { flagsById, type Spec } from '../testing/columns.js'

const html: Spec = { tag: 'html', parent: 0, box: [0, 0, 1000, 1000] }
const hidden = { 'overflow-x': 'hidden', 'overflow-y': 'hidden' }

describe('clipsBelow', () => {
  it('clips an absolute box by its containing block, not by a static overflow box between', () => {
    const flags = flagsById([
      html,
      { tag: 'div', parent: 1, box: [100, 100, 600, 400], style: { position: 'relative' } },
      { tag: 'div', parent: 2, box: [100, 100, 100, 100], style: hidden },
      {
        tag: 'div',
        parent: 3,
        box: [400, 300, 40, 40],
        style: { position: 'absolute' },
        attrs: { id: 'escapes' },
      },
      { tag: 'div', parent: 3, box: [250, 100, 40, 40], attrs: { id: 'in-flow' } },
      {
        tag: 'div',
        parent: 2,
        box: [400, 100, 100, 100],
        style: { position: 'absolute', ...hidden },
      },
      { tag: 'div', parent: 6, box: [400, 100, 100, 20] },
      {
        tag: 'div',
        parent: 7,
        box: [550, 100, 40, 40],
        style: { position: 'absolute' },
        attrs: { id: 'kept' },
      },
    ])
    expect(flags).toEqual({ escapes: [], 'in-flow': ['clipped'], kept: ['clipped'] })
  })

  describe('a fixed box', () => {
    const fixedIn = (
      style: Readonly<Record<string, string>>,
      root: Spec = html
    ): Readonly<Record<string, readonly string[]>> =>
      flagsById([
        root,
        {
          tag: 'div',
          parent: 1,
          box: [100, 100, 100, 100],
          style: { position: 'relative', ...hidden, ...style },
        },
        {
          tag: 'div',
          parent: 2,
          box: [800, 100, 40, 40],
          style: { position: 'fixed' },
          attrs: { id: 'fixed' },
        },
      ])

    it('escapes an overflow box that is only positioned', () => {
      expect(fixedIn({})).toEqual({ fixed: [] })
    })

    it.each([
      { transform: 'matrix(1, 0, 0, 1, 10, 0)' },
      { translate: '10px' },
      { rotate: '5deg' },
      { scale: '2' },
      { perspective: '100px' },
      { 'offset-path': 'path("M 0 0 L 10 10")' },
      { 'transform-style': 'preserve-3d' },
      { filter: 'blur(2px)' },
      { 'backdrop-filter': 'blur(2px)' },
      { 'will-change': 'opacity, transform' },
      { 'will-change': 'filter' },
      { contain: 'paint' },
      { contain: 'layout' },
      { contain: 'strict' },
      { 'content-visibility': 'auto' },
      { 'container-type': 'inline-size' },
      { display: 'inline', filter: 'blur(2px)' },
    ])('is clipped by an overflow box that is its containing block through %o', (style) => {
      expect(fixedIn(style)).toEqual({ fixed: ['clipped'] })
    })

    it.each([
      { 'will-change': 'opacity' },
      { contain: 'size' },
      { 'container-type': 'scroll-state' },
      { display: 'inline', transform: 'matrix(1, 0, 0, 1, 10, 0)' },
    ])('escapes an overflow box that %o does not make its containing block', (style) => {
      expect(fixedIn(style)).toEqual({ fixed: [] })
    })

    it('is not contained by a filter on the root element', () => {
      const root = (style: Readonly<Record<string, string>>): Spec => ({
        ...html,
        box: [0, 0, 500, 500],
        style,
      })
      expect(fixedIn({ position: 'static' }, root({ ...hidden, filter: 'blur(2px)' }))).toEqual({
        fixed: [],
      })
      expect(
        fixedIn({ position: 'static' }, root({ ...hidden, transform: 'matrix(1, 0, 0, 1, 0, 0)' }))
      ).toEqual({ fixed: ['clipped'] })
    })

    it('still inherits the opacity of its ancestors', () => {
      expect(fixedIn({ opacity: '0' })).toEqual({ fixed: ['hidden'] })
    })
  })

  it('lets a top-layer element and its subtree escape the clip and opacity of its ancestors', () => {
    const specs: Spec[] = [
      html,
      {
        tag: 'div',
        parent: 1,
        box: [50, 50, 60, 60],
        style: { position: 'absolute', opacity: '0', ...hidden },
      },
      {
        tag: 'dialog',
        parent: 2,
        box: [400, 200, 40, 40],
        style: { position: 'fixed' },
        attrs: { id: 'modal' },
      },
      { tag: 'span', parent: 3, box: [400, 200, 10, 10], attrs: { id: 'inner' } },
      {
        tag: 'div',
        parent: 3,
        box: [900, 0, 10, 10],
        style: { position: 'fixed' },
        attrs: { id: 'inner-fixed' },
      },
      { tag: 'div', parent: 2, box: [400, 300, 40, 40], attrs: { id: 'trapped' } },
    ]
    const modal = 103
    expect(flagsById(specs, [modal])).toEqual({
      modal: [],
      inner: [],
      'inner-fixed': [],
      trapped: ['clipped', 'hidden'],
    })
    expect(flagsById(specs)).toEqual({
      modal: ['hidden'],
      inner: ['hidden'],
      'inner-fixed': ['hidden'],
      trapped: ['clipped', 'hidden'],
    })
  })
})
