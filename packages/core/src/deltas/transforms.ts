import { TRANSFORM_TOL } from '../constants.js'
import type { StyleLookup } from './derived.js'
import { normalizeValue } from './normalize.js'

/** A 2D affine matrix in the order of CSS `matrix(a, b, c, d, e, f)`. */
type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number]

/** The properties that make up an element's transform, in the order CSS Transforms 2 applies them. */
export const TRANSFORM_PROPS: readonly string[] = ['translate', 'rotate', 'scale', 'transform']

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const PX = /^(-?(?:\d*\.)?\d+(?:e[+-]?\d+)?)px$/i
const NUMBER = /^-?(?:\d*\.)?\d+(?:e[+-]?\d+)?$/i
const ANGLE = /^(-?(?:\d*\.)?\d+(?:e[+-]?\d+)?)(deg|grad|rad|turn)$/i
const MATRIX = /^matrix\((.*)\)$/
const RADIANS: Readonly<Record<string, number>> = {
  deg: Math.PI / 180,
  grad: Math.PI / 200,
  rad: 1,
  turn: 2 * Math.PI,
}

/** Whether `translate`, `rotate`, `scale` and `transform` compose to the same 2D matrix on both sides; false when a side lacks one of them or holds a percentage, a 3D value or a rotation about another axis. */
export function sameTransform(before: StyleLookup, after: StyleLookup): boolean {
  const a = composed(before)
  const b = composed(after)
  return a !== null && b !== null && a.every((value, i) => close(value, b[i] ?? Number.NaN))
}

function composed(side: StyleLookup): Matrix | null {
  const parts = [
    translation(side('translate')),
    rotation(side('rotate')),
    scaling(side('scale')),
    matrixOf(side('transform')),
  ]
  let out = IDENTITY
  for (const part of parts) {
    if (part === null) return null
    out = multiply(out, part)
  }
  return out
}

function translation(value: string | null): Matrix | null {
  if (value === 'none') return IDENTITY
  const [x = '', y = '0px', z = '0px', ...rest] = value?.split(' ') ?? []
  const lengths = [x, y, z].map((part) => (part === '0' ? 0 : Number(PX.exec(part)?.[1] ?? NaN)))
  const [tx = NaN, ty = NaN, tz = NaN] = lengths
  if (rest.length > 0 || !Number.isFinite(tx) || !Number.isFinite(ty) || tz !== 0) return null
  return [1, 0, 0, 1, tx, ty]
}

function rotation(value: string | null): Matrix | null {
  if (value === 'none') return IDENTITY
  const [, amount = '', unit = ''] = ANGLE.exec(value ?? '') ?? []
  const factor = RADIANS[unit.toLowerCase()]
  if (factor === undefined) return null
  const angle = Number(amount) * factor
  return [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]
}

function scaling(value: string | null): Matrix | null {
  if (value === 'none') return IDENTITY
  const parts = value?.split(' ') ?? []
  if (parts.length === 0 || parts.length > 3 || !parts.every((part) => NUMBER.test(part)))
    return null
  const [sx = 1, sy = sx, sz = 1] = parts.map(Number)
  return sz === 1 ? [sx, 0, 0, sy, 0, 0] : null
}

function matrixOf(value: string | null): Matrix | null {
  if (value === 'none') return IDENTITY
  const args = MATRIX.exec(normalizeValue('transform', value ?? ''))?.[1] ?? ''
  const list = args.split(', ').map(Number)
  const [a = NaN, b = NaN, c = NaN, d = NaN, e = NaN, f = NaN] = list
  return list.length === 6 && list.every(Number.isFinite) ? [a, b, c, d, e, f] : null
}

function multiply(m: Matrix, n: Matrix): Matrix {
  const [a, b, c, d, e, f] = m
  const [p, q, r, s, t, u] = n
  return [
    a * p + c * q,
    b * p + d * q,
    a * r + c * s,
    b * r + d * s,
    a * t + c * u + e,
    b * t + d * u + f,
  ]
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= TRANSFORM_TOL * Math.max(1, Math.abs(a), Math.abs(b))
}
