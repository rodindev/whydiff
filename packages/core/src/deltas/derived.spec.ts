import { markDerived, type StyleLookup } from './derived.js'
import type { StyleChange } from './types.js'

const lookup =
  (values: Record<string, string>): StyleLookup =>
  (prop) =>
    values[prop] ?? null
const change = (prop: string, from: string, to: string): StyleChange => ({ prop, from, to })
const reasons = (
  changes: StyleChange[],
  before: Record<string, string>,
  after: Record<string, string>,
  sameRule: (prop: string) => boolean = () => false
) =>
  markDerived(changes, lookup(before), lookup(after), sameRule).map((c) => [
    c.prop,
    c.derived ?? null,
  ])

describe('markDerived', () => {
  it('marks border and outline colours that follow color', () => {
    const before = {
      color: 'rgb(0, 0, 0)',
      'border-top-color': 'rgb(0, 0, 0)',
      'border-top-style': 'solid',
      'outline-color': 'rgb(0, 0, 0)',
      'outline-width': '1px',
    }
    const after = {
      color: 'rgb(9, 9, 9)',
      'border-top-color': 'rgb(9, 9, 9)',
      'border-top-style': 'solid',
      'outline-color': 'rgb(9, 9, 9)',
      'outline-width': '1px',
    }
    expect(
      reasons(
        [
          change('color', 'rgb(0, 0, 0)', 'rgb(9, 9, 9)'),
          change('border-top-color', 'rgb(0, 0, 0)', 'rgb(9, 9, 9)'),
          change('outline-color', 'rgb(0, 0, 0)', 'rgb(9, 9, 9)'),
        ],
        before,
        after
      )
    ).toEqual([
      ['color', null],
      ['border-top-color', 'currentcolor'],
      ['outline-color', 'currentcolor'],
    ])
  })

  it('marks border colours and widths on sides that are not painted', () => {
    const before = {
      'border-bottom-style': 'none',
      'border-bottom-color': 'rgb(0, 0, 0)',
      'border-bottom-width': '0px',
    }
    const after = {
      'border-bottom-style': 'none',
      'border-bottom-color': 'rgb(229, 231, 235)',
      'border-bottom-width': '0px',
    }
    expect(
      reasons([change('border-bottom-color', 'rgb(0, 0, 0)', 'rgb(229, 231, 235)')], before, after)
    ).toEqual([['border-bottom-color', 'unpainted']])
  })

  it('marks a colour change on a zero-width border as unpainted even when the style is solid', () => {
    const before = {
      'border-top-style': 'solid',
      'border-top-width': '0px',
      'border-top-color': 'rgb(0, 0, 0)',
    }
    const after = {
      'border-top-style': 'solid',
      'border-top-width': '0px',
      'border-top-color': 'rgb(229, 231, 235)',
    }
    expect(
      reasons([change('border-top-color', 'rgb(0, 0, 0)', 'rgb(229, 231, 235)')], before, after)
    ).toEqual([['border-top-color', 'unpainted']])
  })

  it('marks outline width, colour and offset changes as unpainted while the outline style is none', () => {
    const before = {
      'outline-style': 'none',
      'outline-width': '3px',
      'outline-color': 'rgb(0, 0, 0)',
      'outline-offset': '0px',
    }
    const after = {
      'outline-style': 'none',
      'outline-width': '1px',
      'outline-color': 'rgb(9, 9, 9)',
      'outline-offset': '2px',
    }
    const changes = [
      change('outline-width', '3px', '1px'),
      change('outline-color', 'rgb(0, 0, 0)', 'rgb(9, 9, 9)'),
      change('outline-offset', '0px', '2px'),
    ]
    expect(reasons(changes, before, after)).toEqual([
      ['outline-width', 'unpainted'],
      ['outline-color', 'unpainted'],
      ['outline-offset', 'unpainted'],
    ])
    expect(
      reasons(
        [change('outline-style', 'none', 'auto'), change('outline-offset', '0px', '2px')],
        before,
        { ...after, 'outline-style': 'auto' }
      )
    ).toEqual([
      ['outline-style', null],
      ['outline-offset', null],
    ])
  })

  it('attributes a width change to a style toggle', () => {
    const before = { 'border-left-style': 'none', 'border-left-width': '0px' }
    const after = { 'border-left-style': 'solid', 'border-left-width': '1px' }
    expect(
      reasons(
        [change('border-left-style', 'none', 'solid'), change('border-left-width', '0px', '1px')],
        before,
        after
      )
    ).toEqual([
      ['border-left-style', null],
      ['border-left-width', 'border-style'],
    ])
  })

  it('marks used grid tracks with the same count and proportional line-height as derived', () => {
    const before = {
      display: 'grid',
      'grid-template-columns': '100px 200px',
      'line-height': '24px',
      'font-size': '16px',
    }
    const after = {
      display: 'grid',
      'grid-template-columns': '120px 240px',
      'line-height': '27px',
      'font-size': '18px',
    }
    expect(
      reasons(
        [
          change('grid-template-columns', '100px 200px', '120px 240px'),
          change('line-height', '24px', '27px'),
          change('font-size', '16px', '18px'),
        ],
        before,
        after
      )
    ).toEqual([
      ['grid-template-columns', 'geometry'],
      ['line-height', 'font-size'],
      ['font-size', null],
    ])
    expect(
      reasons(
        [change('grid-template-columns', '100px', '50px 50px')],
        { ...before, 'grid-template-columns': '100px' },
        { ...after, 'grid-template-columns': '50px 50px' }
      )
    ).toEqual([['grid-template-columns', null]])
  })

  describe('a transform said another way', () => {
    const none = { translate: 'none', rotate: 'none', scale: 'none', transform: 'none' }
    const changed = (before: Record<string, string>, after: Record<string, string>) =>
      Object.keys(none)
        .filter((prop) => before[prop] !== after[prop])
        .map((prop) => change(prop, before[prop] ?? '', after[prop] ?? ''))

    it('marks the individual transforms that compose to the transform they replace', () => {
      const before = {
        ...none,
        transform: 'matrix(0.948698, 0.0497192, -0.0497192, 0.948698, 8, 0)',
      }
      const after = { ...none, translate: '8px', rotate: '3deg', scale: '0.95' }
      expect(reasons(changed(before, after), before, after)).toEqual([
        ['translate', 'transform'],
        ['rotate', 'transform'],
        ['scale', 'transform'],
        ['transform', 'transform'],
      ])
      const turned = { ...none, transform: 'matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, 0)' }
      const rotated = { ...none, rotate: '0.125turn' }
      expect(reasons(changed(turned, rotated), turned, rotated)).toEqual([
        ['rotate', 'transform'],
        ['transform', 'transform'],
      ])
    })

    it('keeps a real move, a percentage, a rotation about another axis and a side without the individual transforms', () => {
      const moved = { ...none, translate: '9px' }
      const at8 = { ...none, translate: '8px' }
      expect(reasons(changed(at8, moved), at8, moved)).toEqual([['translate', null]])
      const half = { ...none, translate: '50% 0px' }
      const shifted = { ...none, transform: 'matrix(1, 0, 0, 1, 40, 0)' }
      expect(reasons(changed(half, shifted), half, shifted)).toEqual([
        ['translate', null],
        ['transform', null],
      ])
      const flipped = { ...none, rotate: 'x 180deg' }
      const mirrored = { ...none, transform: 'matrix(1, 0, 0, -1, 0, 0)' }
      expect(reasons(changed(flipped, mirrored), flipped, mirrored)).toEqual([
        ['rotate', null],
        ['transform', null],
      ])
      const old = { transform: 'matrix(1, 0, 0, 1, 8, 0)' }
      expect(
        reasons([change('transform', old.transform, 'none')], old, { ...none, translate: '8px' })
      ).toEqual([['transform', null]])
    })
  })

  describe('lengths that follow the font-size', () => {
    const before = {
      'font-size': '16px',
      'letter-spacing': '0.8px',
      'padding-left': '12px',
      'border-top-left-radius': '8px 16px',
      'box-shadow': 'rgba(0, 0, 0, 0.5) 0px 1.6px 3.2px 0px',
      filter: 'blur(1.6px) drop-shadow(rgb(255, 0, 0) 1.6px 1.6px 3.2px)',
      'border-top-width': '2px',
      transform: 'matrix(1, 0, 0, 1, 16, 0)',
    }
    const after = {
      'font-size': '24px',
      'letter-spacing': '1.2px',
      'padding-left': '18px',
      'border-top-left-radius': '12px 24px',
      'box-shadow': 'rgba(0, 0, 0, 0.5) 0px 2.4px 4.8px 0px',
      filter: 'blur(2.4px) drop-shadow(rgb(255, 0, 0) 2.4px 2.4px 4.8px)',
      'border-top-width': '3px',
      transform: 'matrix(1, 0, 0, 1, 24, 0)',
    }
    const all = (from: Record<string, string>, to: Record<string, string>): StyleChange[] =>
      Object.keys(from).map((prop) => change(prop, from[prop] ?? '', to[prop] ?? ''))

    it('marks every px length of a value that the font-size ratio scales, under one rule on both sides', () => {
      expect(reasons(all(before, after), before, after, () => true)).toEqual([
        ['font-size', null],
        ['letter-spacing', 'font-size'],
        ['padding-left', 'font-size'],
        ['border-top-left-radius', 'font-size'],
        ['box-shadow', 'font-size'],
        ['filter', 'font-size'],
        ['border-top-width', null],
        ['transform', null],
      ])
    })

    it('keeps a length that another rule set, that changed without the font-size, missed its ratio or changed beside its lengths', () => {
      const changes = all(before, after)
      const kept = changes.map((c) => [c.prop, null])
      expect(reasons(changes, before, after, () => false)).toEqual(kept)
      const alone = changes.filter((c) => c.prop !== 'font-size')
      expect(reasons(alone, before, after, () => true)).toEqual(kept.slice(1))
      const missed = {
        ...after,
        'letter-spacing': '1.25px',
        'box-shadow': 'rgba(0, 0, 0, 0.6) 0px 2.4px 4.8px 0px',
      }
      expect(
        reasons(
          [
            change('font-size', '16px', '24px'),
            change('letter-spacing', '0.8px', '1.25px'),
            change('box-shadow', before['box-shadow'], missed['box-shadow']),
            change('padding-left', '0px', '18px'),
          ],
          { ...before, 'padding-left': '0px' },
          missed,
          () => true
        )
      ).toEqual([
        ['font-size', null],
        ['letter-spacing', null],
        ['box-shadow', null],
        ['padding-left', null],
      ])
    })
  })
})
