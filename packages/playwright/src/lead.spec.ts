import { readdirSync, readFileSync } from 'node:fs'
import { parseReport, type ReportV1 } from '@whydiff/core'

import { annotationOf, explanationOf, leadsOf, pixelExplanation } from './lead.js'
import { NO_BASELINE } from './pair.js'

const FIXTURES = new URL('../../core/fixtures/report/', import.meta.url)

function fixture(name: string, drop?: string): ReportV1 {
  const text = readFileSync(new URL(`${name}/report.json`, FIXTURES), 'utf8')
  // The core reads a report through its schema; one without the dropped field is still valid.
  const kept: unknown = JSON.parse(text, (key, value: unknown) =>
    key === drop ? undefined : value
  )
  return parseReport(JSON.stringify(kept))
}

describe('leadsOf', () => {
  it('takes what changed on the screen as its page opens, plain, with the ids of its causes', () => {
    const report = fixture('markdown')
    expect(leadsOf(report, 's4udgzc')).toEqual([
      {
        text: 'the "Total *" button\'s label is lighter (was #000000, now #090909)',
        causes: ['c3hhw9m'],
      },
      { text: "a <div>'s inner spacing shrank by 12 px", causes: ['c1g6bij'] },
    ])
    expect(explanationOf(report, 's4udgzc').page).toBe(
      readFileSync(new URL('markdown/screenshot.md', FIXTURES), 'utf8')
    )
  })

  it('ends a line with how many more elements of its causes changed on the screen, for the message and the annotation alike', () => {
    const run = fixture('run')
    const together: ReportV1 = {
      ...run,
      causes: run.causes.map((c) => ({
        ...c,
        members: c.members.map((m) => ({ ...m, screenshot: 's4udgzc' })),
      })),
    }
    const [lead] = leadsOf(together, 's4udgzc')
    expect(lead).toEqual({
      text: 'the "Save it" button\'s inner spacing grew by 8 px, and 1 more element changed with it',
      causes: ['c257ja7'],
    })
    expect(annotationOf(explanationOf(together, 's4udgzc'))).toBe(
      'the "Save it" button\'s inner spacing grew by 8 px, and 1 more element changed with it (c257ja7)'
    )
  })

  it("takes each cause's headline without its share of the run, in report order, when nothing on the screen is observed", () => {
    expect(leadsOf(fixture('markdown', 'observation'), 's4udgzc')).toEqual([
      { text: 'the inner spacing of 2 <div> elements shrank by 12 px', causes: ['c1g6bij'] },
      {
        text: 'the labels of 2 buttons are lighter (was #000000, now #090909)',
        causes: ['c3hhw9m'],
      },
    ])
  })

  it('takes the unexplained regions of a screen without causes, each led by its id', () => {
    const report = fixture('form-controls')
    const uncaused: ReportV1 = {
      ...report,
      screenshots: report.screenshots.map((s) => ({ ...s, causes: [] })),
    }
    const leads = leadsOf(uncaused, 's4udgzc')
    expect(leads.map((lead) => lead.causes)).toEqual([[], []])
    expect(leads.map((lead) => lead.text)).toEqual([
      expect.stringMatching(/^uaq6iqj in .+ \| region \d+x\d+ at /),
      expect.stringMatching(/^utg09n6 in .+ \| region \d+x\d+ at /),
    ])
  })

  it('says why the report finds a screenshot unchanged, its size change included', () => {
    const report = fixture('no-change')
    expect(leadsOf(report, 's4udgzc')).toEqual([
      {
        text: "none of the 800,000 pixels differs at whydiff's own comparison threshold",
        causes: [],
      },
    ])
    const resized: ReportV1 = {
      ...report,
      screenshots: report.screenshots.map((s) => ({
        ...s,
        sizeMismatch: { before: [1000, 800], after: [1000, 900] },
      })),
    }
    expect(leadsOf(resized, 's4udgzc')).toEqual([
      {
        text: 'the screenshot was 1000x800 px, now 1000x900 px: the 800,000 pixels both cover are unchanged and the area only one covers is blank',
        causes: [],
      },
    ])
  })

  it('finds a line with no Markdown fence for every changed screenshot of the golden runs', () => {
    for (const name of readdirSync(FIXTURES).filter((n) => n !== 'invalid')) {
      const report = fixture(name)
      for (const { id } of report.screenshots.filter((s) => s.status === 'changed')) {
        const leads = leadsOf(report, id)
        expect(leads.length, `${name}/${id}`).toBeGreaterThan(0)
        for (const lead of leads) expect(lead.text, `${name}/${id}`).not.toMatch(/`/)
      }
    }
  })
})

describe('annotationOf', () => {
  it("closes the first line with its causes' ids, then every other cause of the screenshot, and leaves a line about pixels alone", () => {
    const lead = { text: 'a <div> moved', causes: ['c2k2qi9'] }
    expect(annotationOf({ leads: [lead], causes: ['c1dsr5a', 'c2k2qi9', 'c3pq7xa'] })).toBe(
      'a <div> moved (c2k2qi9, c1dsr5a, c3pq7xa)'
    )
    expect(annotationOf({ leads: [], causes: ['c1dsr5a'] })).toBeUndefined()
    const identity = { screen: 'p|t|bare', title: 'bare', file: 'a.spec.ts', line: 1, project: 'p' }
    const summary = { width: 10, height: 10, differing: 4, regions: [] }
    expect(annotationOf(pixelExplanation(identity, summary))).toBe(NO_BASELINE)
  })
})
