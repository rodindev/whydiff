import { readdirSync, readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'

import { undescribed } from '../testing/schemas.js'
import { validateSnapshot } from './validate.js'

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../fixtures/snapshot/${name}`, import.meta.url), 'utf8'))
const list = (dir: string): string[] =>
  readdirSync(new URL(`../../fixtures/snapshot/${dir}/`, import.meta.url)).map(
    (file) => `${dir}/${file}`
  )

const schema = read('../../schema/snapshot-v1.schema.json') as Record<string, unknown> // the schema document itself
const bySchema = new Ajv2020({ strict: true }).compile(schema)
const byCode = (value: unknown): boolean => {
  try {
    validateSnapshot(value)
    return true
  } catch {
    return false
  }
}

describe('snapshot-v1.schema.json', () => {
  it.each(['minimal.whydiff.json', 'full.whydiff.json'])(
    'accepts %s, as the validator does',
    (name) => {
      const value = read(name)
      expect(bySchema(value)).toBe(true)
      expect(byCode(value)).toBe(true)
    }
  )

  it.each(list('invalid/schema'))('rejects %s, as the validator does', (name) => {
    const value = read(name)
    expect(bySchema(value)).toBe(false)
    expect(byCode(value)).toBe(false)
  })

  it.each(list('invalid/semantic'))('accepts %s, which only the validator can reject', (name) => {
    const value = read(name)
    expect(bySchema(value)).toBe(true)
    expect(byCode(value)).toBe(false)
  })

  it('describes the snapshot and every property, at any depth', () => {
    expect(schema.description).toEqual(expect.any(String))
    expect(undescribed(schema)).toEqual([])
  })
})
