import { readFileSync } from 'node:fs'
import { parseReport } from '@whydiff/core'

import { jobSummary } from './summary.js'

const run = parseReport(
  readFileSync(new URL('../../core/fixtures/report/run/report.json', import.meta.url), 'utf8')
)
const TOTALS = ['4 of 5 screenshots changed', '3 causes, 1 unexplained region']
const FILES = { report: 'whydiff-report/report.md', screenshots: 'whydiff-report/screenshots/' }

describe('jobSummary', () => {
  it("opens with the reporter's counts, then the run summary the report leads with, then where the rest is", () => {
    expect(jobSummary(TOTALS, run, [], FILES)).toBe(
      [
        '## whydiff',
        '- 4 of 5 screenshots changed',
        '- 3 causes, 1 unexplained region',
        '',
        '3 causes appear on all 4 changed screenshots, 79% of changed pixels; they account for every changed pixel on 3 of them:',
        '- the inner spacing of 2 buttons grew by 8 px, on 2 of 4 changed screenshots, 40% of changed pixels (c257ja7)',
        '- the "Lonely one" button\'s label is lighter (was #000000, now #090909), on 1 of 4 changed screenshots, 20% of changed pixels (c1h66kd)',
        '- the "Reset it" button\'s inner spacing grew by 12 px, on 1 of 4 changed screenshots, 20% of changed pixels (c2u6o6c)',
        '',
        '1 unexplained region on 1 screenshot holds 21% of changed pixels.',
        '',
        'The whole run in `whydiff-report/report.md`; the page of each changed screenshot in `whydiff-report/screenshots/`.',
        '',
      ].join('\n')
    )
  })

  it('opens with each warning of the reporter, a paragraph of its own', () => {
    expect(jobSummary(TOTALS, run, ['the html reporter runs first'], FILES).split('\n', 4)).toEqual(
      ['## whydiff', 'Warning: the html reporter runs first', '', '- 4 of 5 screenshots changed']
    )
  })

  it('keeps a path that holds a backtick in one code span', () => {
    expect(jobSummary(TOTALS, run, [], { ...FILES, report: 'a`b/report.md' })).toContain(
      ' in ``a`b/report.md``;'
    )
  })
})
