import fc from 'fast-check'

import {
  button,
  fieldReset,
  hoverRebuild,
  markdownTraps,
  page,
  ruleFamilies,
  ruleMove,
  ruleTwoLayers,
  screenOf,
  type Attributed,
} from '../testing/screens.js'
import type { TreeSpec } from '../testing/snapshots.js'
import { clusterCauses } from '../cluster/cluster.js'
import type { RuleSummary } from '../cluster/types.js'
import { buildReport } from './build.js'
import { safe } from './format.js'
import { screenshotId } from './ids.js'
import {
  bareHeadline,
  causeParts,
  changedLines,
  describeEffect,
  describeMemberChanges,
  describeUnchanged,
  handleOf,
  renderReport,
  renderScreenshot,
} from './render.js'
import { SENTENCES } from './sentences.js'
import type { CauseV1, ObservationV1, ReportInput, ReportV1, ScreenshotV1 } from './types.js'

const padded = (name: string, text: string, to: string) =>
  screenOf(name, page([button(10, {}, text)]), page([button(10, { 'padding-left': to }, text)]), [
    [10, 10, 80, 30],
  ])

function input(screens: ReturnType<typeof screenOf>[]): ReportInput {
  return {
    version: '0.0.1',
    compared: { before: 'main', after: 'feat/x', browser: 'chromium 147', viewport: '1000x800' },
    screens,
    clusters: clusterCauses(screens.filter((s) => s.regions.length > 0)),
  }
}

describe('renderReport', () => {
  it('truncates to the limit and names the rest', () => {
    const report = buildReport(
      input([
        padded('s1', 'Save it', '8px'),
        padded('s2', 'Cancel it', '8px'),
        screenOf('s3', page([button(10)]), page([button(10, { color: 'rgb(9, 9, 9)' })]), [
          [10, 10, 80, 30],
        ]),
        screenOf(
          's4',
          page([button(10, {}, 'Chip', { cls: ['ui-chip'] })]),
          page([button(10, { 'font-weight': '700' }, 'Chip', { cls: ['ui-chip'] })]),
          [[10, 10, 80, 30]]
        ),
      ])
    )
    const text = renderReport(report, { maxClusters: 1, explainCommand: 'whydiff explain' })
    const [first, second] = report.causes
    expect(text).toContain(`## ${first?.headline ?? ''} (${first?.id ?? ''})\n`)
    expect(text).not.toContain(`## ${second?.headline ?? ''}`)
    expect(text).toContain(
      '+ 2 more causes on 2 screenshots, ordered by changed pixels: `report.json#causes` or `whydiff explain --all`'
    )
    expect(text).not.toContain('Unchanged:')
    expect(text).not.toContain('## Unexplained regions')
  })

  it('needs no legend and makes no token claim', () => {
    const report = buildReport(
      input([padded('s1', 'Save it', '8px'), padded('s2', 'Cancel it', '8px')])
    )
    const text = renderReport(report)
    expect(text).not.toMatch(/How to read|tokens|est\./)
    expect(text.split('\n').slice(0, 3)).toEqual([
      '# whydiff: 2 of 2 screenshots changed | 1 cause | 0 unexplained regions',
      'compared: main -> feat/x | chromium 147 1000x800',
      '',
    ])
  })

  it('says how many screenshots changed, not of how many, when the total is not known', () => {
    const same = page([button(10)])
    const report = buildReport(
      input([
        padded('s1', 'Save it', '8px'),
        padded('s2', 'Cancel it', '8px'),
        screenOf('s3', same, same, []),
      ])
    )
    expect(renderReport(report, { totalUnknown: true }).split('\n', 1)).toEqual([
      '# whydiff: 2 screenshots changed | 1 cause | 0 unexplained regions',
    ])
    expect(renderReport(report).split('\n', 1)).toEqual([
      '# whydiff: 2 of 3 screenshots changed | 1 cause | 0 unexplained regions',
    ])
    const one = buildReport(input([padded('s1', 'Save it', '8px'), screenOf('s2', same, same, [])]))
    expect(renderReport(one, { totalUnknown: true }).split('\n', 1)).toEqual([
      '# whydiff: 1 screenshot changed | 1 cause | 0 unexplained regions',
    ])
  })

  it('renders the no-change block when nothing differs', () => {
    const same = page([button(10)])
    const report = buildReport(
      input([screenOf('s1', same, same, []), screenOf('s2', same, same, [])])
    )
    expect(renderReport(report)).toBe(
      [
        '# whydiff: main -> feat/x | 0 causes | 0 unexplained regions',
        'compared: main -> feat/x | chromium 147 1000x800',
        'No visible change: 0 of 1,600,000 pixels differ.',
        'If you expected a change, check: same URL and state? dev server reloaded? change inside a masked or scrolled-out area?',
        '',
      ].join('\n')
    )
  })

  it('opens with the failed screenshots it holds no pair for, when none changed, in place of no visible change', () => {
    const report = buildReport(input([]))
    expect(renderReport(report, { failed: 12 })).toBe(
      [
        '# whydiff: 12 failed screenshots, none explained',
        'compared: main -> feat/x | chromium 147 1000x800',
        'Each is listed below, under No baseline snapshot or Not explained, with what whydiff lacked to explain it.',
        '',
      ].join('\n')
    )
    expect(renderReport(report)).toContain('\nNo visible change: 0 of 0 pixels differ.\n')
    const changed = buildReport(input([padded('s1', 'Save it', '8px')]))
    expect(renderReport(changed, { failed: 2 })).toBe(renderReport(changed))
  })

  it('is ASCII only', () => {
    const report = buildReport(
      input([padded('s1', 'Save it', '8px'), padded('s2', 'Cancel it', '8px')])
    )
    expect(renderReport(report)).toMatch(/^[\x20-\x7e\n]*$/)
  })

  it('opens each cause with its headline and the id after it, then the example after for example when other members share the cause', () => {
    const report = buildReport(
      input([
        padded('s1', 'Save it', '8px'),
        padded('s2', 'Cancel it', '8px'),
        screenOf('s3', page([button(10)]), page([button(10, { color: 'rgb(9, 9, 9)' })]), [
          [10, 10, 80, 30],
        ]),
      ])
    )
    const [shared, single] = report.causes
    const text = renderReport(report)
    expect(text).toContain(
      `## the inner spacing of 2 buttons grew by 8 px, on 2 of 3 changed screenshots, 67% of changed pixels (${shared?.id ?? ''})\n- for example, the "Save it" button's inner spacing grew by 8 px, at \`getByText('Save it')\` in "s1 >> renders" (${screenshotId('s1')})\n- padding-left: was 0, now 8px\n- all occurrences: \`npx whydiff explain ${shared?.id ?? ''}\`\n`
    )
    expect(text).toContain(
      `## the "Save" button's label is lighter (was #000000, now #090909), on 1 of 3 changed screenshots, 33% of changed pixels (${single?.id ?? ''})\n- at \`getByText('Save')\` in "s3 >> renders" (${screenshotId('s3')})\n- color: was #000000, now #090909\n\n`
    )
  })

  it('leads with a run summary: the causes that reach the most changed screenshots, then what the rest holds', () => {
    const report = buildReport(
      input([
        padded('s1', 'Save it', '8px'),
        padded('s2', 'Cancel it', '8px'),
        screenOf('s3', page([button(10)]), page([button(10, { color: 'rgb(9, 9, 9)' })]), [
          [10, 10, 80, 30],
        ]),
        screenOf(
          's4',
          page([button(10), { tag: 'img', box: [300, 300, 200, 100], cls: ['hero'] }]),
          page([button(10), { tag: 'img', box: [300, 300, 200, 100], cls: ['hero'] }]),
          [[320, 320, 50, 50]]
        ),
      ])
    )
    const [shared, single] = report.causes
    expect(renderReport(report).split('\n').slice(2, 8)).toEqual([
      '',
      '2 causes appear on 3 of 4 changed screenshots, 74% of changed pixels, and account for every changed pixel there:',
      `- ${shared?.headline ?? ''} (${shared?.id ?? ''})`,
      `- ${single?.headline ?? ''} (${single?.id ?? ''})`,
      '',
      '1 unexplained region on 1 screenshot holds 26% of changed pixels.',
    ])
  })

  it('keeps the lines of a cause with nothing observable', () => {
    const report = buildReport(
      input([
        screenOf('s1', page([button(10)]), page([button(10, { display: 'inline-block' })]), [
          [10, 10, 80, 30],
        ]),
      ])
    )
    expect(report.causes[0]).not.toHaveProperty('observation')
    expect(renderReport(report)).toContain(
      `## the display property of 1 element changed, on the changed screenshot, 100% of changed pixels (${report.causes[0]?.id ?? ''})\n- at \`getByText('Save')\` in "s1 >> renders" (${screenshotId('s1')})\n- display: was block, now inline-block\n`
    )
  })

  it('says how far the effects moved and which way, in whole CSS px', () => {
    const report = buildReport(input([padded('s1', 'Save it', '8px')]))
    const effects: CauseV1['effects'] = [
      { kind: 'shifted', nodes: 2, vector: [0, -12] },
      { kind: 'shifted', nodes: 1, vector: [-4.4, 12.5] },
      { kind: 'shifted', nodes: 1, vector: [0.25, 0] },
    ]
    const causes = report.causes.map((cause) => ({ ...cause, effects }))
    expect(renderReport({ ...report, causes })).toContain(
      '\n- as a result, 2 elements moved 12 px up\n- as a result, 1 element moved 4 px left and 13 px down\n- as a result, 1 element moved less than 1 px\n'
    )
  })

  it('says by how much a value changed where the values differ per element', () => {
    const report = buildReport(input([padded('s1', 'Save it', '8px')]))
    const summary: CauseV1['summary'] = {
      kind: 'style',
      changes: [
        { prop: 'padding-left', delta: '<len +8px>' },
        { prop: 'color', delta: '<color>' },
        { prop: 'display', delta: '<kw block>flex>' },
      ],
    }
    const causes = report.causes.map((cause) => ({ ...cause, level: 2 as const, summary }))
    expect(renderReport({ ...report, causes })).toContain(
      '\n- padding-left: +8px; color: another colour; display: was block, now flex\n'
    )
  })

  it('counts an ambiguous cause in its changed elements, not in screenshots', () => {
    const lighter = { color: 'rgb(9, 9, 9)' }
    const report = buildReport(
      input([
        screenOf(
          's1',
          page([button(10, {}, 'One'), button(200, {}, 'Two')]),
          page([button(10, lighter, 'One'), button(200, lighter, 'Two')]),
          [
            [10, 10, 80, 30],
            [200, 10, 80, 30],
          ]
        ),
      ])
    )
    const causes = report.causes.map((c) => ({ ...c, match: 'ambiguous' as const, ambiguous: 1 }))
    expect(renderReport({ ...report, causes })).toContain(
      '\n- ambiguous: for 1 of 2 changed elements, two elements on the other side matched almost equally. The property change is the same for both, so the element named may be the wrong one.\n'
    )
  })
})

describe('renderReport: values on the rule line', () => {
  const props = ['display', 'padding-left', 'padding-right', 'color']
  const sheets = [{ href: 'http://app.test/ui-kit.css', hash: 'kit1' }]
  const side: Attributed = {
    sheets,
    rules: [{ sheet: 0, selector: '.ui-btn' }],
    attributions: [props.map(() => -1), [-1, 0, 0, 0]],
  }
  const row = (padding: string, color: string): string[] => ['block', padding, padding, color]
  const screen = (name: string, padding: string, color: string) =>
    screenOf(
      name,
      page([
        {
          tag: 'button',
          text: `Save ${name}`,
          box: [10, 10, 80, 30],
          style: row('16px', 'rgb(0, 0, 0)'),
          a: 1,
        },
      ]),
      page([
        {
          tag: 'button',
          text: `Save ${name}`,
          box: [10, 10, 80, 30],
          style: row(padding, color),
          a: 1,
        },
      ]),
      [[10, 10, 80, 30]],
      { props, before: side, after: side }
    )
  const ruleLine = (report: ReportV1): string[] =>
    renderReport(report)
      .split('\n')
      .filter((line) => line.startsWith('- `.ui-btn`') || line.startsWith('- to restore it'))

  it('says the values every member went between, longhands with the same pair together, and names the old ones in the restore line', () => {
    const report = buildReport(
      input([screen('s1', '24px', 'rgb(0, 0, 0)'), screen('s2', '24px', 'rgb(0, 0, 0)')])
    )
    expect(ruleLine(report)).toEqual([
      '- `.ui-btn` from `ui-kit.css` (unlayered) changed its declaration of padding-left, padding-right (was 16px, now 24px)',
      '- to restore it: change the rule in `ui-kit.css`, or set padding-left, padding-right back to 16px in your own stylesheet if `ui-kit.css` comes from a dependency',
    ])
  })

  it('says where values differ per element and points to them, never one member values as all', () => {
    const report = buildReport(
      input([screen('s1', '24px', 'rgb(9, 9, 9)'), screen('s2', '20px', 'rgb(9, 9, 9)')])
    )
    const id = report.causes[0]?.id ?? ''
    expect(ruleLine(report)).toEqual([
      `- \`.ui-btn\` from \`ui-kit.css\` (unlayered) changed its declaration of color (was #000000, now #090909), padding-left, padding-right (values differ per element: \`npx whydiff explain ${id}\`)`,
      '- to restore it: change the rule in `ui-kit.css`, or set the old values in your own stylesheet if `ui-kit.css` comes from a dependency',
    ])
  })

  it('puts the longhands whose values differ last and points to them once a line', () => {
    const report = buildReport(
      input([screen('s1', '24px', 'rgb(9, 9, 9)'), screen('s2', '24px', 'rgb(8, 8, 8)')])
    )
    const id = report.causes[0]?.id ?? ''
    expect(ruleLine(report)[0]).toBe(
      `- \`.ui-btn\` from \`ui-kit.css\` (unlayered) changed its declaration of padding-left, padding-right (was 16px, now 24px), color (values differ per element: \`npx whydiff explain ${id}\`)`
    )
    const [cause] = report.causes
    if (cause?.summary.kind !== 'rule') throw new Error('the fixture has a rule cause')
    const summary: RuleSummary = { ...cause.summary, sets: ['margin-top'] }
    expect(ruleLine({ ...report, causes: [{ ...cause, summary }] })[0]).toBe(
      `- \`.ui-btn\` from \`ui-kit.css\` (unlayered) now sets margin-top (values differ per element: \`npx whydiff explain ${id}\`); changed its declaration of padding-left, padding-right (was 16px, now 24px), color (values differ per element)`
    )
  })

  it('counts the members a rule now sets a longhand on and those it no longer sets it on, rather than both at once', () => {
    const report = buildReport(input(hoverRebuild()))
    expect(renderReport(report)).toContain(
      '- `.ui-btn:hover` from `index-*.css` (unlayered) now sets color on 2 elements and no longer sets it on 1 element\n'
    )
  })
})

describe('renderReport: the unexplained regions grouped', () => {
  const regions = (name: string, rects: [number, number, number, number][]) =>
    screenOf(
      name,
      page([button(10), { tag: 'img', box: [300, 300, 200, 100], cls: ['hero'] }]),
      page([button(10), { tag: 'img', box: [300, 300, 200, 100], cls: ['hero'] }]),
      rects
    )
  const same: [number, number, number, number][] = [
    [320, 320, 50, 50],
    [700, 700, 1, 1],
  ]

  it('folds screenshots with the same regions into one line and makes every breakdown add up', () => {
    const report = buildReport(
      input([
        regions('s1', same),
        regions('s2', same),
        regions('s3', [[330, 330, 20, 20]]),
        regions('s4', [
          [310, 310, 20, 20],
          [360, 330, 20, 20],
          [20, 15, 30, 15],
          [900, 600, 20, 20],
        ]),
      ])
    )
    const tail = renderReport(report).split('\n## Unexplained regions (9)\n')[1]?.split('\n') ?? []
    expect(tail.slice(2, 5)).toEqual([
      `- 2 regions on "s1 >> renders" (${screenshotId('s1')}) and the same on 1 more screenshot (${screenshotId('s2')}), 2,501 changed pixels each: 1 under \`<img>\`, 1 anti-aliasing; every region with its candidates: \`npx whydiff explain ${screenshotId('s1')}\``,
      `- 4 regions on "s4 >> renders" (${screenshotId('s4')}), 1,650 changed pixels: 2 under \`<img>\`, 2 other; 2 around \`locator('img.hero')\`, 2 around other elements; every region with its candidates: \`npx whydiff explain ${screenshotId('s4')}\``,
      `- 1 region on "s3 >> renders" (${screenshotId('s3')}), 400 changed pixels: 1 under \`<img>\`; around \`locator('img.hero')\`; every region with its candidates: \`npx whydiff explain ${screenshotId('s3')}\``,
    ])
  })
})

describe('describeEffect', () => {
  it('says how many moved by the most common vector when not all of them did', () => {
    expect(
      describeEffect({ kind: 'shifted', nodes: 145, vector: [-12, -12], vectorNodes: 120 })
    ).toBe('145 elements moved, 120 of them 12 px left and 12 px up')
    expect(describeEffect({ kind: 'shifted', nodes: 3, vector: [0, 4] })).toBe(
      '3 elements moved 4 px down'
    )
  })

  it.each([
    ['inherited', '1 element inherits the change', '2 elements inherit the change'],
    ['painted', '1 element looks different under it', '2 elements look different under it'],
    [
      'reflowed',
      '1 element was laid out again inside the same container',
      '2 elements were laid out again inside the same container',
    ],
  ] as const)('agrees the verb with the count: %s', (kind, one, two) => {
    expect(describeEffect({ kind, nodes: 1 })).toBe(one)
    expect(describeEffect({ kind, nodes: 2 })).toBe(two)
  })
})

describe('renderReport: rule sections', () => {
  const report = buildReport(input(ruleFamilies()))
  const [reset, grid] = report.causes

  it('names the rule that now wins and the rule it took the place of on one line, then where a fix goes', () => {
    const text = renderReport(report)
    expect(text).toContain(
      `## the color, font-weight and padding properties of 3 \`<div>\` elements, buttons and links changed, on 3 of 5 changed screenshots, 60% of changed pixels (\`*\`, ${reset?.id ?? ''})\n- for example, the "Save" button's inner spacing shrank by 8 px, at \`getByText('Save')\` in "s1 >> renders" (${screenshotId('s1')})\n- \`*\` from \`reset.css\` (unlayered) now sets color (was #0000ff, now #000000), font-weight (was 700, now 400), padding-left (was 8px, now 0px)\n- to restore it: change the rule in \`reset.css\`, or set the old values in your own stylesheet if \`reset.css\` comes from a dependency\n- all occurrences:`
    )
    expect(text).toContain(
      `## the inner spacing of 2 \`<div>\` elements shrank by 8 to 10 px, on 2 of 5 changed screenshots, 40% of changed pixels (\`.ui-col\` and 2 more, ${grid?.id ?? ''})\n- for example, the "Col" element's inner spacing shrank by 8 px, at \`getByText('Col')\` in "s4 >> renders" (${screenshotId('s4')})\n- \`.ui-col\` and 2 more from \`framework.css\` (layer \`framework.components\`) now sets padding-left (values differ per element: \`npx whydiff explain ${grid?.id ?? ''}\`) in place of \`.ui-col\` from \`app.css\` (unlayered)\n`
    )
    expect(renderScreenshot(report, screenshotId('s4'))).toContain(
      ' now sets padding-left (values differ per element: `npx whydiff explain '
    )
  })

  it('says where a fix goes only for a rule', () => {
    const plain = buildReport(
      input([padded('s1', 'Save it', '8px'), padded('s2', 'Cancel it', '8px')])
    )
    expect(renderReport(plain)).not.toContain('to restore it')
  })

  it('names what a rule now sets, changed and no longer sets on one line, and what its layer move means', () => {
    const moved = buildReport(input(ruleMove()))
    expect(renderReport(moved)).toContain(
      [
        `## the inner spacing of 2 of 4 \`<div>\` elements shrank by 12 to 16 px, on all 4 changed screenshots, 100% of changed pixels (\`.ui-col\`, ${moved.causes[0]?.id ?? ''})`,
        `- for example, the "Col" element's inner spacing shrank by 12 px, at \`getByText('Col')\` in "s1 >> renders" (${screenshotId('s1')})`,
        `- \`.ui-col\` from \`framework-*.css\` (layer \`framework.components\`) now sets font-weight (was 400, now 700); changed its declaration of color (was #0000ff, now #ff0000); no longer sets padding-left (values differ per element: \`npx whydiff explain ${moved.causes[0]?.id ?? ''}\`)`,
        "- it moved from unlayered into layer `framework.components`: its declarations now lose to any declaration of the same property outside a layer, whatever the selectors' specificity",
        '- to restore it: change the rule in the source file that builds `framework-*.css`, or set the old values in your own stylesheet if the rule comes from a dependency; whydiff cannot tell from a built sheet which it is',
        '- all occurrences:',
      ].join('\n')
    )
  })

  it('names the unlayered rule over the layered one of the same selector in the same sheet', () => {
    const text = renderReport(buildReport(input(ruleTwoLayers())))
    expect(text).toContain(
      '- `body` from `app.css` (unlayered) now sets color (was #000000, now #090909) in place of `body` from `app.css` (layer `base`)\n'
    )
    expect(text).not.toContain('changed its declaration')
    expect(text).not.toContain('moved')
  })

  it('names every rule an element changed under, the one that no longer sets its opacity after the reset that sets its paddings', () => {
    const field = buildReport(input(fieldReset()))
    expect(field.causes.map((c) => [c.kind, c.screenshots, c.elements, c.pixels])).toEqual([
      ['rule', 2, 4, 35_520],
      ['rule', 2, 2, 30_720],
    ])
    const text = renderReport(field)
    const [preflight, gone] = field.causes
    expect(text).toContain(
      `## the inner spacing of 4 buttons and text fields shrank by 8 to 24 px, on all 2 changed screenshots, 54% of changed pixels (\`*\`, ${preflight?.id ?? ''})\n- for example, the "Notes s1" text field's inner spacing shrank by 8 px, at \`getByRole('textbox', { name: 'Notes s1' })\` in "s1 >> renders" (${screenshotId('s1')})\n- \`*\` from \`reset.css\` (unlayered) now sets padding (all sides, values differ per element: \`npx whydiff explain ${preflight?.id ?? ''}\`)\n`
    )
    expect(text).toContain(
      `## 2 text fields become visible, on all 2 changed screenshots, 46% of changed pixels (\`.ui-field\`, ${gone?.id ?? ''})\n- for example, the "Notes s1" text field becomes visible, at \`getByRole('textbox', { name: 'Notes s1' })\` in "s1 >> renders" (${screenshotId('s1')})\n- \`.ui-field\` from \`app.css\` (unlayered) no longer sets opacity (was 0, now 1)\n- to restore it: change the rule in \`app.css\`, or set opacity back to 0 in your own stylesheet if \`app.css\` comes from a dependency\n`
    )
  })

  it('shows only the facts the cause can produce in its example, else what the cause changed there', () => {
    const field = buildReport(input(fieldReset()))
    const [preflight] = field.causes
    if (preflight === undefined) throw new Error('the fixture has a cause')
    const older: CauseV1 = {
      ...preflight,
      members: preflight.members.map((m) =>
        m.observation === undefined
          ? m
          : {
              ...m,
              observation: {
                ...m.observation,
                facts: [{ kind: 'visible' }],
                text: 'X',
              },
            }
      ),
    }
    expect(renderReport({ ...field, causes: [older, ...field.causes.slice(1)] })).toContain(
      `\n- for example, padding (all sides, was 2px, now 0px) changed, at \`getByRole('textbox', { name: 'Notes s1' })\` in "s1 >> renders" (${screenshotId('s1')})\n`
    )
  })

  it("shows a size in its example only on the axis the cause's properties move", () => {
    const field = buildReport(input(fieldReset()))
    const [preflight] = field.causes
    if (preflight?.summary.kind !== 'rule') throw new Error('the fixture has a rule cause')
    const vertical: CauseV1 = {
      ...preflight,
      summary: {
        ...preflight.summary,
        sets: [],
        changed: ['padding-bottom', 'padding-top'],
        unsets: [],
      },
      members: preflight.members.map((m) =>
        m.observation === undefined
          ? m
          : {
              ...m,
              observation: {
                ...m.observation,
                facts: [
                  { kind: 'width', from: 432, to: 416 },
                  { kind: 'height', from: 37, to: 42 },
                ],
                text: 'X',
              },
            }
      ),
    }
    expect(renderReport({ ...field, causes: [vertical, ...field.causes.slice(1)] })).toContain(
      `\n- for example, the "Notes s1" text field is 5 px taller (was 37, now 42), at \`getByRole('textbox', { name: 'Notes s1' })\` in "s1 >> renders" (${screenshotId('s1')})\n`
    )
  })

  it('names a selector list by its shortest selector, the first on a tie, and how many more', () => {
    const named = (selector: string): string | undefined => {
      const summary: CauseV1['summary'] = {
        kind: 'rule',
        selector,
        sheet: 'framework.css',
        sets: ['padding-left'],
        changed: [],
        unsets: [],
        over: { selector, sheet: 'app.css' },
      }
      const cause = reset === undefined ? undefined : { ...reset, summary }
      return renderReport({ ...report, causes: cause === undefined ? [] : [cause] })
        .split('\n')
        .find((line) => line.includes(' now sets '))
    }
    expect(named('.ui-col-12, .ui-col-6, :is(.ui-row, .ui-grid) > .ui-col, .ui-col')).toBe(
      '- `.ui-col` and 3 more from `framework.css` (unlayered) now sets padding-left in place of `.ui-col` and 3 more from `app.css` (unlayered)'
    )
    expect(named('h1, h2, h3')).toBe(
      '- `h1` and 2 more from `framework.css` (unlayered) now sets padding-left in place of `h1` and 2 more from `app.css` (unlayered)'
    )
    expect(named(':is(.ui-row, .ui-grid) > .ui-col')).toBe(
      '- `:is(.ui-row, .ui-grid) > .ui-col` from `framework.css` (unlayered) now sets padding-left in place of `:is(.ui-row, .ui-grid) > .ui-col` from `app.css` (unlayered)'
    )
  })

  it("closes a rule cause's heading with its rule as the rule line names it, and another cause's with its id alone", () => {
    if (reset === undefined) throw new Error('the fixture has a rule cause')
    const handle = (selector: string, sheet = 'app.css'): string =>
      handleOf({
        ...reset,
        summary: { kind: 'rule', selector, sheet, sets: [], changed: [], unsets: [] },
      })
    expect(handle('h1, h2, h3')).toBe(`\`h1\` and 2 more, ${reset.id}`)
    expect(handle('', 'style attribute of an ancestor')).toBe(
      `style attribute of an ancestor, ${reset.id}`
    )
    expect(handle('@property --ui-gap')).toBe(`\`@property --ui-gap\`, ${reset.id}`)
    expect(
      handleOf({
        ...reset,
        summary: { kind: 'style', changes: [{ prop: 'color', from: 'a', to: 'b' }] },
      })
    ).toBe(reset.id)
  })

  it('reads a changed declaration, removed sides, a move out of a layer and the style attribute', () => {
    const summaries: CauseV1['summary'][] = [
      {
        kind: 'rule',
        selector: '.ui-col',
        sheet: 'framework.css',
        layer: 'framework.components',
        sets: [],
        changed: ['column-gap'],
        unsets: [],
      },
      {
        kind: 'rule',
        selector: '',
        sheet: 'style attribute',
        sets: ['padding-left'],
        changed: [],
        unsets: [],
      },
      {
        kind: 'rule',
        selector: '.ui-col',
        sheet: 'framework.css',
        sets: [],
        changed: [],
        unsets: ['padding-bottom', 'padding-left', 'padding-right', 'padding-top'],
        layerFrom: 'framework.components',
      },
    ]
    const lines = summaries.map((summary) => {
      const cause = reset === undefined ? undefined : { ...reset, summary }
      const rendered: ReportV1 = {
        ...report,
        causes: cause === undefined ? [] : [cause],
        summary: { ...report.summary, causes: 1 },
      }
      const text = renderReport(rendered)
      return text
        .slice(text.indexOf('\n## '))
        .split('\n')
        .filter((line) => line.startsWith('- ') && !line.startsWith('- for example, '))
    })
    expect(lines[0]?.[0]).toBe(
      '- `.ui-col` from `framework.css` (layer `framework.components`) changed its declaration of column-gap'
    )
    expect(lines[1]?.slice(0, 2)).toEqual([
      '- the style attribute now sets padding-left',
      '- to restore it: change the style attribute where the markup or a script sets it',
    ])
    expect(lines[2]?.slice(0, 2)).toEqual([
      '- `.ui-col` from `framework.css` (unlayered) no longer sets padding (all sides)',
      "- it moved out of layer `framework.components`: outside a layer, its declarations now beat any declaration of the same property in a layer, whatever the selectors' specificity",
    ])
  })

  const lineOf = (summary: Partial<RuleSummary>, prefix: string): string | undefined => {
    const rule: RuleSummary = {
      kind: 'rule',
      selector: '.ui-col',
      sheet: 'framework.css',
      sets: ['padding-left'],
      changed: [],
      unsets: [],
      ...summary,
    }
    const cause = reset === undefined ? undefined : { ...reset, summary: rule }
    return renderReport({ ...report, causes: cause === undefined ? [] : [cause] })
      .split('\n')
      .find((line) => line.startsWith(prefix))
  }

  it.each([
    [
      { important: true as const, layerTo: 'ui.base' },
      "- it moved from unlayered into layer `ui.base`: its !important declarations now beat any !important declaration of the same property outside a layer, whatever the selectors' specificity",
    ],
    [
      { layerFrom: 'ui.base', layerTo: 'ui.theme' },
      "- it moved from layer `ui.base` into layer `ui.theme`: between declarations of the same property in two layers, the layer declared later wins, whatever the selectors' specificity",
    ],
    [
      { important: true as const, layerFrom: 'ui.base' },
      "- it moved out of layer `ui.base`: outside a layer, its !important declarations now lose to any !important declaration of the same property in a layer, whatever the selectors' specificity",
    ],
  ])('says what a move between layers means for the cascade: %j', (summary, line) => {
    expect(lineOf(summary, '- it moved ')).toBe(line)
  })

  it.each([
    [
      'vendor-ui-*.css',
      "- to restore it: set the old values in your own stylesheet; do not edit `vendor-ui-*.css`, which reads as a dependency's (vendor in its name)",
    ],
    [
      'chunk-vendors.*.css',
      "- to restore it: set the old values in your own stylesheet; do not edit `chunk-vendors.*.css`, which reads as a dependency's (vendor in its name)",
    ],
    [
      'index-*.css',
      '- to restore it: change the rule in the source file that builds `index-*.css`, or set the old values in your own stylesheet if the rule comes from a dependency; whydiff cannot tell from a built sheet which it is',
    ],
    [
      'index-DNgj_66d.css',
      '- to restore it: change the rule in the source file that builds `index-DNgj_66d.css`, or set the old values in your own stylesheet if the rule comes from a dependency; whydiff cannot tell from a built sheet which it is',
    ],
    [
      '<style> #2',
      '- to restore it: change the rule where `<style> #2` comes from, or set the old values in your own stylesheet if a dependency injects it; whydiff cannot tell which',
    ],
    [
      'vendored.css',
      '- to restore it: change the rule in `vendored.css`, or set the old values in your own stylesheet if `vendored.css` comes from a dependency',
    ],
  ])('says where a fix goes from what the sheet name tells: %s', (sheet, line) => {
    expect(lineOf({ sheet }, '- to restore it: ')).toBe(line)
  })
})

describe('an element without a readable name', () => {
  it('is named by its tag and class in the headline, the example, the page and the locator, never by an empty quote', () => {
    const icon = (style: Record<string, string> = {}): TreeSpec =>
      button(10, style, '\ue901', { cls: ['ui-icon-btn'], role: 'button', name: '\ue901' })
    const report = buildReport(
      input([
        screenOf('s1', page([icon()]), page([icon({ color: 'rgb(9, 9, 9)' })]), [[10, 10, 80, 30]]),
      ])
    )
    const [cause] = report.causes
    expect(cause?.headline).toMatch(/^a `<button\.ui-icon-btn>`'s label is lighter/)
    expect(cause?.members[0]?.locator).toBe("locator('button.ui-icon-btn')")
    const text = `${renderReport(report)}${renderScreenshot(report, screenshotId('s1'))}`
    expect(text).not.toMatch(/""|\ue901/)
  })
})

describe('renderScreenshot', () => {
  const same = page([button(10)])
  const report = buildReport(
    input([
      padded('s1', 'Save it', '8px'),
      screenOf('s2', same, same, [], { file: 'tests/home.spec.ts', line: 12, project: 'chromium' }),
    ])
  )

  it('describes one changed screenshot, its id after the counts it names, each cause under its run-wide headline', () => {
    const text = renderScreenshot(report, screenshotId('s1'))
    expect(text).toContain('\n# whydiff: s1 >> renders | 1 cause | 0 unexplained regions\n')
    expect(text).toContain(`\nsource: 1000x800 px, 2,400 changed pixels | ${screenshotId('s1')}\n`)
    expect(text).toContain(
      `\n## the "Save it" button's inner spacing grew by 8 px, on the changed screenshot, 100% of changed pixels (${report.causes[0]?.id ?? ''})\n- at \`getByText('Save it')\`\n- padding-left: was 0, now 8px\n`
    )
    expect(text).not.toMatch(/e\.g\.|for example/)
    expect(text).not.toContain('only in')
    expect(text).not.toContain('Unchanged:')
  })

  it('leaves the project out of the source line of a test whose project has no name', () => {
    const unnamed = buildReport(
      input([
        screenOf(
          's1',
          page([button(10)]),
          page([button(10, { color: 'rgb(9, 9, 9)' })]),
          [[10, 10, 80, 30]],
          { file: 'tests/settings.spec.ts', line: 3, project: '' }
        ),
      ])
    )
    expect(renderScreenshot(unnamed, screenshotId('s1'))).toMatch(
      /\nsource: tests\/settings\.spec\.ts:3 \| 1000x800 px, [\d,]+ changed pixels \| s[0-9a-z]{6}\n/
    )
  })

  it('heads a cause of one screenshot as the report heads it', () => {
    const alone = buildReport(input([padded('s1', 'Save it', '8px')]))
    expect(renderScreenshot(alone, screenshotId('s1'))).toContain(
      `\n## ${alone.causes[0]?.headline ?? ''} (${alone.causes[0]?.id ?? ''})\n`
    )
  })

  it('puts a name that holds Markdown in a code span wherever a title or a file is printed', () => {
    const marked = buildReport(
      input([
        screenOf(
          's1',
          page([button(10)]),
          page([button(10, { color: 'rgb(9, 9, 9)' })]),
          [[10, 10, 80, 30]],
          {
            title: 'renders <ui-card> in __main__',
            file: 'tests/__main__/card.spec.ts',
            line: 4,
            project: 'chromium',
          }
        ),
      ])
    )
    const text = renderScreenshot(marked, screenshotId('s1'))
    expect(text).toContain(
      '\n# whydiff: `renders <ui-card> in __main__` | 1 cause | 0 unexplained regions\n'
    )
    expect(text).toContain(
      `\nsource: \`tests/__main__/card.spec.ts\`:4 | chromium | 1000x800 px, 2,400 changed pixels | ${screenshotId('s1')}\n`
    )
  })

  it('says what changed on the screen first, from the members on that screen', () => {
    const shared = buildReport(
      input([
        screenOf(
          's1',
          page([button(10, {}, 'Save it'), button(200, {}, 'Keep it')]),
          page([
            button(10, { 'padding-left': '8px' }, 'Save it'),
            button(200, { display: 'inline-block' }, 'Keep it'),
          ]),
          [
            [10, 10, 80, 30],
            [200, 10, 80, 30],
          ]
        ),
        padded('s2', 'Cancel it', '8px'),
        screenOf(
          's3',
          page([button(10, {}, 'One'), button(200, {}, 'Two')]),
          page([
            button(10, { color: 'rgb(9, 9, 9)' }, 'One'),
            button(200, { color: 'rgb(9, 9, 9)' }, 'Two'),
          ]),
          [
            [10, 10, 80, 30],
            [200, 10, 80, 30],
          ]
        ),
      ])
    )
    const id = (prop: string): string =>
      shared.causes.find((c) => c.key.includes(`|${prop}=`))?.id ?? ''
    expect(renderScreenshot(shared, screenshotId('s1'))).toMatch(
      new RegExp(
        `^${SENTENCES.observed}\n- the "Save it" button's inner spacing grew by 8 px \\(${id('padding-left')}\\)\n\n# whydiff: s1 >> renders \\|`
      )
    )
    const elsewhere = renderScreenshot(shared, screenshotId('s2'))
    expect(elsewhere).toMatch(
      new RegExp(
        `^${SENTENCES.observed}\n- the "Cancel it" button's inner spacing grew by 8 px \\(${id('padding-left')}\\)\n\n`
      )
    )
    expect(elsewhere).toContain(
      `changed pixels (${id('padding-left')})\n- the "Cancel it" button's inner spacing grew by 8 px, at \`getByText('Cancel it')\`\n- padding-left: was 0, now 8px\n`
    )
    expect(renderScreenshot(shared, screenshotId('s3'))).toMatch(
      new RegExp(
        `^${SENTENCES.observed}\n- the "One" button's label is lighter \\(was #000000, now #090909\\), and 1 more element changed with it \\(${id('color')}\\)\n\n`
      )
    )
  })

  it('names the largest member of a cause on the screen, with its observation and place on one line, and counts every member there', () => {
    const lighter = { color: 'rgb(9, 9, 9)' }
    const pair = buildReport(
      input([
        screenOf(
          's1',
          page([button(10, {}, 'One'), button(200, {}, 'Two')]),
          page([button(10, lighter, 'One'), button(200, lighter, 'Two')]),
          [
            [10, 10, 80, 30],
            [200, 10, 80, 30],
          ]
        ),
      ])
    )
    const [cause] = pair.causes
    const moved: CauseV1['effects'] = [{ kind: 'shifted', nodes: 2, vector: [0, 12] }]
    const larger: ReportV1 = {
      ...pair,
      causes: pair.causes.map((c) => ({
        ...c,
        members: c.members.map((m, i) => (i === 1 ? { ...m, elements: 3, effects: moved } : m)),
      })),
    }
    const text = renderScreenshot(larger, screenshotId('s1'))
    expect(text).toContain(
      `(${cause?.id ?? ''})\n- 2 elements here; for example, the "Two" button's label is lighter (was #000000, now #090909), at \`getByText('Two')\`\n- color: was #000000, now #090909\n- as a result, 2 elements moved 12 px down\n`
    )
    expect(text).not.toContain('- at ')
  })

  it('says what changed on an element once, with every cause it belongs to, and how many more elements of them changed there', () => {
    const field = buildReport(input(fieldReset()))
    const [preflight, gone] = field.causes
    const ids = `${preflight?.id ?? ''}, ${gone?.id ?? ''}`
    const observed = `the "Notes s1" text field becomes visible and its inner spacing shrank by 8 px`
    expect(renderScreenshot(field, screenshotId('s1'))).toContain(
      `${SENTENCES.observed}\n- ${observed}, and 1 more element changed with it (${ids})\n\n# whydiff: `
    )
    const reversed: ReportV1 = { ...field, causes: [...field.causes].reverse() }
    expect(renderScreenshot(reversed, screenshotId('s1'))).toContain(
      `${SENTENCES.observed}\n- ${observed}, and 1 more element changed with it (${gone?.id ?? ''}, ${preflight?.id ?? ''})\n\n`
    )
    const elsewhere: ReportV1 = {
      ...field,
      causes: field.causes.map((c) =>
        c.id === gone?.id
          ? { ...c, members: c.members.map((m) => ({ ...m, locator: "locator('#notes')" })) }
          : c
      ),
    }
    expect(renderScreenshot(elsewhere, screenshotId('s1'))).toContain(
      `${SENTENCES.observed}\n- ${observed}, and 1 more element changed with it (${preflight?.id ?? ''})\n- ${observed} (${gone?.id ?? ''})\n\n`
    )
  })

  it('says why an identical screenshot is unchanged as describeUnchanged does, its size change included', () => {
    const id = screenshotId('s2')
    const resized: ReportV1 = {
      ...report,
      screenshots: report.screenshots.map((s) =>
        s.id === id ? { ...s, sizeMismatch: { before: [1000, 800], after: [1000, 900] } } : s
      ),
    }
    expect(renderScreenshot(resized, id).split('\n').slice(0, 4)).toEqual([
      '# whydiff: s2 >> renders | no visible change',
      'compared: main -> feat/x | chromium 147 1000x800',
      `source: tests/home.spec.ts:12 | chromium | 1000x800 px, 0 changed pixels | ${id}`,
      'The screenshot was 1000x800 px, now 1000x900 px: the 800,000 pixels both cover are unchanged and the area only one covers is blank.',
    ])
    expect(renderScreenshot(report, id)).toContain(
      "\nNone of the 800,000 pixels differs at whydiff's own comparison threshold.\n"
    )
  })

  it('says so for an identical screenshot and for an unknown id', () => {
    expect(renderScreenshot(report, screenshotId('s2'))).toContain(
      '# whydiff: s2 >> renders | no visible change'
    )
    expect(renderScreenshot(report, screenshotId('s2'))).toContain(
      `source: tests/home.spec.ts:12 | chromium | 1000x800 px, 0 changed pixels | ${screenshotId('s2')}`
    )
    expect(renderScreenshot(report, 'sxxxxxx')).toBe(
      '# whydiff: no screenshot sxxxxxx in this report\n'
    )
  })
})

describe('changedLines', () => {
  it('gives the lines a screenshot page opens with as data: plain text, Markdown, how many more changed and cause ids', () => {
    const report = buildReport(input(markdownTraps()))
    const lines = changedLines(report, screenshotId('s1'))
    const [row, total] = report.causes
    expect(lines).toEqual([
      {
        text: 'the "Total *" button\'s label is lighter (was #000000, now #090909)',
        markdown: 'the `"Total *"` button\'s label is lighter (was #000000, now #090909)',
        others: 0,
        causes: [total?.id],
      },
      {
        text: "a <div>'s inner spacing shrank by 12 px",
        markdown: "a `<div>`'s inner spacing shrank by 12 px",
        others: 0,
        causes: [row?.id],
      },
    ])
    const page = renderScreenshot(report, screenshotId('s1'))
    for (const line of lines) {
      expect(page).toContain(`\n- ${line.markdown} (${line.causes.join(', ')})\n`)
    }
  })

  it("counts every other element of a line's causes on the screen once, however many of them it belongs to", () => {
    const field = buildReport(input(fieldReset()))
    const [preflight, gone] = field.causes
    const s1 = screenshotId('s1')
    const [line] = changedLines(field, s1)
    expect(line?.causes).toEqual([preflight?.id, gone?.id])
    const others = (preflight?.members ?? [])
      .filter((m) => m.screenshot === s1 && m.locator !== gone?.members[0]?.locator)
      .map((m) => ({ ...m, elements: 0 }))
    const [other] = others
    if (other === undefined) throw new Error('the cause has another member on s1')
    const extra = { ...other, locator: "locator('#extra')" }
    const wider: ReportV1 = {
      ...field,
      causes: field.causes.map((c) =>
        c.id === gone?.id ? { ...c, members: [...c.members, ...others, extra] } : c
      ),
    }
    const [counted] = changedLines(wider, s1)
    expect(counted?.causes).toEqual(line?.causes)
    expect(line?.others).toBe(others.length)
    expect(counted?.others).toBe(others.length + 1)
    expect(counted?.text).toMatch(/, and 2 more elements changed with it$/)
  })

  it('is empty where no member is observed, as the page then opens with its header, and for an unknown screenshot', () => {
    const report = buildReport(
      input([
        screenOf('s1', page([button(10)]), page([button(10, { display: 'inline-block' })]), [
          [10, 10, 80, 30],
        ]),
      ])
    )
    expect(changedLines(report, screenshotId('s1'))).toEqual([])
    expect(renderScreenshot(report, screenshotId('s1'))).toMatch(/^# whydiff: /)
    expect(changedLines(report, 'sunknown')).toEqual([])
  })
})

describe('bareHeadline', () => {
  it("gives each cause's headline without its share of the run", () => {
    const report = buildReport(input(markdownTraps()))
    expect(report.causes.length).toBeGreaterThan(0)
    for (const cause of report.causes) {
      const bare = bareHeadline(report, cause)
      expect(cause.headline).toMatch(
        /, on (?:all )?\d+ (?:of \d+ )?changed screenshots, \d+% of changed pixels$/
      )
      expect(cause.headline.startsWith(`${bare}, on `)).toBe(true)
      expect(bare).not.toMatch(/changed (?:screenshots?|pixels)/)
    }
  })
})

describe('describeUnchanged', () => {
  const unchanged: ScreenshotV1 = {
    id: 's1',
    title: 'card',
    status: 'identical',
    width: 800,
    height: 600,
    regions: 0,
    pixels: 0,
    massChange: false,
    causes: [],
    unexplained: [],
  }

  it('names both sizes, the pixels both cover and the blank rest of a screenshot whose size changed', () => {
    expect(
      describeUnchanged({ ...unchanged, sizeMismatch: { before: [800, 600], after: [800, 740] } })
    ).toBe(
      'the screenshot was 800x600 px, now 800x740 px: the 480,000 pixels both cover are unchanged and the area only one covers is blank'
    )
    expect(
      describeUnchanged({ ...unchanged, sizeMismatch: { before: [800, 600], after: [700, 650] } })
    ).toContain(': the 420,000 pixels both cover are unchanged')
  })

  it("says that none of the pixels differs at whydiff's own threshold when the size held", () => {
    expect(describeUnchanged(unchanged)).toBe(
      "none of the 480,000 pixels differs at whydiff's own comparison threshold"
    )
  })
})

describe('renderScreenshot: what changed, in the order a person notices it', () => {
  const observation = (
    element: ObservationV1['element'],
    kind: ObservationV1['facts'][number]['kind'],
    text: string
  ): ObservationV1 => ({ element, facts: [{ kind }], text })
  const lines = [
    observation({ class: 'ui-row', tag: 'div' }, 'width', 'a `<div.ui-row>` is 24 px narrower'),
    observation(
      { role: 'button', name: 'Save', tag: 'button' },
      'y',
      'the "Save" button moved 8 px down'
    ),
    observation({ name: 'Total', tag: 'span' }, 'text', 'the "Total" text changed'),
    observation({ role: 'img', name: 'Logo', tag: 'img' }, 'gone', 'the "Logo" image is gone'),
    observation(
      { role: 'button', class: 'ui-close', tag: 'button' },
      'visible',
      'a `<button.ui-close>` becomes visible'
    ),
  ]
  const base = buildReport(input([padded('s1', 'Save it', '8px')]))

  it('says what appeared or went first, then named elements that changed, then moves and unnamed containers, each in cause order', () => {
    const [template] = base.causes
    const screen = base.screenshots[0]
    if (template === undefined || screen === undefined) throw new Error('the fixture has a cause')
    const causes: CauseV1[] = lines.map((o, i) => ({
      ...template,
      id: `c${String(i)}`,
      members: template.members.map((m) => ({
        ...m,
        locator: `locator('#e${String(i)}')`,
        observation: o,
      })),
    }))
    const report: ReportV1 = {
      ...base,
      causes,
      screenshots: [{ ...screen, causes: causes.map((c) => c.id) }],
    }
    expect(renderScreenshot(report, screen.id).split('\n\n')[0]).toBe(
      [
        SENTENCES.observed,
        '- the "Logo" image is gone (c3)',
        '- a `<button.ui-close>` becomes visible (c4)',
        '- the "Total" text changed (c2)',
        '- a `<div.ui-row>` is 24 px narrower (c0)',
        '- the "Save" button moved 8 px down (c1)',
      ].join('\n')
    )
  })
})

describe('describeMemberChanges', () => {
  it('reads four equal sides as one and keeps the rest one by one', () => {
    const sides = ['top', 'right', 'bottom', 'left'].map((side) => ({
      prop: `padding-${side}`,
      from: '0px',
      to: '12px',
    }))
    expect(describeMemberChanges([...sides, { prop: 'margin-left', from: '0px', to: '4px' }])).toBe(
      'padding (all sides) 0px -> 12px; margin-left 0px -> 4px'
    )
  })

  it('prints a colour in the notation the observations use', () => {
    expect(
      describeMemberChanges([
        { prop: 'background-color', from: 'rgba(0, 0, 0, 0)', to: 'rgb(9, 9, 9)' },
        { prop: 'box-shadow', from: 'none', to: 'rgb(0, 0, 0) 0px 1px 2px 0px' },
      ])
    ).toBe(
      'background-color transparent -> #090909; box-shadow none -> rgb(0, 0, 0) 0px 1px 2px 0px'
    )
  })
})

describe('causeParts: a keyword delta of any length', () => {
  /** The pattern as CodeQL's `js/polynomial-redos` found it, quadratic on its witness: the reference for any delta. */
  const QUADRATIC_KEYWORDS = /^<kw (.*?)>(.*)>$/
  /** The quadratic pattern takes seconds on the witness below, the linear one about a millisecond. */
  const LINEAR_MS = 100
  const report = buildReport(input([padded('s1', 'Save it', '8px')]))
  const why = (delta: string): readonly string[] => {
    const [cause] = report.causes
    if (cause === undefined) throw new Error('the padding changed')
    const summary: CauseV1['summary'] = { kind: 'style', changes: [{ prop: 'display', delta }] }
    return causeParts({ ...cause, level: 2, summary }, report).why
  }

  it('says any delta as the quadratic pattern read it', () => {
    const units = fc.constantFrom('<', '>', 'k', 'w', ' ', 'a', '\n', '\r', '\u2028', '\u2029')
    const text = fc.string({ unit: units, maxLength: 8 })
    const deltas = fc.oneof(
      fc.tuple(text, text).map(([from, to]) => `<kw ${from}>${to}>`),
      text.map((rest) => `<kw ${rest}`),
      text
    )
    fc.assert(
      fc.property(deltas, (delta) => {
        const pair = QUADRATIC_KEYWORDS.exec(delta)
        const said =
          pair === null ? safe(delta) : `was ${safe(pair[1] ?? '')}, now ${safe(pair[2] ?? '')}`
        expect(why(delta)).toEqual([`display: ${said}`])
      }),
      { numRuns: 2000 }
    )
  })

  it("says CodeQL's witness delta in linear time", () => {
    const delta = `<kw >${'>a'.repeat(30_000)}`
    const start = performance.now()
    const said = why(delta)
    expect(performance.now() - start).toBeLessThan(LINEAR_MS)
    expect(said).toEqual([`display: ${safe(delta)}`])
  })
})
