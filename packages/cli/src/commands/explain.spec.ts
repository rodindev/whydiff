import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { run } from '../main.js'
import { fakeProcess } from '../testing.js'

const fixture = new URL('../../../core/fixtures/report/run/', import.meta.url).pathname

interface Member {
  screenshot: string
  locator: string
  elements: number
  effects: unknown[]
}

interface Change {
  prop: string
  from: string
  to: string
}

const SCREENSHOTS = ['s4udgzc', 's4udft9', 's4udg7a']
const padding = (to: string): Change[] => [{ prop: 'padding-left', from: '0px', to }]
const allSides: Change[] = ['bottom', 'left', 'right', 'top'].map((side) => ({
  prop: `padding-${side}`,
  from: '0px',
  to: '12px',
}))

describe('explain', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'whydiff-explain-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('prints a cause as the run report renders it, then its members grouped by identical changes', async () => {
    const p = fakeProcess(fixture)
    expect(await run(['explain', 'c3ln8mq', '--report', 'report.json'], p)).toBe(0)
    expect(p.text.stderr).toBe('')
    await expect(p.text.stdout).toMatchFileSnapshot('../../fixtures/explain/cause.md')
  })

  it('leaves out of a cause the line that only names the command just run, never a line that says more', async () => {
    const report = new URL('../../../core/fixtures/report/field-reset/report.json', import.meta.url)
    const p = fakeProcess(fixture)
    expect(await run(['explain', 'c1aw389', '--report', report.pathname], p)).toBe(0)
    expect(p.text.stdout).not.toContain('all occurrences')
    expect(p.text.stdout).toContain(
      '(all sides, values differ per element: `npx whydiff explain c1aw389`)\n'
    )
    const all = fakeProcess(fixture)
    expect(await run(['explain', 'c1aw389', '--all', '--report', report.pathname], all)).toBe(0)
    expect(all.text.stdout).not.toContain('all occurrences')
  })

  it('prints a screenshot in the single-pair form, then the members of its causes', async () => {
    const p = fakeProcess(fixture)
    expect(await run(['explain', 's4udi5f', '--report', 'report.json'], p)).toBe(0)
    await expect(p.text.stdout).toMatchFileSnapshot('../../fixtures/explain/screenshot.md')
  })

  it('prints every cause under --all without an id, as the run report renders each', async () => {
    const p = fakeProcess(fixture)
    expect(await run(['explain', '--all', '--report', 'report.json'], p)).toBe(0)
    const markdown = await readFile(join(fixture, 'report.md'), 'utf8')
    const blocks = markdown
      .split('\n\n')
      .filter((block) => block.startsWith('## ') && !block.startsWith('## Unexplained'))
    expect(blocks.map((block) => / \((c[0-9a-z]+)\)\n/.exec(block)?.[1])).toEqual([
      'c3ln8mq',
      'c2esjnt',
      'c1m5c6x',
    ])
    expect(p.text.stdout).toBe(`report: report.json\n\n${blocks.join('\n\n')}\n`)
    const json = fakeProcess(fixture)
    expect(await run(['explain', '--all', '--report', 'report.json', '--json'], json)).toBe(0)
    const parsed = JSON.parse(json.text.stdout) as { causes: { id: string }[] }
    expect(parsed.causes.map((c) => c.id)).toEqual(['c3ln8mq', 'c2esjnt', 'c1m5c6x'])
    const none = fakeProcess(fixture)
    expect(await run(['explain', '--report', 'report.json'], none)).toBe(2)
    expect(none.text.stderr).toBe(
      'whydiff: explain takes ids from the report, or --all for every cause: npx whydiff explain --all.\n'
    )
  })

  it('takes several ids and prints the subset as JSON under --json', async () => {
    const p = fakeProcess(fixture)
    expect(
      await run(['explain', 's4udijg', 'c1m5c6x', '--report', 'report.json', '--json'], p)
    ).toBe(0)
    const parsed = JSON.parse(p.text.stdout) as {
      report: string
      causes: { id: string }[]
      screenshots: { id: string; status: string }[]
      unexplained: unknown[]
      crops: unknown[]
    }
    expect(parsed.report).toBe('report.json')
    expect(parsed.causes.map((c) => c.id)).toEqual(['c1m5c6x'])
    expect(parsed.screenshots).toEqual([
      expect.objectContaining({ id: 's4udijg', status: 'identical' }),
    ])
    expect(parsed.unexplained).toEqual([])
    expect(parsed.crops).toEqual([])
  })

  const withMembers = async (changes: readonly Change[][]): Promise<string> => {
    const report = JSON.parse(await readFile(join(fixture, 'report.json'), 'utf8')) as {
      causes: { id: string; members: Member[] }[]
    }
    const cause = report.causes[0]
    if (cause === undefined) throw new Error('fixture without causes')
    cause.members = changes.map((list, i) => ({
      screenshot: SCREENSHOTS[i % SCREENSHOTS.length] ?? '',
      locator: `getByText('Save ${String(i)}')`,
      elements: 1,
      effects: [],
      ...(list.length === 0 ? {} : { changes: list }),
    }))
    await writeFile(join(dir, 'big.json'), JSON.stringify(report))
    return 'big.json'
  }

  it('groups members by identical changes with three locators each and folds equal sides', async () => {
    const file = await withMembers([
      ...Array.from({ length: 7 }, () => padding('8px')),
      allSides,
      allSides,
      [{ prop: 'color', from: 'rgb(0, 0, 0)', to: 'rgb(9, 9, 9)' }],
      [],
    ])
    const p = fakeProcess(dir)
    expect(await run(['explain', 'c3ln8mq', '--report', file], p)).toBe(0)
    await expect(p.text.stdout).toMatchFileSnapshot('../../fixtures/explain/grouped.md')
  })

  it('prints at most ten groups, and every member with its changes under --all', async () => {
    const file = await withMembers(Array.from({ length: 11 }, (_, i) => padding(`${String(i)}px`)))
    const p = fakeProcess(dir)
    expect(await run(['explain', 'c3ln8mq', '--report', file], p)).toBe(0)
    const lines = p.text.stdout.split('\n')
    expect(lines.filter((line) => line.startsWith('- 1 member on 1 screenshot: ')).length).toBe(10)
    expect(lines).toContain('+ 1 more change set on 1 member: npx whydiff explain c3ln8mq --all')
    const all = fakeProcess(dir)
    expect(await run(['explain', 'c3ln8mq', '--report', file, '--all'], all)).toBe(0)
    const listed = all.text.stdout.split('\n')
    expect(listed).toContain('### members (11)')
    expect(listed.filter((line) => line.startsWith('  - padding-left 0px -> ')).length).toBe(11)
    expect(all.text.stdout).not.toContain('more')
  })

  it('gives every member its own effects under --all, also two on one screenshot', async () => {
    const report = JSON.parse(await readFile(join(fixture, 'report.json'), 'utf8')) as {
      causes: { id: string; members: Member[] }[]
    }
    const cause = report.causes[0]
    if (cause === undefined) throw new Error('fixture without causes')
    cause.members = [
      {
        screenshot: 's4udgzc',
        locator: "getByText('Save 0')",
        elements: 3,
        effects: [{ kind: 'shifted', nodes: 2, vector: [0, 4] }],
      },
      {
        screenshot: 's4udgzc',
        locator: "getByText('Save 1')",
        elements: 2,
        effects: [{ kind: 'resized', nodes: 1 }],
      },
    ]
    await writeFile(join(dir, 'two.json'), JSON.stringify(report))
    const p = fakeProcess(dir)
    expect(await run(['explain', 'c3ln8mq', '--report', 'two.json', '--all'], p)).toBe(0)
    expect(p.text.stdout).toContain(
      [
        "- s4udgzc | s1 >> renders | getByText('Save 0') | 3 elements",
        '  - effect: 2 elements moved 4 px down',
        "- s4udgzc | s1 >> renders | getByText('Save 1') | 2 elements",
        '  - effect: 1 element resized with it',
      ].join('\n')
    )
  })

  it('lists members flat when none carries style changes, and names --all at the cut', async () => {
    const file = await withMembers(Array.from({ length: 12 }, () => []))
    const p = fakeProcess(dir)
    expect(await run(['explain', 'c3ln8mq', '--report', file], p)).toBe(0)
    const lines = p.text.stdout.split('\n')
    const start = lines.indexOf('### members (12)')
    expect(lines.slice(start + 1, start + 3)).toEqual([
      "- s4udgzc | s1 >> renders | getByText('Save 0') | 1 element",
      "- s4udft9 | s2 >> renders | getByText('Save 1') | 1 element",
    ])
    expect(lines.filter((line) => line.startsWith('- s4ud')).length).toBe(10)
    expect(lines).toContain('+ 2 more members: npx whydiff explain c3ln8mq --all')
    expect(p.text.stdout).not.toContain('no own style changes')
  })

  it('separates thousands in member counts', async () => {
    const file = await withMembers(Array.from({ length: 1204 }, () => padding('8px')))
    const p = fakeProcess(dir)
    expect(await run(['explain', 'c3ln8mq', '--report', file], p)).toBe(0)
    const lines = p.text.stdout.split('\n')
    expect(lines).toContain('### members (1,204) by identical changes')
    expect(lines).toContain('- 1,204 members on 3 screenshots: padding-left 0px -> 8px')
    expect(lines).toContain(
      '  + 1,201 more members with these changes: npx whydiff explain c3ln8mq --all'
    )
  })

  it('lists an element under each rule cause it belongs to, the changes under that rule first', async () => {
    const field = new URL('../../../core/fixtures/report/field-reset/', import.meta.url).pathname
    const explained = async (...args: string[]): Promise<string> => {
      const p = fakeProcess(field)
      expect(await run(['explain', ...args, '--report', 'report.json'], p)).toBe(0)
      return p.text.stdout
    }
    const reset = await explained('c1aw389')
    const gone = await explained('c3gywtd')
    for (const text of [reset, gone]) {
      expect(text).toContain("| getByRole('textbox', { name: 'Notes s1' }) | 1 element\n")
    }
    expect(reset).toContain(
      '- 2 members on 2 screenshots: padding (all sides) 2px -> 0px; opacity 0 -> 1\n'
    )
    expect(gone).toContain(
      '- 2 members on 2 screenshots: opacity 0 -> 1; padding (all sides) 2px -> 0px\n'
    )
    const all = await explained('c1aw389', '--all')
    expect(all).toContain('  - padding-top 2px -> 0px\n  - opacity 0 -> 1\n')
  })

  it('says how many selectors a rule line leaves out, and prints the whole list under --all', async () => {
    const rules = new URL('../../../core/fixtures/report/rules/', import.meta.url).pathname
    const explained = async (...args: string[]): Promise<string> => {
      const p = fakeProcess(rules)
      expect(await run(['explain', ...args, '--report', 'report.json'], p)).toBe(0)
      return p.text.stdout
    }
    const grid = await explained('c8hd8de')
    expect(grid).toContain(
      '\n- `.ui-col` and 2 more from `framework.css` (layer `framework.components`) now sets padding-left (values differ per element: `npx whydiff explain c8hd8de`) in place of `.ui-col` from `app.css` (unlayered)\n'
    )
    expect(grid).toContain(
      '\n+ 2 more selectors: npx whydiff explain c8hd8de --all\n### members (2)'
    )
    expect(await explained('c8hd8de', '--all')).toContain(
      '\n- selectors: .ui-col-12, .ui-col-6, .ui-col\n### members (2)'
    )
    expect(await explained('c1aw389', '--all')).not.toContain('selector')
  })

  it('refuses an unknown id and a word that is not an id', async () => {
    const unknown = fakeProcess(fixture)
    expect(await run(['explain', 'c000000', '--report', 'report.json'], unknown)).toBe(2)
    expect(unknown.text.stderr).toBe(
      'whydiff: no c000000 in report.json. Ids are listed in report.md; a report from another run has other ids.\n'
    )
    const word = fakeProcess(fixture)
    expect(await run(['explain', 'padding', '--report', 'report.json'], word)).toBe(2)
    expect(word.text.stderr).toContain('padding is not an id')
  })

  it('reads the newest report under whydiff-report and says which', async () => {
    const text = await readFile(join(fixture, 'report.json'), 'utf8')
    await mkdir(join(dir, 'whydiff-report'))
    await writeFile(join(dir, 'whydiff-report', 'report.json'), text)
    await writeFile(join(dir, 'whydiff-report', 'report.shard-1-of-2.json'), text)
    const old = new Date(Date.now() - 60_000)
    await utimes(join(dir, 'whydiff-report', 'report.json'), old, old)
    const p = fakeProcess(dir)
    expect(await run(['explain', 'c3ln8mq'], p)).toBe(0)
    expect(p.text.stdout.split('\n')[0]).toBe('report: whydiff-report/report.shard-1-of-2.json')
  })

  it('cannot crop a region of a report whose sides are not inputs it can open', async () => {
    const p = fakeProcess(fixture)
    expect(await run(['explain', 'uuc6ba1', '--report', 'report.json'], p)).toBe(2)
    expect(p.text.stderr).toMatch(
      /^whydiff: crops need the images behind "compared: main -> feat\/buttons", which were not found from here/
    )
  })

  it('sends a region of a Playwright run to the images Playwright keeps, never to snap', async () => {
    const report = JSON.parse(await readFile(join(fixture, 'report.json'), 'utf8')) as {
      compared: { before: string; after: string }
    }
    report.compared = { before: 'expected', after: 'actual' }
    await writeFile(join(dir, 'report.json'), JSON.stringify(report))
    const p = fakeProcess(dir)
    expect(await run(['explain', 'uuc6ba1', '--report', 'report.json'], p)).toBe(2)
    expect(p.text.stderr).toBe(
      'whydiff: uuc6ba1 is in a screenshot of a Playwright run; whydiff crops only the pairs it diffs. See "s4 >> renders" (tests/hero.spec.ts:40) in Playwright\'s HTML report (npx playwright show-report) or its -diff.png in test-results: the region is 50x50 at (320,320).\n'
    )
  })
})
