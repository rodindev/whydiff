import fc from 'fast-check'

import { INHERITED_PROPS } from '../constants.js'
import { normalizeValue } from './normalize.js'

const RULED = [
  'font-family',
  'font-weight',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'transform',
  'box-shadow',
  'text-shadow',
  'grid-template-columns',
  'grid-template-rows',
  'background-image',
  'white-space',
  'clip-path',
]

describe('normalizeValue', () => {
  describe('lengths and numbers', () => {
    it('drops the unit of a zero length or percentage', () => {
      expect(normalizeValue('margin-top', '0px')).toBe('0')
      expect(normalizeValue('padding-left', '0em')).toBe('0')
      expect(normalizeValue('flex-basis', '0%')).toBe('0')
      expect(normalizeValue('margin-left', '-0.00001px')).toBe('0')
    })

    it('keeps the unit of a zero time, angle or flex factor', () => {
      expect(normalizeValue('transition-duration', '0s')).toBe('0s')
      expect(normalizeValue('rotate', '0deg')).toBe('0deg')
      expect(normalizeValue('grid-auto-columns', '0fr')).toBe('0fr')
    })

    it('rounds to four decimals and drops trailing zeros without converting units', () => {
      expect(normalizeValue('font-size', '16.0px')).toBe('16px')
      expect(normalizeValue('opacity', '0.333333')).toBe('0.3333')
      expect(normalizeValue('width', '100.123456px')).toBe('100.1235px')
      expect(normalizeValue('padding-top', '1.50em')).toBe('1.5em')
      expect(normalizeValue('width', '1e+06px')).toBe('1000000px')
      expect(normalizeValue('z-index', '10')).toBe('10')
    })

    it('leaves digits inside names, hex colors, strings and urls alone', () => {
      expect(normalizeValue('transform-style', 'preserve-3d')).toBe('preserve-3d')
      expect(normalizeValue('grid-row-start', 'col-1')).toBe('col-1')
      expect(normalizeValue('fill', '#00ff00')).toBe('#00ff00')
      expect(normalizeValue('content', '"0.50px"')).toBe('"0.50px"')
      expect(normalizeValue('mask-image', 'url("img-0.50px.png")')).toBe('url("img-0.50px.png")')
    })

    it('leaves a number that runs into a sign untouched, so a rewrite never merges tokens', () => {
      expect(normalizeValue('width', '1e1e+21')).toBe('1e1e+21')
    })
  })

  describe('font-family', () => {
    it('unquotes, trims and lowercases each family', () => {
      expect(normalizeValue('font-family', '"Inter", "Helvetica Neue", sans-serif')).toBe(
        'inter, helvetica neue, sans-serif'
      )
      expect(normalizeValue('font-family', "'Open Sans',Arial ,  serif")).toBe(
        'open sans, arial, serif'
      )
    })

    it('equates the authored form with the one Chromium serializes', () => {
      expect(normalizeValue('font-family', 'Inter, "Helvetica Neue", sans-serif')).toBe(
        normalizeValue('font-family', '"Inter", "Helvetica Neue", sans-serif')
      )
    })

    it('keeps the quotes of a family whose name holds a comma', () => {
      expect(normalizeValue('font-family', '"Foo, Bar", Arial')).toBe('"foo, bar", arial')
    })
  })

  describe('font-weight', () => {
    it('names normal and bold by their numbers', () => {
      expect(normalizeValue('font-weight', 'normal')).toBe('400')
      expect(normalizeValue('font-weight', 'bold')).toBe('700')
    })

    it('keeps numeric weights', () => {
      expect(normalizeValue('font-weight', '700')).toBe('700')
      expect(normalizeValue('font-weight', '350.50')).toBe('350.5')
    })
  })

  describe('line-height, letter-spacing and word-spacing', () => {
    it('keeps normal', () => {
      expect(normalizeValue('line-height', 'normal')).toBe('normal')
      expect(normalizeValue('letter-spacing', 'normal')).toBe('normal')
      expect(normalizeValue('word-spacing', 'normal')).toBe('normal')
    })

    it('normalizes lengths and numbers', () => {
      expect(normalizeValue('line-height', '24.0px')).toBe('24px')
      expect(normalizeValue('line-height', '1.5')).toBe('1.5')
      expect(normalizeValue('letter-spacing', '0px')).toBe('0')
      expect(normalizeValue('word-spacing', '-0.123456px')).toBe('-0.1235px')
    })
  })

  describe('transform', () => {
    it('keeps none and an identity matrix', () => {
      expect(normalizeValue('transform', 'none')).toBe('none')
      expect(normalizeValue('transform', 'matrix(1, 0, 0, 1, 0, 0)')).toBe(
        'matrix(1, 0, 0, 1, 0, 0)'
      )
    })

    it('rounds matrix components so float noise compares equal', () => {
      const rounded = 'matrix(0.7071, 0.7071, -0.7071, 0.7071, 0, 0)'
      expect(
        normalizeValue('transform', 'matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, 0)')
      ).toBe(rounded)
      expect(
        normalizeValue(
          'transform',
          'matrix(0.7071067811865476, 0.7071067811865475, -0.7071067811865475, 0.7071067811865476, 0, -0)'
        )
      ).toBe(rounded)
      expect(normalizeValue('transform', 'matrix(1,0,0,1,10.50,0)')).toBe(
        'matrix(1, 0, 0, 1, 10.5, 0)'
      )
    })

    it('rewrites a 2D matrix3d as matrix', () => {
      expect(
        normalizeValue('transform', 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 0, 1)')
      ).toBe('matrix(1, 0, 0, 1, 10, 20)')
      expect(
        normalizeValue(
          'transform',
          'matrix3d(1, 0, -2.4492935982947064e-16, 0, 0, 1, 0, 0, 2.4492935982947064e-16, 0, 1, 0, 0, 0, 0, 1)'
        )
      ).toBe('matrix(1, 0, 0, 1, 0, 0)')
    })

    it('keeps a 3D matrix3d with rounded components', () => {
      expect(
        normalizeValue(
          'transform',
          'matrix3d(0.984808, 0, -0.173648, 0.00173648, 0, 1, 0, 0, 0.173648, 0, 0.984808, -0.00984808, 0, 0, 0, 1)'
        )
      ).toBe(
        'matrix3d(0.9848, 0, -0.1736, 0.0017, 0, 1, 0, 0, 0.1736, 0, 0.9848, -0.0098, 0, 0, 0, 1)'
      )
    })

    it('falls back to the length rule for other transform lists', () => {
      expect(normalizeValue('transform', 'translate(10.0px, 0px)')).toBe('translate(10px, 0)')
    })
  })

  describe('box-shadow and text-shadow', () => {
    it('normalizes the lengths of every layer and keeps the colors', () => {
      expect(
        normalizeValue(
          'box-shadow',
          '0px 0px 0px 1px rgba(0, 0, 0, 0.12), 0px 2px 2px 0px rgba(0, 0, 0, 0.24)'
        )
      ).toBe('0 0 0 1px rgba(0, 0, 0, 0.12), 0 2px 2px 0 rgba(0, 0, 0, 0.24)')
      expect(normalizeValue('text-shadow', 'rgb(255, 255, 255) 0px 1px 0px')).toBe(
        'rgb(255, 255, 255) 0 1px 0'
      )
    })

    it('moves inset to the front of its layer', () => {
      expect(
        normalizeValue(
          'box-shadow',
          'rgba(0, 0, 0, 0.12) 0px 0px 0px 1px, rgba(0, 0, 0, 0.24) 0px 2px 2px 0px inset'
        )
      ).toBe('rgba(0, 0, 0, 0.12) 0 0 0 1px, inset rgba(0, 0, 0, 0.24) 0 2px 2px 0')
      expect(normalizeValue('box-shadow', 'inset 0px 1px red')).toBe(
        normalizeValue('box-shadow', '0px 1px red inset')
      )
    })

    it('collapses whitespace and keeps none', () => {
      expect(normalizeValue('text-shadow', ' 0px  1px\n2px   rgb(0,  0, 0) ')).toBe(
        '0 1px 2px rgb(0, 0, 0)'
      )
      expect(normalizeValue('box-shadow', 'none')).toBe('none')
    })

    it('keeps the layer order', () => {
      const first = 'rgb(255, 0, 0) 0px 1px 0px'
      const second = 'rgb(0, 0, 255) 0px 2px 0px'
      expect(normalizeValue('box-shadow', `${first}, ${second}`)).not.toBe(
        normalizeValue('box-shadow', `${second}, ${first}`)
      )
    })
  })

  describe('grid-template-columns and grid-template-rows', () => {
    it('normalizes each track length', () => {
      expect(normalizeValue('grid-template-columns', '240px 1fr')).toBe('240px 1fr')
      expect(normalizeValue('grid-template-columns', 'minmax(0px, 1fr)  100.0px')).toBe(
        'minmax(0, 1fr) 100px'
      )
      expect(normalizeValue('grid-template-rows', '48.0px auto 0px')).toBe('48px auto 0')
    })

    it('keeps repeat() and line names untouched', () => {
      expect(normalizeValue('grid-template-columns', '[a] 0px [b] repeat(2, 10.0px)')).toBe(
        '[a] 0 [b] repeat(2, 10.0px)'
      )
      expect(normalizeValue('grid-template-rows', '[full-start main-start] 1fr [main-end]')).toBe(
        '[full-start main-start] 1fr [main-end]'
      )
    })
  })

  describe('background-image', () => {
    it('keeps none and strips the quotes of urls', () => {
      expect(normalizeValue('background-image', 'none')).toBe('none')
      expect(normalizeValue('background-image', 'url("https://example.test/a-0.50px.png")')).toBe(
        'url(https://example.test/a-0.50px.png)'
      )
      expect(normalizeValue('background-image', "url('a.png')")).toBe('url(a.png)')
    })

    it('keeps the quotes of a url that cannot go unquoted', () => {
      expect(normalizeValue('background-image', 'url("a b.png")')).toBe('url("a b.png")')
    })

    it('collapses whitespace and normalizes lengths in gradients', () => {
      expect(
        normalizeValue(
          'background-image',
          'url("a.png"), linear-gradient(to right, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)'
        )
      ).toBe('url(a.png), linear-gradient(to right, rgb(255, 0, 0) 0, rgb(0, 0, 255) 100%)')
      expect(
        normalizeValue('background-image', 'linear-gradient(45deg,  red   0.50px, blue)')
      ).toBe('linear-gradient(45deg, red 0.5px, blue)')
    })
  })

  describe('white-space', () => {
    it('rewrites the shorthand as its two longhands', () => {
      expect(normalizeValue('white-space', 'normal')).toBe('collapse:collapse wrap:wrap')
      expect(normalizeValue('white-space', 'nowrap')).toBe('collapse:collapse wrap:nowrap')
      expect(normalizeValue('white-space', 'pre')).toBe('collapse:preserve wrap:nowrap')
      expect(normalizeValue('white-space', 'pre-wrap')).toBe('collapse:preserve wrap:wrap')
      expect(normalizeValue('white-space', 'pre-line')).toBe('collapse:preserve-breaks wrap:wrap')
      expect(normalizeValue('white-space', 'break-spaces')).toBe('collapse:break-spaces wrap:wrap')
    })

    it('leaves other values to the generic rule', () => {
      expect(normalizeValue('white-space', ' preserve  nowrap ')).toBe('preserve nowrap')
    })
  })

  describe('clip-path', () => {
    it('drops the centre position that circle() and ellipse() default to', () => {
      expect(normalizeValue('clip-path', 'circle(50% at 50% 50%)')).toBe('circle(50%)')
      expect(normalizeValue('clip-path', 'circle(at 50% 50%)')).toBe('circle()')
      expect(normalizeValue('clip-path', 'ellipse(20px 10px at 50% 50%) margin-box')).toBe(
        'ellipse(20px 10px) margin-box'
      )
    })

    it('keeps any other position and normalizes lengths like the generic rule', () => {
      expect(normalizeValue('clip-path', 'circle(50% at 0% 0%)')).toBe('circle(50% at 0 0)')
      expect(normalizeValue('clip-path', 'inset(0px 100px 0px 0px)')).toBe('inset(0 100px 0 0)')
      expect(normalizeValue('clip-path', 'path("M 0 0 L 10 0 Z")')).toBe('path("M 0 0 L 10 0 Z")')
    })
  })

  describe('every other property', () => {
    it('collapses and trims whitespace and changes nothing else', () => {
      expect(normalizeValue('display', '  flex ')).toBe('flex')
      expect(normalizeValue('transition', 'all  0.3s\tease 0s')).toBe('all 0.3s ease 0s')
      expect(normalizeValue('font-style', 'italic')).toBe('italic')
    })

    it('leaves color-valued properties as they are', () => {
      expect(normalizeValue('color', ' rgb(0,  0, 0) ')).toBe(' rgb(0,  0, 0) ')
      expect(normalizeValue('background-color', 'rgba(0, 0, 0, 0.123456)')).toBe(
        'rgba(0, 0, 0, 0.123456)'
      )
      expect(normalizeValue('border-top-color', '#000')).toBe('#000')
    })
  })

  describe('properties', () => {
    const fragment = fc.constantFrom(
      ...[' ', '  ', '\t', '\n', ',', ', ', '(', ')', '[', ']', '"', "'", '\\', '/', '+', '-'],
      ...['.', '#', '%', 'url(', 'matrix(', 'matrix3d(', 'repeat(', 'rgba(', 'inset', 'normal'],
      ...['bold', 'pre', 'none', '0', '1', '-0', '0.5', '.25', '1e3', '1e999', '0.00004', 'px'],
      ...['12.34567', 'em', 'fr', 'deg', 's', 'e', 'Inter', '\u0130', '\u00df'],
      ...['circle(', 'at 50% 50%']
    )
    const component = fc.oneof(
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.constantFrom(0, 1, -0, 1e-17, 0.99999, 1e21)
    )
    const matrix = fc.array(component, { minLength: 6, maxLength: 6 })
    const values = fc.oneof(
      fc.string(),
      fc.string({ unit: 'binary' }),
      fc.array(fragment, { maxLength: 24 }).map((parts) => parts.join('')),
      matrix.map((m) => `matrix(${m.join(', ')})`),
      fc.array(component, { minLength: 16, maxLength: 16 }).map((m) => `matrix3d(${m.join(', ')})`)
    )
    const properties = fc.oneof(
      fc.constantFrom(...RULED, 'color', 'display', 'margin-top', 'opacity'),
      fc.string()
    )

    it('never throws and is idempotent', () => {
      fc.assert(
        fc.property(properties, values, (property, value) => {
          const once = normalizeValue(property, value)
          expect(normalizeValue(property, once)).toBe(once)
        }),
        { numRuns: 2000 }
      )
    })

    it('normalizes a 2D matrix3d like its matrix', () => {
      fc.assert(
        fc.property(matrix, ([a, b, c, d, e, f]) => {
          const flat = `matrix(${[a, b, c, d, e, f].join(', ')})`
          const deep = `matrix3d(${[a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, e, f, 0, 1].join(', ')})`
          expect(normalizeValue('transform', deep)).toBe(normalizeValue('transform', flat))
        })
      )
    })

    it('is the identity for color-valued properties', () => {
      const color = fc.constantFrom('color', 'background-color', 'outline-color', 'caret-color')
      fc.assert(
        fc.property(color, values, (property, value) => {
          expect(normalizeValue(property, value)).toBe(value)
        })
      )
    })

    it('is the identity for properties without rules on values no rule touches', () => {
      const unruled = fc.string().filter((name) => !RULED.includes(name))
      const keywords = fc
        .array(fc.stringMatching(/^[a-z][a-z-]*$/), { minLength: 1, maxLength: 4 })
        .map((words) => words.join(' '))
      fc.assert(
        fc.property(unruled, keywords, (property, value) => {
          expect(normalizeValue(property, value)).toBe(value)
        })
      )
    })
  })
})

describe('INHERITED_PROPS', () => {
  it('holds exactly the whitelisted properties that mdn/data marks inherited', () => {
    expect([...INHERITED_PROPS].sort()).toEqual(
      [
        'font-family',
        'font-size',
        'font-weight',
        'font-style',
        'line-height',
        'letter-spacing',
        'text-align',
        'text-transform',
        'white-space',
        'text-shadow',
        'color',
        'visibility',
        'direction',
      ].sort()
    )
  })

  it('holds no box, flex, grid, position, paint or decoration property', () => {
    for (const property of [
      'display',
      'margin-top',
      'padding-left',
      'flex-basis',
      'grid-template-columns',
      'position',
      'z-index',
      'opacity',
      'transform',
      'background-color',
      'background-image',
      'border-top-width',
      'box-shadow',
      'outline-color',
      'text-decoration-line',
    ]) {
      expect(INHERITED_PROPS.includes(property)).toBe(false)
    }
  })
})
