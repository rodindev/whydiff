import fc from 'fast-check'

import type { Effect } from '../causes/types.js'
import { clusterCauses } from '../cluster/cluster.js'
import type { Pair } from '../match/types.js'
import { button, formControls, page, screenOf, styleRow } from '../testing/screens.js'
import type { TreeSpec } from '../testing/snapshots.js'
import { buildReport } from './build.js'
import { screenshotId, unexplainedId } from './ids.js'
import { parseReport } from './parse.js'
import { renderReport, renderScreenshot } from './render.js'
import { serializeReport } from './serialize.js'
import type { ReportInput, ScreenInput } from './types.js'

const padded = (name: string, text: string, to: string, file?: string): ScreenInput =>
  screenOf(
    name,
    page([button(10, {}, text)]),
    page([button(10, { 'padding-left': to }, text)]),
    [[10, 10, 80, 30]],
    file === undefined ? {} : { file }
  )

function input(screens: readonly ScreenInput[]): ReportInput {
  return {
    version: '0.0.1',
    compared: { before: 'main', after: 'feat/x' },
    screens,
    clusters: clusterCauses(screens.filter((s) => s.regions.length > 0)),
  }
}

/** The same screen with the button's pair downgraded to the given pass and ambiguity. */
function repaired(screen: ScreenInput, pass: Pair['pass'], ambiguous: boolean): ScreenInput {
  const pairs = screen.matching.pairs.map((pair) =>
    screen.before.nodes[pair.before]?.tag === 'button'
      ? { ...pair, pass, ...(ambiguous ? { ambiguous: true as const } : {}) }
      : pair
  )
  return { ...screen, matching: { ...screen.matching, pairs } }
}

describe('buildReport', () => {
  it('numbers screenshots in input order and causes in cluster order', () => {
    const same = page([button(10)])
    const report = buildReport(
      input([
        screenOf('idle', same, same, []),
        padded('a', 'Save it', '8px'),
        padded('b', 'Cancel it', '8px'),
      ])
    )
    expect(report.screenshots.map((s) => [s.id, s.status])).toEqual([
      [screenshotId('idle'), 'identical'],
      [screenshotId('a'), 'changed'],
      [screenshotId('b'), 'changed'],
    ])
    const [cause] = report.causes
    expect(cause?.id).toMatch(/^c[0-9a-z]{6}$/)
    expect(report.screenshots[1]?.causes).toEqual([cause?.id])
    expect(report.summary).toEqual({
      screenshots: { compared: 3, changed: 2, identical: 1 },
      causes: 1,
      unexplained: 0,
      massChange: 0,
      lead: {
        causes: [cause?.id],
        screenshots: 2,
        settled: 2,
        pixels: 4800,
        text: `1 cause appears on all 2 changed screenshots, 100% of changed pixels, and accounts for every changed pixel there:\n- ${cause?.headline ?? ''} (${cause?.id ?? ''})`,
      },
    })
  })

  it('lists a cause that settles a screenshot without adding one, and counts the screenshots the list appears on and those it accounts for every changed pixel on', () => {
    const report = buildReport(
      input([
        padded('a', 'Save it', '8px'),
        padded('b', 'Cancel it', '8px'),
        screenOf(
          'c',
          page([button(10, {}, 'One'), button(200, {}, 'Two')]),
          page([
            button(10, { 'padding-left': '8px' }, 'One'),
            button(200, { color: 'rgb(9, 9, 9)' }, 'Two'),
          ]),
          [
            [10, 10, 80, 30],
            [200, 10, 80, 30],
          ]
        ),
        screenOf(
          'd',
          page([button(10, {}, 'Four'), { tag: 'img', box: [300, 300, 200, 100] }]),
          page([
            button(10, { 'padding-left': '8px' }, 'Four'),
            { tag: 'img', box: [300, 300, 200, 100] },
          ]),
          [
            [10, 10, 80, 30],
            [320, 320, 50, 50],
          ]
        ),
      ])
    )
    const [padding, colour] = report.causes
    expect(report.unexplained.map((u) => u.screenshot)).toEqual([screenshotId('d')])
    expect(report.summary.lead).toMatchObject({
      causes: [padding?.id, colour?.id],
      screenshots: 4,
      settled: 3,
    })
    expect(report.summary.lead.text.split('\n')[0]).toBe(
      '2 causes appear on all 4 changed screenshots, 83% of changed pixels; they account for every changed pixel on 3 of them:'
    )
  })

  it('records where each member is in the pixels of each PNG, rounded out to whole pixels', () => {
    const report = buildReport(
      input([
        screenOf(
          'a',
          page([button(10.5, {}, 'Save it')]),
          page([button(10.5, { 'padding-left': '8px' }, 'Save it')]),
          [[10, 10, 81, 30]],
          { before: { k: 2 }, after: { origin: [0, 4] } }
        ),
      ])
    )
    expect(report.causes[0]?.members[0]?.box).toEqual({
      before: [21, 20, 160, 60],
      after: [10, 6, 81, 30],
    })
  })

  it('scopes a cause to one spec file or to the run', () => {
    const local = buildReport(input([padded('a', 'Save it', '8px', 'tests/a.spec.ts')]))
    expect(local.causes[0]).toMatchObject({
      scope: 'local',
      file: 'tests/a.spec.ts',
      screenshots: 1,
    })
    const global = buildReport(
      input([
        padded('a', 'Save it', '8px', 'tests/a.spec.ts'),
        padded('b', 'Cancel it', '8px', 'tests/b.spec.ts'),
      ])
    )
    expect(global.causes[0]).toMatchObject({ scope: 'global', screenshots: 2 })
    expect(global.causes[0]?.file).toBeUndefined()
  })

  it('derives the match word from the members pairs', () => {
    const exact = padded('a', 'Save it', '8px')
    expect(buildReport(input([exact])).causes[0]?.match).toBe('exact')
    const likely = repaired(padded('b', 'Cancel it', '8px'), 3, false)
    expect(buildReport(input([exact, likely])).causes[0]?.match).toBe('likely')
    const ambiguous = repaired(padded('c', 'Reset it', '8px'), 3, true)
    const report = buildReport(input([exact, likely, ambiguous]))
    expect(report.causes[0]).toMatchObject({ match: 'ambiguous', ambiguous: 1 })
    expect(renderReport(report)).toContain(
      'ambiguous: for 1 of 3 changed elements, two elements on the other side matched almost equally.'
    )
  })

  it('carries each member own non-derived changes with the captured values', () => {
    const report = buildReport(
      input([
        screenOf(
          'a',
          page([button(10, {}, 'Save it')]),
          page([button(10, { 'padding-left': '8px', color: 'rgb(9, 9, 9)' }, 'Save it')]),
          [[10, 10, 80, 30]]
        ),
      ])
    )
    expect(report.causes[0]?.members[0]?.changes).toEqual([
      { prop: 'color', from: 'rgb(0, 0, 0)', to: 'rgb(9, 9, 9)' },
      { prop: 'padding-left', from: '0px', to: '8px' },
    ])
    const text = serializeReport(report)
    expect(text).toContain('"changes": [\n            {\n              "prop": "color"')
    expect(parseReport(text)).toEqual(report)
  })

  it('observes every member on the screen it was found on', () => {
    const lonely = screenOf(
      'b',
      page([button(10, {}, 'Cancel it'), button(200, {}, 'Reset it')]),
      page([
        button(10, { 'padding-left': '8px' }, 'Cancel it'),
        button(200, { 'padding-left': '8px' }, 'Reset it'),
      ]),
      [
        [10, 10, 80, 30],
        [200, 10, 80, 30],
      ]
    )
    const report = buildReport(input([padded('a', 'Save it', '8px'), lonely]))
    const [cause] = report.causes
    expect(cause?.example.screenshot).toBe(screenshotId('a'))
    expect(cause?.members.map((m) => [m.screenshot, m.observation?.text])).toEqual([
      [screenshotId('a'), 'the "Save it" button\'s inner spacing grew by 8 px'],
      [screenshotId('b'), 'the "Cancel it" button\'s inner spacing grew by 8 px'],
      [screenshotId('b'), 'the "Reset it" button\'s inner spacing grew by 8 px'],
    ])
    expect(cause?.members[0]?.observation).toEqual({
      element: { role: 'button', name: 'Save it', tag: 'button' },
      facts: [{ kind: 'padding', from: 0, to: 8 }],
      text: 'the "Save it" button\'s inner spacing grew by 8 px',
    })
    const text = serializeReport(report)
    expect(text).toContain(
      '"observation": {\n            "element": {\n              "role": "button"'
    )
    expect(parseReport(text)).toEqual(report)
  })

  it('keeps the parts of one BEM block with the same change in one cause, each named by its own part', () => {
    const part = (cls: string, overrides: Record<string, string> = {}): TreeSpec => ({
      tag: 'div',
      cls: [cls],
      box: [10, 10, 80, 30],
      style: styleRow(overrides),
    })
    const spaced = (name: string, cls: string): ScreenInput =>
      screenOf(name, page([part(cls)]), page([part(cls, { 'padding-left': '8px' })]), [
        [10, 10, 80, 30],
      ])
    const report = buildReport(
      input([spaced('a', 'ui-table__head'), spaced('b', 'ui-table__cell')])
    )
    expect(report.causes.map((c) => [c.kind, c.members.length])).toEqual([['ui-table', 2]])
    expect(report.causes[0]?.members.map((m) => [m.locator, m.observation?.element.class])).toEqual(
      [
        ["locator('div.ui-table__head')", 'ui-table__head'],
        ["locator('div.ui-table__cell')", 'ui-table__cell'],
      ]
    )
  })

  it('leaves changes off a member whose cause is not about styles', () => {
    const before = page([button(10, {}, 'Save it')])
    const report = buildReport(input([screenOf('a', before, page([]), [[10, 10, 80, 30]])]))
    expect(report.causes[0]?.summary).toEqual({ kind: 'removed' })
    expect(report.causes[0]?.members[0]).not.toHaveProperty('changes')
  })

  it('lists regions no cause touches with candidates and a note', () => {
    const before = page([button(10), { tag: 'img', box: [300, 300, 200, 100], cls: ['hero'] }])
    const report = buildReport(
      input([
        screenOf('a', before, before, [
          [320, 320, 50, 50],
          [700, 700, 1, 1],
        ]),
      ])
    )
    expect(report.unexplained).toEqual([
      {
        id: unexplainedId('a', [320, 320, 50, 50]),
        screenshot: screenshotId('a'),
        region: [320, 320, 50, 50],
        pixels: 2500,
        candidates: [
          { locator: "locator('img.hero')", share: 125 },
          { locator: "locator('body')", share: 3 },
          { locator: "locator('html')", share: 3 },
        ],
        note: 'under `<img>`',
      },
      {
        id: unexplainedId('a', [700, 700, 1, 1]),
        screenshot: screenshotId('a'),
        region: [700, 700, 1, 1],
        pixels: 1,
        candidates: [
          { locator: "locator('body')", share: 3 },
          { locator: "locator('html')", share: 3 },
        ],
        note: 'anti-aliasing',
      },
    ])
    expect(report.screenshots[0]?.unexplained).toEqual([
      unexplainedId('a', [320, 320, 50, 50]),
      unexplainedId('a', [700, 700, 1, 1]),
    ])
    expect(renderScreenshot(report, screenshotId('a'))).toContain(
      `- ${unexplainedId('a', [320, 320, 50, 50])} in "a >> renders" (${screenshotId('a')}) | region 50x50 at (320,320), 2,500 changed pixels | under \`<img>\` | candidates, by how much of their box changed: \`locator('img.hero')\` 12.5%, \`locator('body')\` 0.3%, \`locator('html')\` 0.3%`
    )
    expect(renderReport(report)).toContain(
      `\n- 2 regions on "a >> renders" (${screenshotId('a')}), 2,501 changed pixels: 1 under \`<img>\`, 1 anti-aliasing; every region with its candidates: \`npx whydiff explain ${screenshotId('a')}\`\n`
    )
  })

  it('notes a region the resize corner rule left without a cause and one inside a form control', () => {
    const report = buildReport(input(formControls()))
    expect(report.summary.causes).toBe(1)
    expect(report.unexplained.map((u) => [u.region, u.note])).toEqual([
      [[326, 130, 7, 7], "inside the resize corner of `getByRole('textbox', { name: 'Notes' })`"],
      [
        [28, 170, 62, 9],
        'inside `<input>`: placeholder, value text or control internals, which whydiff does not capture',
      ],
    ])
    const field = page([
      {
        tag: 'input',
        cls: ['ui-field'],
        box: [16, 160, 320, 30],
        style: styleRow({ 'padding-left': '8px' }),
      },
    ])
    const padding = buildReport(input([screenOf('a', field, field, [[18, 170, 4, 9]])]))
    expect(padding.unexplained[0]?.candidates[0]?.locator).toBe("locator('input.ui-field')")
    expect(padding.unexplained[0]).not.toHaveProperty('note')
  })

  it('says how many nodes moved by the most common vector when not all of them did', () => {
    const screen = padded('a', 'Save it', '8px')
    const moved = (effects: Effect[]): ScreenInput => ({
      ...screen,
      explanation: {
        ...screen.explanation,
        causes: screen.explanation.causes.map((c) => ({ ...c, effects })),
      },
    })
    const mixed = buildReport(
      input([
        moved([
          { kind: 'shifted', nodes: [5, 6], vector: [0, 12] },
          { kind: 'shifted', nodes: [7], vector: [0, 4] },
        ]),
      ])
    )
    expect(mixed.causes[0]?.effects).toEqual([
      { kind: 'shifted', nodes: 3, vector: [0, 12], vectorNodes: 2 },
    ])
    expect(mixed.causes[0]?.members[0]?.effects).toEqual(mixed.causes[0]?.effects)
    const alike = buildReport(input([moved([{ kind: 'shifted', nodes: [5, 6], vector: [0, 12] }])]))
    expect(alike.causes[0]?.effects).toEqual([{ kind: 'shifted', nodes: 2, vector: [0, 12] }])
  })

  it('has dense ids, names every cause in the Markdown and round-trips through text', () => {
    const texts = ['Save it', 'Cancel it', 'Reset it', 'Other one', 'Last one']
    const widths = ['8px', '12px', '16px']
    const cache = new Map<string, ScreenInput>()
    const screenFor = (text: string, to: string, changed: boolean): ScreenInput => {
      const key = `${text}|${to}|${String(changed)}`
      let screen = cache.get(key)
      if (screen === undefined) {
        const same = page([button(10, {}, text)])
        screen = changed ? padded('x', text, to) : screenOf('x', same, same, [])
        cache.set(key, screen)
      }
      return screen
    }
    const specs = fc.array(
      fc.record({
        text: fc.constantFrom(...texts),
        to: fc.constantFrom(...widths),
        changed: fc.boolean(),
      }),
      { minLength: 1, maxLength: 5 }
    )
    fc.assert(
      fc.property(specs, (list) => {
        const inputs = list.map((spec, index) => ({
          ...screenFor(spec.text, spec.to, spec.changed),
          screen: `s${String(index)}`,
        }))
        const report = buildReport(input(inputs))
        expect(report.screenshots.map((s) => s.id)).toEqual(
          inputs.map((input) => screenshotId(input.screen))
        )
        const ids = report.causes.map((c) => c.id)
        expect(new Set(ids).size).toBe(ids.length)
        for (const id of ids) expect(id).toMatch(/^c[0-9a-z]{6}$/)
        const markdown = renderReport(report)
        for (const cause of report.causes) {
          expect(cause.text.startsWith(`## ${cause.headline}`)).toBe(true)
          expect(cause.text.split('\n')[0]?.endsWith(` (${cause.id})`)).toBe(true)
          expect(markdown).toContain(`\n${cause.text}\n`)
        }
        expect(renderReport(buildReport(input(inputs)))).toBe(markdown)
        const text = serializeReport(report)
        expect(parseReport(text)).toEqual(report)
        expect(serializeReport(parseReport(text))).toBe(text)
      }),
      { numRuns: 50 }
    )
  }, 30_000)
})
