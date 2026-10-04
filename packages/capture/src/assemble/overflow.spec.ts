import { flagsById, type Spec } from '../testing/columns.js'

const html: Spec = { tag: 'html', parent: 0, box: [0, 0, 1000, 1000] }

function marker(id: string, box: readonly [number, number, number, number]): Spec {
  return { tag: 'div', parent: 2, box, attrs: { id } }
}

describe('overflowClip', () => {
  it('clips at the padding box, inside the border', () => {
    const flags = flagsById([
      html,
      {
        tag: 'div',
        parent: 1,
        box: [100, 100, 280, 280],
        style: {
          'overflow-x': 'hidden',
          'overflow-y': 'hidden',
          'border-left-width': '40px',
          'border-top-width': '40px',
          'border-right-width': '40px',
          'border-bottom-width': '40px',
        },
      },
      marker('in-padding', [150, 150, 40, 40]),
      marker('in-border', [100, 140, 40, 40]),
      marker('in-bottom-border', [200, 340, 40, 40]),
    ])
    expect(flags).toEqual({
      'in-padding': [],
      'in-border': ['clipped'],
      'in-bottom-border': ['clipped'],
    })
  })

  it('clips only the axes whose overflow is not visible', () => {
    const flags = flagsById([
      html,
      { tag: 'div', parent: 1, box: [400, 100, 100, 100], style: { 'overflow-x': 'clip' } },
      marker('below', [410, 220, 40, 40]),
      marker('right', [520, 100, 40, 40]),
    ])
    expect(flags).toEqual({ below: [], right: ['clipped'] })
  })

  it('moves the edge out by overflow-clip-margin when both axes are clip', () => {
    const flags = flagsById([
      html,
      {
        tag: 'div',
        parent: 1,
        box: [100, 100, 100, 100],
        style: { 'overflow-x': 'clip', 'overflow-y': 'clip', 'overflow-clip-margin': '50px' },
      },
      marker('in-margin', [205, 100, 40, 40]),
      marker('past-margin', [255, 100, 40, 40]),
    ])
    expect(flags).toEqual({ 'in-margin': [], 'past-margin': ['clipped'] })
  })

  it('measures overflow-clip-margin from its reference box', () => {
    const clipped = (margin: string): Readonly<Record<string, readonly string[]>> =>
      flagsById([
        html,
        {
          tag: 'div',
          parent: 1,
          box: [100, 100, 100, 100],
          style: {
            'overflow-x': 'clip',
            'overflow-y': 'clip',
            'overflow-clip-margin': margin,
            'border-left-width': '10px',
            'padding-left': '20px',
          },
        },
        marker('in-border', [95, 150, 10, 10]),
        marker('in-padding', [120, 150, 10, 10]),
      ])
    expect(clipped('border-box')).toEqual({ 'in-border': [], 'in-padding': [] })
    expect(clipped('content-box 5px')).toEqual({ 'in-border': ['clipped'], 'in-padding': [] })
    expect(clipped('content-box')).toEqual({ 'in-border': ['clipped'], 'in-padding': ['clipped'] })
  })

  it('ignores overflow-clip-margin unless both axes are clip', () => {
    const flags = flagsById([
      html,
      {
        tag: 'div',
        parent: 1,
        box: [100, 100, 100, 100],
        style: { 'overflow-x': 'hidden', 'overflow-y': 'hidden', 'overflow-clip-margin': '50px' },
      },
      marker('in-margin', [205, 100, 40, 40]),
    ])
    expect(flags).toEqual({ 'in-margin': ['clipped'] })
  })
})
