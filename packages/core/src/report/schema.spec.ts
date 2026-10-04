import { readdirSync, readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'

import { OBSERVATION_FACTS } from '../constants.js'
import { undescribed } from '../testing/schemas.js'
import { validateReport } from './validate.js'

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../fixtures/report/${name}`, import.meta.url), 'utf8'))
const list = (dir: string): string[] =>
  readdirSync(new URL(`../../fixtures/report/${dir}/`, import.meta.url)).map(
    (file) => `${dir}/${file}`
  )

const schema = read('../../schema/report-v1.schema.json') as Record<string, unknown> // the schema document itself
const bySchema = new Ajv2020({ strict: true }).compile(schema)
const byCode = (value: unknown): boolean => {
  try {
    validateReport(value)
    return true
  } catch {
    return false
  }
}

describe('report-v1.schema.json', () => {
  it.each([
    'run/report.json',
    'rules/report.json',
    'rule-move/report.json',
    'field-reset/report.json',
    'form-controls/report.json',
    'markdown/report.json',
    'custom-properties/report.json',
    'no-change/report.json',
  ])('accepts %s, as the validator does', (name) => {
    const value = read(name)
    expect(bySchema(value)).toBe(true)
    expect(byCode(value)).toBe(true)
  })

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

  it('reads the class an observation names its element by, as a string only', () => {
    const named = (cls: unknown): unknown => {
      const report = read('field-reset/report.json') as {
        causes: { members: { observation: { element: unknown } }[] }[]
      } // the golden's shape, down to the element
      const member = report.causes[0]?.members[0]
      if (member !== undefined) member.observation.element = { class: cls, tag: 'textarea' }
      return report
    }
    expect(bySchema(named('ui-field'))).toBe(true)
    expect(validateReport(named('ui-field')).causes[0]?.members[0]?.observation?.element).toEqual({
      class: 'ui-field',
      tag: 'textarea',
    })
    expect(bySchema(named(3))).toBe(false)
    expect(byCode(named(3))).toBe(false)
  })

  it('refuses a token estimate, a cause without its headline and text, and a run without its summary, as the schema does', () => {
    const report = read('rules/report.json') as {
      causes: Record<string, unknown>[]
      summary: Record<string, unknown>
    } // the golden's shape, down to what is added and taken away
    const bare = report.causes.map((cause) => {
      const kept: Record<string, unknown> = { ...cause }
      delete kept.headline
      delete kept.text
      return kept
    })
    const summary: Record<string, unknown> = { ...report.summary }
    delete summary.lead
    for (const value of [
      { ...report, tokens: { report: 567, images: { standard: 0, hires: 0 } } },
      { ...report, causes: bare },
      { ...report, summary },
    ]) {
      expect(bySchema(value)).toBe(false)
      expect(byCode(value)).toBe(false)
    }
  })

  it('names the four notes an unexplained region can carry, which the validator reads in any wording', () => {
    const report = read('form-controls/report.json') as { unexplained: { note?: string }[] } // the golden's shape, down to the notes
    const notes = (note: string): unknown => ({
      ...report,
      unexplained: report.unexplained.map((u) => ({ ...u, note })),
    })
    for (const note of [
      'anti-aliasing',
      'under `<canvas>`',
      "inside the resize corner of `getByRole('textbox')`",
      'inside `<select>`: placeholder, value text or control internals, which whydiff does not capture',
    ]) {
      expect(bySchema(notes(note))).toBe(true)
    }
    expect(bySchema(notes('under a tree'))).toBe(false)
    expect(byCode(notes('under a tree'))).toBe(true)
  })

  it('describes every property, at any depth', () => {
    expect(undescribed(schema)).toEqual([])
  })

  it('lists the observation facts the core knows, in its order', () => {
    expect(JSON.stringify(schema)).toContain(`"enum":${JSON.stringify(OBSERVATION_FACTS)}}`)
  })
})
