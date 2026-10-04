import fc from 'fast-check'

import { parseColor, sameColor, type Rgba8 } from './color.js'

type Triple = readonly [number, number, number]

/** CSS Color 4 section 19 forward conversion, sRGB to Oklch, used to write round-trip inputs. */
const SRGB_TO_XYZ: readonly [Triple, Triple, Triple] = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
]
const XYZ_TO_LMS: readonly [Triple, Triple, Triple] = [
  [0.819022437996703, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
]
const LMS_TO_OKLAB: readonly [Triple, Triple, Triple] = [
  [0.210454268309314, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.42859224204858, 0.450593709617411],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
]

const rgba = (r: number, g: number, b: number, a = 255): Rgba8 => ({ r, g, b, a })
const GREEN = rgba(0, 128, 0)

// What Chromium 141 returns from getComputedStyle and DOMSnapshot.captureSnapshot for color,
// background-color, border-top-color, text-decoration-color, outline-color and, as the first token
// of the layer, box-shadow; all six serialize alike. currentcolor resolves against rgb(1, 2, 3).
const COMPUTED: readonly (readonly [string, string, Rgba8 | null])[] = [
  ['#008000', 'rgb(0, 128, 0)', GREEN],
  ['#0808', 'rgba(0, 136, 0, 0.533)', rgba(0, 136, 0, 136)],
  ['green', 'rgb(0, 128, 0)', GREEN],
  ['hsl(120 100% 25%)', 'rgb(0, 128, 0)', GREEN],
  ['hsla(120, 100%, 25%, 0.5)', 'rgba(0, 128, 0, 0.5)', rgba(0, 128, 0, 128)],
  ['hwb(120 20% 30% / 0.25)', 'rgba(51, 179, 51, 0.25)', rgba(51, 179, 51, 64)],
  ['rgba(0, 0, 0, 0.004)', 'rgba(0, 0, 0, 0.004)', rgba(0, 0, 0, 1)],
  ['transparent', 'rgba(0, 0, 0, 0)', rgba(0, 0, 0, 0)],
  ['currentcolor', 'rgb(1, 2, 3)', rgba(1, 2, 3)],
  ['lab(46.2775% -47.5621 48.5837)', 'lab(46.2775 -47.5621 48.5837)', GREEN],
  ['lab(50% 50 none / 0.5)', 'lab(50 50 none / 0.5)', rgba(193, 78, 121, 128)],
  ['lab(150 0 0)', 'lab(100 0 0)', rgba(255, 255, 255)],
  ['lch(46.2775% 67.9892 134.3912)', 'lch(46.2775 67.9892 134.391)', GREEN],
  ['oklab(51.975% -0.1403 0.10768)', 'oklab(0.51975 -0.1403 0.10768)', GREEN],
  ['oklch(51.975% 0.17686 142.495)', 'oklch(0.51975 0.17686 142.495)', GREEN],
  ['oklch(0.7 0.15 180deg / 50%)', 'oklch(0.7 0.15 180 / 0.5)', rgba(0, 188, 162, 128)],
  ['color(srgb 0% 60% 0% / 50%)', 'color(srgb 0 0.6 0 / 0.5)', rgba(0, 153, 0, 128)],
  ['color(srgb 1 0 0 / none)', 'color(srgb 1 0 0 / none)', rgba(255, 0, 0, 0)],
  ['color(srgb -0.5 1.5 0)', 'color(srgb -0.5 1.5 0)', rgba(0, 255, 0)],
  ['color(srgb 1e-7 0 0)', 'color(srgb 1.00000e-7 0 0)', rgba(0, 0, 0)],
  ['color(srgb 1e7 0 0)', 'color(srgb 1.00000e+7 0 0)', rgba(255, 0, 0)],
  ['color(srgb calc(infinity) 0 0)', 'color(srgb calc(infinity) 0 0)', null],
  ['color(srgb-linear 0 0.21586 0)', 'color(srgb-linear 0 0.21586 0)', GREEN],
  ['color(display-p3 0.21604 0.49418 0.13151)', 'color(display-p3 0.21604 0.49418 0.13151)', GREEN],
  ['color(display-p3 0 1 0)', 'color(display-p3 0 1 0)', rgba(0, 255, 0)],
  ['color(display-p3 1 none 0)', 'color(display-p3 1 none 0)', rgba(255, 0, 0)],
  ['color(display-p3 1.2 -0.2 0)', 'color(display-p3 1.2 -0.2 0)', rgba(255, 0, 0)],
  ['color(a98-rgb 0.281363 0.498012 0.116746)', 'color(a98-rgb 0.281363 0.498012 0.116746)', GREEN],
  [
    'color(prophoto-rgb 0.230479 0.395789 0.129968)',
    'color(prophoto-rgb 0.230479 0.395789 0.129968)',
    GREEN,
  ],
  ['color(prophoto-rgb 0 0.4 0.02)', 'color(prophoto-rgb 0 0.4 0.02)', rgba(0, 134, 0)],
  ['color(rec2020 0.235202 0.431704 0.085432)', 'color(rec2020 0.235202 0.431704 0.085432)', GREEN],
  ['color(rec2020 0 0.5 0.05)', 'color(rec2020 0 0.5 0.05)', rgba(0, 148, 0)],
  ['color(xyz 0.07719 0.15438 0.02573)', 'color(xyz-d65 0.07719 0.15438 0.02573)', GREEN],
  ['color(xyz-d50 0.08312 0.154746 0.020961)', 'color(xyz-d50 0.08312 0.154746 0.020961)', GREEN],
  ['color-mix(in srgb, red, blue)', 'color(srgb 0.5 0 0.5)', rgba(128, 0, 128)],
  ['color-mix(in srgb, red 25%, transparent)', 'color(srgb 1 0 0 / 0.25)', rgba(255, 0, 0, 64)],
  [
    'color-mix(in srgb-linear, red, blue)',
    'color(srgb-linear 0.5 -6.85395e-9 0.5)',
    rgba(188, 0, 188),
  ],
  ['color-mix(in oklch, red 40%, blue)', 'oklch(0.522375 0.291007 314.124)', rgba(163, 0, 217)],
  ['color-mix(in lch, red, blue)', 'lch(41.9277 119.034 351.112)', rgba(245, 0, 134)],
  [
    'color-mix(in lab, black 95%, white)',
    'lab(4.99994 0.000940263 -0.0000554323)',
    rgba(17, 17, 17),
  ],
  [
    'color-mix(in srgb, currentcolor, blue)',
    'color(srgb 0.00196078 0.00392157 0.505882)',
    rgba(0, 1, 129),
  ],
  ['rgb(from red r g b / 50%)', 'color(srgb 1 0 0 / 0.5)', rgba(255, 0, 0, 128)],
  ['hsl(from green h s l)', 'color(srgb 0 0.501961 0)', GREEN],
  ['oklch(from green l c h)', 'oklch(0.519709 0.176823 142.489)', GREEN],
]

const rgba8 = (): fc.Arbitrary<Rgba8> => {
  const byte = fc.integer({ min: 0, max: 255 })
  return fc.record({ r: byte, g: byte, b: byte, a: byte })
}

function css(values: readonly number[]): string {
  return values.map(String).join(' ')
}

function multiply(m: readonly [Triple, Triple, Triple], v: Triple): Triple {
  const dot = (row: Triple): number => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]
  return [dot(m[0]), dot(m[1]), dot(m[2])]
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function referenceOklch({ r, g, b }: Rgba8): Triple {
  const linear: Triple = [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)]
  const lms = multiply(XYZ_TO_LMS, multiply(SRGB_TO_XYZ, linear))
  const [l, a, bb] = multiply(LMS_TO_OKLAB, [
    Math.cbrt(lms[0]),
    Math.cbrt(lms[1]),
    Math.cbrt(lms[2]),
  ])
  const hue = (Math.atan2(bb, a) * 180) / Math.PI
  return [l, Math.hypot(a, bb), hue < 0 ? hue + 360 : hue]
}

function expectWithinOne(actual: Rgba8 | null, expected: Rgba8): void {
  expect(actual).not.toBeNull()
  if (actual === null) return
  expect(Math.abs(actual.r - expected.r)).toBeLessThanOrEqual(1)
  expect(Math.abs(actual.g - expected.g)).toBeLessThanOrEqual(1)
  expect(Math.abs(actual.b - expected.b)).toBeLessThanOrEqual(1)
  expect(actual.a).toBe(expected.a)
}

describe('parseColor', () => {
  it.each(COMPUTED)('reads %s as Chromium computes it, %s', (input, computed, expected) => {
    expect(parseColor(computed)).toEqual(expected)
  })

  it('returns null for values that are not one color in a computed syntax', () => {
    for (const text of [
      '',
      'none',
      '16px',
      'constructor',
      'matrix(1, 0, 0, 1, 0, 0)',
      'rgb(0, 128, 0) 0px 1px 2px 0px',
      'rgb(0, 128)',
      'rgba(0, 128, 0, 0.5, 1)',
      'rgb(0, none, 0)',
      'lab(50 0)',
      'lab(50 0 0 0)',
      'oklch(0.5 0.1 30 / 0.5 / 1)',
      'color(constructor 1 0 0)',
      'color(srgb 1 0)',
      'color(srgb 1 0 x)',
    ]) {
      expect(parseColor(text)).toBeNull()
    }
  })

  describe('round trips', () => {
    it('reads back rgba() and color(srgb) of any sRGB color exactly', () => {
      fc.assert(
        fc.property(rgba8(), (color) => {
          const { r, g, b, a } = color
          const legacy = `rgba(${[r, g, b, a / 255].map(String).join(', ')})`
          const srgb = `color(srgb ${css([r / 255, g / 255, b / 255])} / ${css([a / 255])})`
          expect(parseColor(legacy)).toEqual(color)
          expect(parseColor(srgb)).toEqual(color)
          expect(sameColor(legacy, srgb)).toBe(true)
        })
      )
    })

    it('reads back oklch() from the reference conversion within one step per channel', () => {
      fc.assert(
        fc.property(rgba8(), (color) => {
          const oklch = `oklch(${css(referenceOklch(color))} / ${css([color.a / 255])})`
          expectWithinOne(parseColor(oklch), color)
        })
      )
    })
  })

  it('never throws on arbitrary strings and yields 8-bit channels', () => {
    const wrapped = fc
      .tuple(
        fc.constantFrom(
          'rgb(',
          'rgba(',
          'lab(',
          'lch(',
          'oklab(',
          'oklch(',
          'color(srgb ',
          'color('
        ),
        fc.string(),
        fc.constantFrom(')', '')
      )
      .map((parts) => parts.join(''))
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit: 'binary' }), wrapped), (text) => {
        const color = parseColor(text)
        if (color === null) return
        for (const channel of [color.r, color.g, color.b, color.a]) {
          expect(Number.isInteger(channel) && channel >= 0 && channel <= 255).toBe(true)
        }
      })
    )
  }, 30_000)
})

describe('sameColor', () => {
  it('is true for identical strings even when unparseable', () => {
    expect(sameColor('color(srgb calc(infinity) 0 0)', 'color(srgb calc(infinity) 0 0)')).toBe(true)
  })

  it('is false for two different unparseable strings', () => {
    expect(sameColor('color(srgb calc(infinity) 0 0)', 'color(srgb calc(-infinity) 0 0)')).toBe(
      false
    )
  })

  it('equates one color across computed syntaxes', () => {
    expect(sameColor('rgba(0, 0, 0, 0)', 'color(srgb 0 0 0 / 0)')).toBe(true)
    expect(sameColor('rgb(0, 128, 0)', 'oklch(0.519709 0.176823 142.489)')).toBe(true)
    expect(sameColor('rgb(0, 128, 0)', 'lab(46.2775 -47.5621 48.5837)')).toBe(true)
  })

  it('separates colors one step apart and a parseable from an unparseable string', () => {
    expect(sameColor('rgb(0, 128, 0)', 'rgb(0, 129, 0)')).toBe(false)
    expect(sameColor('rgb(0, 128, 0)', 'rgba(0, 128, 0, 0.5)')).toBe(false)
    expect(sameColor('rgb(0, 128, 0)', 'color(srgb calc(infinity) 0 0)')).toBe(false)
  })
})
