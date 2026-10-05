import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { screenshotId } from '@whydiff/core'
import { PNG } from 'pngjs'

import { run } from './main.js'
import { fakeProcess } from './testing.js'
import { COMMAND_USAGE, USAGE } from './usage.js'

const fixtures = new URL('../../core/fixtures/', import.meta.url).pathname
// A command the output suggests runs to the end of its line or to a closing backtick.
const SUGGESTED = /npx whydiff ([^`\n]+)/g
const EXAMPLE = /^ +\$ npx whydiff (.+)$/gm
// More causes than the run report shows (REPORT_MAX_CLUSTERS in the core), so it names --all.
const PADDED_CAUSES = 21

interface Cause {
  id: string
  key: string
  members: { screenshot: string }[]
  example: { screenshot: string }
}

interface Report {
  summary: { causes: number }
  causes: Cause[]
  unexplained: { id: string }[]
}

const readJson = async (path: string): Promise<Report> =>
  JSON.parse(await readFile(path, 'utf8')) as Report // a report fixture of the core

/** The run fixture, its region's screenshot keyed as `diff main feat/buttons` keys its pair, padded with copies of a rule cause that shortens its selector list. */
async function writeProject(dir: string): Promise<void> {
  const text = await readFile(join(fixtures, 'report/run/report.json'), 'utf8')
  const report = JSON.parse(text.split('s4udi5f').join(screenshotId('main|feat/buttons'))) as Report // a report fixture of the core
  const rules = await readJson(join(fixtures, 'report/rules/report.json'))
  const rule = rules.causes.find((cause) => cause.id === 'c8hd8de')
  if (rule === undefined) throw new Error('the rules fixture lost c8hd8de')
  for (let i = report.causes.length; i < PADDED_CAUSES; i++) {
    report.causes.push({
      ...rule,
      id: `cpad${String(i).padStart(3, '0')}`,
      key: `${rule.key}|${String(i)}`,
      members: rule.members.map((member) => ({ ...member, screenshot: 's4udgzc' })),
      example: { ...rule.example, screenshot: 's4udgzc' },
    })
  }
  report.summary.causes = report.causes.length
  await mkdir(join(dir, 'whydiff-report'))
  await writeFile(join(dir, 'whydiff-report', 'report.json'), JSON.stringify(report))
  const snapshot = await readFile(join(fixtures, 'snapshot/minimal.whydiff.json'))
  const png = PNG.sync.write(new PNG({ width: 1000, height: 800 }))
  await mkdir(join(dir, '.whydiff', 'snaps', 'feat'), { recursive: true })
  for (const name of ['main', 'feat/buttons']) {
    await writeFile(join(dir, '.whydiff', 'snaps', `${name}.whydiff.json`), snapshot)
    await writeFile(join(dir, '.whydiff', 'snaps', `${name}.png`), png)
  }
}

/** The commands a text suggests, with `<id>` filled in by one id of each kind the report holds. */
function suggested(text: string, ids: readonly string[]): string[][] {
  return [...text.matchAll(SUGGESTED)].flatMap((match) => {
    const argv = (match[1] ?? '').trim().replace(/\.$/, '').split(' ')
    return argv.includes('<id>')
      ? ids.map((id) => argv.map((arg) => (arg === '<id>' ? id : arg)))
      : [argv]
  })
}

describe('every command whydiff suggests', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'whydiff-suggested-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('runs every command the run report, its pages and explain print, and every command those print', async () => {
    await writeProject(dir)
    const merged = fakeProcess(dir)
    expect(await run(['report', '--merge', 'whydiff-report/report.json'], merged)).toBe(0)
    const report = await readJson(join(dir, 'whydiff-report', 'report.json'))
    const ids = [report.causes[0]?.id ?? '', 's4udgzc', report.unexplained[0]?.id ?? '']
    const pages = join(dir, 'whydiff-report', 'screenshots')
    const texts = [
      await readFile(join(dir, 'whydiff-report', 'report.md'), 'utf8'),
      ...(await Promise.all(
        (await readdir(pages)).sort().map((page) => readFile(join(pages, page), 'utf8'))
      )),
    ]
    const bare = fakeProcess(dir)
    expect(await run(['explain'], bare)).toBe(2)
    const queue = [...texts, bare.text.stderr].flatMap((text) => suggested(text, ids))
    const ran = new Set<string>()
    for (let argv = queue.shift(); argv !== undefined; argv = queue.shift()) {
      const line = argv.join(' ')
      if (ran.has(line)) continue
      ran.add(line)
      const p = fakeProcess(dir)
      expect(await run(argv, p), line).toBe(0)
      queue.push(...suggested(p.text.stdout, ids))
    }
    const forms = [...ran].map((line) => line.replace(/\b([csu])[0-9a-z]{6}\b/g, '$1'))
    expect([...new Set(forms)].sort()).toEqual([
      'explain --all',
      'explain c',
      'explain c --all',
      'explain s',
      'explain u',
    ])
  })

  it('accepts every example of the help, each with the options its command takes', async () => {
    const usages: Readonly<Record<string, string>> = COMMAND_USAGE
    for (const text of [USAGE, ...Object.values(COMMAND_USAGE)]) {
      for (const [, example] of text.matchAll(EXAMPLE)) {
        const argv = (example ?? '').split(' ')
        const name = argv[0] ?? ''
        const p = fakeProcess(dir)
        expect(await run([...argv, '--help'], p), example).toBe(0)
        expect(p.text.stdout, example).toBe(usages[name])
      }
    }
  })
})
