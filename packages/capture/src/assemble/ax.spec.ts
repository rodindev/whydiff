import { axByBackendNode, normalizeRole } from './ax.js'

describe('normalizeRole', () => {
  it.each([
    ['button', 'button'],
    ['image', 'img'],
    ['generic', null],
    ['StaticText', null],
    ['RootWebArea', null],
    ['sectionfooter', 'sectionfooter'],
    [undefined, null],
  ])('maps %s to %s', (input, expected) => {
    expect(normalizeRole(input)).toBe(expected)
  })
})

describe('axByBackendNode', () => {
  it('keeps role and trimmed name per backend node, skipping ignored and silent nodes', () => {
    const entries = axByBackendNode([
      { ignored: false, role: { value: 'button' }, name: { value: ' Save ' }, backendDOMNodeId: 7 },
      { ignored: true, role: { value: 'button' }, name: { value: 'Hidden' }, backendDOMNodeId: 8 },
      { ignored: false, role: { value: 'generic' }, name: { value: '' }, backendDOMNodeId: 9 },
      {
        ignored: false,
        role: { value: 'generic' },
        name: { value: 'Labelled' },
        backendDOMNodeId: 10,
      },
      { ignored: false, role: { value: 'link' }, backendDOMNodeId: 11 },
      { ignored: false, role: { value: 'link' } },
    ])
    expect([...entries]).toEqual([
      [7, { role: 'button', name: 'Save' }],
      [10, { role: null, name: 'Labelled' }],
      [11, { role: 'link', name: null }],
    ])
  })

  it('cuts long names', () => {
    const entries = axByBackendNode([
      {
        ignored: false,
        role: { value: 'heading' },
        name: { value: 'x'.repeat(100) },
        backendDOMNodeId: 1,
      },
    ])
    expect(entries.get(1)?.name).toHaveLength(80)
  })
})
