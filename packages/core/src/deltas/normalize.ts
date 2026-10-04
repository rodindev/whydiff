import { VALUE_DECIMALS } from '../constants.js'

const WHITESPACE = /[ \t\n\r\f]+/g
const EDGE_SPACE = /^ | $/g
const TRAILING_ZEROS = /\.?0+$/
const QUOTED = /"(?:[^"\\]|\\[\s\S])*"?|'(?:[^'\\]|\\[\s\S])*'?/
const URL_TOKEN = /(?<![\w-])url\( ?("(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|[^ "'()]*) ?\)/
const NUMBER = /(?<![\w.#+-])([+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?)([a-z]+|%)?(?![\w.%+-])/
const TOKENS = new RegExp(`${URL_TOKEN.source}|${QUOTED.source}|${NUMBER.source}`, 'gi')
const PLAIN_NUMBER = /^[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?$/i
const WHOLE_QUOTED = /^(["'])([\s\S]*)\1$/
const BARE_URL = /^[^ "'()\\]*$/
const BARE_FAMILY = /^[^,"'()[\]\\]*$/
const MATRIX = /^(matrix|matrix3d)\((.*)\)$/
// circle() and ellipse() default to the centre, yet Chromium keeps a stated `at 50% 50%`
const CENTRED_SHAPE = /\b(circle|ellipse)\(((?:(?!at )[^ ()]+ )*)at 50% 50%\)/g

const LENGTH_UNITS: ReadonlySet<string> = new Set(
  [
    'px cm mm q in pt pc',
    'em rem ex rex cap rcap ch rch ic ric lh rlh',
    'vw vh vi vb vmin vmax svw svh svi svb svmin svmax',
    'lvw lvh lvi lvb lvmin lvmax dvw dvh dvi dvb dvmin dvmax',
    'cqw cqh cqi cqb cqmin cqmax',
  ].flatMap((group) => group.split(' '))
)

const MATRIX_ARITY: ReadonlyMap<string, number> = new Map([
  ['matrix', 6],
  ['matrix3d', 16],
])

const FONT_WEIGHT: ReadonlyMap<string, string> = new Map([
  ['normal', '400'],
  ['bold', '700'],
])

const WHITE_SPACE: ReadonlyMap<string, string> = new Map([
  ['normal', 'collapse:collapse wrap:wrap'],
  ['nowrap', 'collapse:collapse wrap:nowrap'],
  ['pre', 'collapse:preserve wrap:nowrap'],
  ['pre-wrap', 'collapse:preserve wrap:wrap'],
  ['pre-line', 'collapse:preserve-breaks wrap:wrap'],
  ['break-spaces', 'collapse:break-spaces wrap:wrap'],
])

const RULES: ReadonlyMap<string, (value: string) => string> = new Map([
  ['font-family', fontFamily],
  ['font-weight', fontWeight],
  ['transform', transform],
  ['box-shadow', shadow],
  ['text-shadow', shadow],
  ['grid-template-columns', trackList],
  ['grid-template-rows', trackList],
  ['background-image', backgroundImage],
  ['white-space', whiteSpace],
  ['clip-path', clipPath],
])

/** Canonical form of one computed value, for equality only; never shown to users. */
export function normalizeValue(property: string, value: string): string {
  if (property === 'color' || property.endsWith('-color')) return value
  return (RULES.get(property) ?? normalizeTokens)(collapse(value))
}

/** The px lengths of a computed value in order, and the value with each of them replaced by `px`; urls and strings stay whole. */
export function pxLengths(value: string): {
  readonly rest: string
  readonly lengths: readonly number[]
} {
  const lengths: number[] = []
  const rest = collapse(value).replace(
    TOKENS,
    (token: string, inner?: string, number?: string, unit?: string) => {
      if (inner !== undefined || number === undefined || unit !== 'px') return token
      lengths.push(Number.parseFloat(number))
      return 'px'
    }
  )
  return { rest, lengths }
}

function collapse(value: string): string {
  return value.replace(WHITESPACE, ' ').replace(EDGE_SPACE, '')
}

function normalizeTokens(value: string, url?: (inner: string) => string): string {
  return value.replace(TOKENS, (token: string, inner?: string, number?: string, unit?: string) => {
    if (inner !== undefined) return url === undefined ? token : url(inner)
    if (number === undefined) return token
    const rounded = round(number)
    const suffix = unit ?? ''
    return rounded === '0' && isLengthUnit(suffix) ? '0' : rounded + suffix
  })
}

function isLengthUnit(unit: string): boolean {
  return unit === '%' || LENGTH_UNITS.has(unit.toLowerCase())
}

function round(number: string): string {
  const value = Number.parseFloat(number)
  if (!Number.isFinite(value)) return number
  const fixed = value.toFixed(VALUE_DECIMALS)
  const short = fixed.includes('e') ? fixed : fixed.replace(TRAILING_ZEROS, '')
  return short === '-0' ? '0' : short
}

function unquoteUrl(inner: string): string {
  const bare = WHOLE_QUOTED.exec(inner)?.[2]
  return `url(${bare !== undefined && BARE_URL.test(bare) ? bare : inner})`
}

function fontFamily(value: string): string {
  return splitTopLevel(value, ',').map(family).join(', ')
}

function family(name: string): string {
  const trimmed = collapse(name)
  const bare = WHOLE_QUOTED.exec(trimmed)?.[2]
  return (bare !== undefined && BARE_FAMILY.test(bare) ? collapse(bare) : trimmed).toLowerCase()
}

function fontWeight(value: string): string {
  return FONT_WEIGHT.get(value) ?? normalizeTokens(value)
}

function transform(value: string): string {
  const [, name = '', list = ''] = MATRIX.exec(value) ?? []
  const args = list.split(',').map(collapse)
  if (args.length !== MATRIX_ARITY.get(name) || !args.every((arg) => PLAIN_NUMBER.test(arg))) {
    return normalizeTokens(value)
  }
  const numbers = args.map(round)
  return name === 'matrix' ? `matrix(${numbers.join(', ')})` : matrix3d(numbers)
}

function matrix3d(numbers: readonly string[]): string {
  const [a1, b1, c1, d1, a2, b2, c2, d2, a3, b3, c3, d3, a4, b4, c4, d4] = numbers
  const affine2d =
    [c1, d1, c2, d2, a3, b3, d3, c4].every((n) => n === '0') && c3 === '1' && d4 === '1'
  return affine2d
    ? `matrix(${[a1, b1, a2, b2, a4, b4].join(', ')})`
    : `matrix3d(${numbers.join(', ')})`
}

function shadow(value: string): string {
  return splitTopLevel(value, ',')
    .map((layer) => {
      const parts = splitTopLevel(layer, ' ').filter((part) => part !== '')
      const inset = parts.filter((part) => part === 'inset')
      return normalizeTokens([...inset, ...parts.filter((part) => part !== 'inset')].join(' '))
    })
    .join(', ')
}

function trackList(value: string): string {
  return splitTopLevel(value, ' ')
    .map((track) =>
      track.startsWith('[') || track.startsWith('repeat(') ? track : normalizeTokens(track)
    )
    .join(' ')
}

function backgroundImage(value: string): string {
  return normalizeTokens(value, unquoteUrl)
}

function whiteSpace(value: string): string {
  return WHITE_SPACE.get(value) ?? normalizeTokens(value)
}

function clipPath(value: string): string {
  return normalizeTokens(value).replace(
    CENTRED_SHAPE,
    (_, shape: string, size: string) => `${shape}(${size.trimEnd()})`
  )
}

function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (quote !== '') {
      if (char === '\\') index++
      else if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '(' || char === '[') depth++
    else if ((char === ')' || char === ']') && depth > 0) depth--
    else if (char === separator && depth === 0) {
      parts.push(value.slice(start, index))
      start = index + 1
    }
  }
  parts.push(value.slice(start))
  return parts
}
