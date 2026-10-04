import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildReport,
  clusterCauses,
  parseReport,
  serializeReport,
  type CauseV1,
  type ReportV1,
} from '@whydiff/core'

import { run } from '../main.js'
import { fakeProcess } from '../testing.js'
import { mergeReports } from './report.js'

const fixture = parseReport(
  readFileSync(new URL('../../../core/fixtures/report/run/report.json', import.meta.url), 'utf8')
)

/** The part of the fixture report one shard would have written for the given screenshots. */
function shard(ids: readonly string[]): ReportV1 {
  const screenshots = fixture.screenshots.filter((s) => ids.includes(s.id))
  const causes = fixture.causes.flatMap((cause) => {
    const members = cause.members.filter((m) => ids.includes(m.screenshot))
    if (members.length === 0) return []
    const screens = new Set(members.map((m) => m.screenshot)).size
    const file = screenshots.find((s) => s.id === members[0]?.screenshot)?.file
    return [
      {
        ...cause,
        scope: screens > 1 ? ('global' as const) : ('local' as const),
        ...(screens === 1 && file !== undefined ? { file } : {}),
        screenshots: screens,
        elements: members.reduce((sum, m) => sum + m.elements, 0),
        pixels: (cause.pixels / cause.members.length) * members.length,
        example: { screenshot: members[0]?.screenshot ?? '', locator: members[0]?.locator ?? '' },
        members,
      },
    ]
  })
  const unexplained = fixture.unexplained.filter((u) => ids.includes(u.screenshot))
  const changed = screenshots.filter((s) => s.status === 'changed').length
  return {
    ...fixture,
    summary: {
      screenshots: {
        compared: screenshots.length,
        changed,
        identical: screenshots.length - changed,
      },
      causes: causes.length,
      unexplained: unexplained.length,
      massChange: 0,
      lead: fixture.summary.lead,
    },
    screenshots,
    causes,
    unexplained,
  }
}

describe('mergeReports', () => {
  it('unites two shards that split a cause into the run report, ranked again', () => {
    const merged = mergeReports([
      shard(['s4udgzc', 's4udg7a', 's4udijg']),
      shard(['s4udft9', 's4udi5f']),
    ])
    expect(merged.screenshots.map((s) => s.id)).toEqual([
      's4udijg',
      's4udgzc',
      's4udft9',
      's4udg7a',
      's4udi5f',
    ])
    expect(merged.causes).toEqual(fixture.causes)
    expect(merged.unexplained).toEqual(fixture.unexplained)
    expect(merged.summary).toEqual(fixture.summary)
    expect(parseReport(serializeReport(merged))).toEqual(merged)
  })

  it('is the identity on one shard that holds the whole run, up to the screenshot order', () => {
    const merged = mergeReports([fixture])
    expect({ ...merged, screenshots: [] }).toEqual({ ...fixture, screenshots: [] })
    expect([...merged.screenshots].sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual(
      [...fixture.screenshots].sort((a, b) => (a.id < b.id ? -1 : 1))
    )
  })

  it('says how many moved by the most common vector the members record, when not all did', () => {
    const [cause] = fixture.causes
    if (cause === undefined) throw new Error('the fixture has a cause')
    const [first, second] = cause.members
    if (first === undefined || second === undefined) throw new Error('the cause has two members')
    const moved = (effects: ReportV1['causes'][number]['effects']): ReportV1 => ({
      ...fixture,
      causes: [
        {
          ...cause,
          members: [
            { ...first, effects },
            {
              ...second,
              effects: [{ kind: 'shifted', nodes: 3, vector: [0, 12], vectorNodes: 2 }],
            },
          ],
        },
      ],
    })
    expect(
      mergeReports([moved([{ kind: 'shifted', nodes: 2, vector: [0, 4] }])]).causes[0]?.effects
    ).toEqual([{ kind: 'shifted', nodes: 5, vector: [0, 12], vectorNodes: 2 }])
    expect(
      mergeReports([moved([{ kind: 'shifted', nodes: 2, vector: [0, 12] }])]).causes[0]?.effects
    ).toEqual([{ kind: 'shifted', nodes: 5, vector: [0, 12], vectorNodes: 4 }])
  })

  it("unites the shards' rule lists and marks a longhand mixed when one shard sets it and another changed it, as one run decides", () => {
    const [cause] = fixture.causes
    if (cause === undefined) throw new Error('the fixture has a cause')
    const padding = { prop: 'padding-top', from: '8px', to: '12px' }
    const color = { prop: 'color', from: 'rgb(0, 0, 0)', to: 'rgb(51, 51, 51)' }
    const ruled = (
      ids: readonly string[],
      sets: string[],
      changed: string[],
      values: { prop: string; from: string; to: string }[]
    ): ReportV1 => {
      const part = shard(ids)
      const summary: CauseV1['summary'] = {
        kind: 'rule',
        selector: '.ui-input',
        sheet: 'app.css',
        sets,
        changed,
        unsets: [],
        values,
      }
      return {
        ...part,
        causes: part.causes.map((c) => (c.id === cause.id ? { ...c, summary } : c)),
      }
    }
    const merged = mergeReports([
      ruled(['s4udgzc', 's4udg7a', 's4udijg'], ['padding-top'], [], [padding]),
      ruled(['s4udft9', 's4udi5f'], [], ['color', 'padding-top'], [color, padding]),
    ])
    expect(merged.causes.find((c) => c.id === cause.id)?.summary).toEqual({
      kind: 'rule',
      selector: '.ui-input',
      sheet: 'app.css',
      sets: ['padding-top'],
      changed: ['color', 'padding-top'],
      unsets: [],
      values: [color, padding],
      mixed: [{ prop: 'padding-top', sets: 1, changed: 1, unsets: 0 }],
    })
  })

  it('refuses shards written with different cluster rules', () => {
    const other = { ...fixture, tool: { ...fixture.tool, rules: { cluster: 'k2' } } }
    expect(() => mergeReports([fixture, other])).toThrow(
      'the shards were written with different cluster rules (k1 and k2). Rebuild them with one whydiff version.'
    )
  })
})

describe('report --merge', () => {
  it('opens with the failed screenshots of the shards when none of them was explained', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'whydiff-merge-'))
    try {
      const empty = serializeReport(
        buildReport({
          version: '0.0.1',
          compared: { before: 'expected', after: 'actual' },
          screens: [],
          clusters: clusterCauses([]),
        })
      )
      const section = (title: string): string =>
        `# whydiff: expected -> actual\n\n## Not explained (1)\nFailed screenshots that neither their test nor this report could explain.\n- ${title} | a.spec.ts:1 | chromium | ENOENT\n`
      for (const index of [1, 2]) {
        const name = `report.shard-${String(index)}-of-2`
        await writeFile(join(dir, `${name}.json`), empty)
        await writeFile(join(dir, `${name}.md`), section(`card ${String(index)}`))
      }
      const p = fakeProcess(dir)
      const code = await run(
        [
          'report',
          '--merge',
          'report.shard-1-of-2.json',
          'report.shard-2-of-2.json',
          '--out',
          'merged',
        ],
        p
      )
      expect(code).toBe(0)
      expect(p.text.stdout.split('\n', 1)).toEqual([
        '# whydiff: 2 failed screenshots, none explained',
      ])
      expect(p.text.stdout).toContain('\n## Not explained (2)\n')
      expect(await readFile(join(dir, 'merged', 'report.html'), 'utf8')).toContain(
        '<h1>2 failed screenshots, none explained</h1>'
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
