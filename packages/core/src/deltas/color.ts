/** sRGB color quantized to 8-bit channels and alpha in 1/255 steps. */
export interface Rgba8 {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

type Vec3 = readonly [number, number, number]
type Mat3 = readonly [Vec3, Vec3, Vec3]
type ToSrgb = (channels: Vec3) => Vec3

/** CSS Color 4 section 10.2 sRGB: piecewise transfer function and XYZ D65 to linear sRGB. */
const SRGB_LINEAR_LIMIT = 0.04045
const SRGB_GAMMA_LIMIT = 0.0031308
const SRGB_SLOPE = 12.92
const SRGB_OFFSET = 0.055
const SRGB_SCALE = 1.055
const SRGB_EXPONENT = 2.4
const XYZ_TO_SRGB: Mat3 = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
]

/** CSS Color 4 section 10.4 display-p3: sRGB transfer function, linear P3 to XYZ D65. */
const P3_TO_XYZ: Mat3 = [
  [608311 / 1250200, 189793 / 714400, 198249 / 1000160],
  [35783 / 156275, 247089 / 357200, 198249 / 2500400],
  [0, 32229 / 714400, 5220557 / 5000800],
]

/** CSS Color 4 section 10.6 a98-rgb: pure power transfer function, linear a98 to XYZ D65. */
const A98_EXPONENT = 563 / 256
const A98_TO_XYZ: Mat3 = [
  [573536 / 994567, 263643 / 1420810, 187206 / 994567],
  [591459 / 1989134, 6239551 / 9945670, 374412 / 4972835],
  [53769 / 1989134, 351524 / 4972835, 4929758 / 4972835],
]

/** CSS Color 4 section 10.7 prophoto-rgb: gamma 1.8 with a linear toe, linear ProPhoto to XYZ D50. */
const PROPHOTO_LINEAR_LIMIT = 16 / 512
const PROPHOTO_SLOPE = 16
const PROPHOTO_EXPONENT = 1.8
const PROPHOTO_TO_XYZ_D50: Mat3 = [
  [0.7977666449006423, 0.13518129740053308, 0.0313477341283922],
  [0.2880748288194013, 0.711835234241873, 0.00008993693872564],
  [0, 0, 0.8251046025104602],
]

/** CSS Color 4 section 10.8 rec2020: BT.2020 transfer per the 2022 CR, WPT and Chromium; to XYZ D65. */
const REC2020_ALPHA = 1.09929682680944
const REC2020_BETA = 0.018053968510807
const REC2020_SLOPE = 4.5
const REC2020_EXPONENT = 0.45
const REC2020_TO_XYZ: Mat3 = [
  [63426534 / 99577255, 20160776 / 139408157, 47086771 / 278816314],
  [26158966 / 99577255, 472592308 / 697040785, 8267143 / 139408157],
  [0, 19567812 / 697040785, 295819943 / 278816314],
]

/** CSS Color 4 section 19: Bradford chromatic adaptation from D50 to D65. */
const D50_TO_D65: Mat3 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
]

/** CSS Color 4 section 9.1 CIE Lab: D50 white point, rational CIE constants and f-function terms. */
const D50_WHITE: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585]
const LAB_EPSILON = 216 / 24389
const LAB_KAPPA = 24389 / 27
const LAB_F_OFFSET = 16
const LAB_F_SCALE = 116
const LAB_A_SCALE = 500
const LAB_B_SCALE = 200

/** CSS Color 4 section 9.2 Oklab: Oklab to nonlinear LMS, linear LMS to XYZ D65. */
const OKLAB_TO_LMS: Mat3 = [
  [1, 0.3963377773761749, 0.2158037573099136],
  [1, -0.1055613458156586, -0.0638541728258133],
  [1, -0.0894841775298119, -1.2914855480194092],
]
const LMS_TO_XYZ: Mat3 = [
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
  [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
  [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
]

/** CSS Color 4 section 5.1: rgb() channels run from 0 to 255. */
const RGB_RANGE = 255

const NUMBER = /^-?\d+(?:\.\d+)?(?:e[+-]\d+)?$/
const FUNCTION_CALL = /^([a-z-]+)\(([^()]*)\)$/

const LAB_FUNCTIONS: ReadonlyMap<string, ToSrgb> = new Map<string, ToSrgb>([
  ['lab', (c) => xyzToSrgb(labToXyz(c))],
  ['lch', (c) => xyzToSrgb(labToXyz(polarToRectangular(c)))],
  ['oklab', (c) => xyzToSrgb(oklabToXyz(c))],
  ['oklch', (c) => xyzToSrgb(oklabToXyz(polarToRectangular(c)))],
])

const PREDEFINED_SPACES: ReadonlyMap<string, ToSrgb> = new Map<string, ToSrgb>([
  ['srgb', (c) => c],
  ['srgb-linear', (c) => map(c, linearToSrgb)],
  ['display-p3', (c) => xyzToSrgb(multiply(P3_TO_XYZ, map(c, srgbToLinear)))],
  ['a98-rgb', (c) => xyzToSrgb(multiply(A98_TO_XYZ, map(c, a98ToLinear)))],
  [
    'prophoto-rgb',
    (c) => xyzToSrgb(multiply(D50_TO_D65, multiply(PROPHOTO_TO_XYZ_D50, map(c, prophotoToLinear)))),
  ],
  ['rec2020', (c) => xyzToSrgb(multiply(REC2020_TO_XYZ, map(c, rec2020ToLinear)))],
  ['xyz-d50', (c) => xyzToSrgb(multiply(D50_TO_D65, c))],
  ['xyz-d65', xyzToSrgb],
])

/** Parses a Chromium computed color or null; out-of-gamut channels are clamped, not gamut mapped. */
export function parseColor(value: string): Rgba8 | null {
  const [, name = '', body = ''] = FUNCTION_CALL.exec(value) ?? []
  if (name === 'rgb' || name === 'rgba') return parseLegacy(body.split(', '))
  const tokens = body.split(' ')
  if (name === 'color') return parseModern(PREDEFINED_SPACES.get(tokens[0] ?? ''), tokens.slice(1))
  return parseModern(LAB_FUNCTIONS.get(name), tokens)
}

/** True when both strings quantize to the same color; identical strings are always true. */
export function sameColor(before: string, after: string): boolean {
  if (before === after) return true
  const a = parseColor(before)
  const b = parseColor(after)
  return a !== null && b !== null && a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a
}

function parseLegacy(parts: readonly string[]): Rgba8 | null {
  if (parts.length !== 3 && parts.length !== 4) return null
  const channels = parseTriple(parts.slice(0, 3), parseNumber)
  const alpha = parts.length === 4 ? parseNumber(parts[3] ?? '') : 1
  if (channels === null || alpha === null) return null
  return quantize(
    map(channels, (v) => v / RGB_RANGE),
    alpha
  )
}

function parseModern(toSrgb: ToSrgb | undefined, tokens: readonly string[]): Rgba8 | null {
  const slashed = tokens.length === 5 && tokens[3] === '/'
  if (toSrgb === undefined || (tokens.length !== 3 && !slashed)) return null
  const channels = parseTriple(tokens.slice(0, 3), parseChannel)
  const alpha = slashed ? parseChannel(tokens[4] ?? '') : 1
  return channels === null || alpha === null ? null : quantize(toSrgb(channels), alpha)
}

function parseTriple(tokens: readonly string[], parse: (t: string) => number | null): Vec3 | null {
  const [c0 = null, c1 = null, c2 = null] = tokens.map(parse)
  return c0 === null || c1 === null || c2 === null ? null : [c0, c1, c2]
}

function parseChannel(token: string): number | null {
  return token === 'none' ? 0 : parseNumber(token)
}

function parseNumber(token: string): number | null {
  return NUMBER.test(token) ? Number(token) : null
}

function polarToRectangular([lightness, chroma, hue]: Vec3): Vec3 {
  const radians = (hue * Math.PI) / 180
  return [lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)]
}

function labToXyz([l, a, b]: Vec3): Vec3 {
  const f1 = (l + LAB_F_OFFSET) / LAB_F_SCALE
  const f0 = a / LAB_A_SCALE + f1
  const f2 = f1 - b / LAB_B_SCALE
  const x = f0 ** 3 > LAB_EPSILON ? f0 ** 3 : (LAB_F_SCALE * f0 - LAB_F_OFFSET) / LAB_KAPPA
  const y = l > LAB_KAPPA * LAB_EPSILON ? f1 ** 3 : l / LAB_KAPPA
  const z = f2 ** 3 > LAB_EPSILON ? f2 ** 3 : (LAB_F_SCALE * f2 - LAB_F_OFFSET) / LAB_KAPPA
  return multiply(D50_TO_D65, [x * D50_WHITE[0], y * D50_WHITE[1], z * D50_WHITE[2]])
}

function oklabToXyz(oklab: Vec3): Vec3 {
  const lms = multiply(OKLAB_TO_LMS, oklab)
  return multiply(
    LMS_TO_XYZ,
    map(lms, (v) => v ** 3)
  )
}

function xyzToSrgb(xyz: Vec3): Vec3 {
  return map(multiply(XYZ_TO_SRGB, xyz), linearToSrgb)
}

function srgbToLinear(value: number): number {
  const abs = Math.abs(value)
  if (abs <= SRGB_LINEAR_LIMIT) return value / SRGB_SLOPE
  return Math.sign(value) * ((abs + SRGB_OFFSET) / SRGB_SCALE) ** SRGB_EXPONENT
}

function linearToSrgb(value: number): number {
  const abs = Math.abs(value)
  if (abs <= SRGB_GAMMA_LIMIT) return SRGB_SLOPE * value
  return Math.sign(value) * (SRGB_SCALE * abs ** (1 / SRGB_EXPONENT) - SRGB_OFFSET)
}

function prophotoToLinear(value: number): number {
  const abs = Math.abs(value)
  if (abs <= PROPHOTO_LINEAR_LIMIT) return value / PROPHOTO_SLOPE
  return Math.sign(value) * abs ** PROPHOTO_EXPONENT
}

function rec2020ToLinear(value: number): number {
  const abs = Math.abs(value)
  if (abs < REC2020_BETA * REC2020_SLOPE) return value / REC2020_SLOPE
  return Math.sign(value) * ((abs + REC2020_ALPHA - 1) / REC2020_ALPHA) ** (1 / REC2020_EXPONENT)
}

function a98ToLinear(value: number): number {
  return Math.sign(value) * Math.abs(value) ** A98_EXPONENT
}

function multiply(m: Mat3, v: Vec3): Vec3 {
  return [dot(m[0], v), dot(m[1], v), dot(m[2], v)]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function map(v: Vec3, fn: (value: number) => number): Vec3 {
  return [fn(v[0]), fn(v[1]), fn(v[2])]
}

function quantize(srgb: Vec3, alpha: number): Rgba8 {
  return { r: toByte(srgb[0]), g: toByte(srgb[1]), b: toByte(srgb[2]), a: toByte(alpha) }
}

function toByte(channel: number): number {
  if (channel >= 1) return 255
  if (channel > 0) return Math.round(channel * 255)
  return 0
}
