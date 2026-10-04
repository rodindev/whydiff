import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { run } from './main.js'
import { fakeProcess } from './testing.js'
import { COMMAND_USAGE, USAGE } from './usage.js'

const root = new URL('../../../', import.meta.url).pathname

describe('run', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'whydiff-cli-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('prints the usage on stderr without a command and on stdout under --help', async () => {
    const bare = fakeProcess(dir)
    expect(await run([], bare)).toBe(2)
    expect(bare.text).toEqual({ stdout: '', stderr: USAGE })
    const help = fakeProcess(dir)
    expect(await run(['--help'], help)).toBe(0)
    expect(help.text).toEqual({ stdout: USAGE, stderr: '' })
    expect(USAGE).toMatch(
      /^whydiff - explains why a screenshot changed, as text\n\nUsage: npx whydiff <command> \[options\]\n/
    )
  })

  it('lists each command in one line and prints its own usage under <command> --help or -h', async () => {
    for (const [name, usage] of Object.entries(COMMAND_USAGE)) {
      expect(USAGE).toMatch(new RegExp(`\\n  ${name} +[a-z][^\\n]+\\n`))
      expect(usage).toMatch(new RegExp(`^Usage: npx whydiff ${name} `))
      for (const argv of [
        [name, '--help'],
        [name, '-h'],
        [name, 'before', '-h'],
      ]) {
        const p = fakeProcess(dir)
        expect(await run(argv, p), argv.join(' ')).toBe(0)
        expect(p.text).toEqual({ stdout: usage, stderr: '' })
      }
    }
  })

  it('exits 2 with one line on stderr for an unknown command, a bad flag or a missing input', async () => {
    for (const argv of [
      ['bogus'],
      ['constructor'],
      ['diff', '--bogus'],
      ['diff', 'only-one'],
      ['schema', 'x'],
    ]) {
      const p = fakeProcess(dir)
      expect(await run(argv, p), argv.join(' ')).toBe(2)
      expect(p.text.stdout).toBe('')
      expect(p.text.stderr).toMatch(/^whydiff: [^\n]+\.\n$/)
    }
    const p = fakeProcess(dir)
    await run(['bogus'], p)
    expect(p.text.stderr).toBe(
      'whydiff: unknown command bogus. Run npx whydiff --help for the commands.\n'
    )
  })

  it('prints the version under --version and -v, which the usage names', async () => {
    for (const flag of ['--version', '-v']) {
      const p = fakeProcess(dir)
      expect(await run([flag], p)).toBe(0)
      expect(p.text.stdout).toMatch(/^\d+\.\d+\.\d+\n$/)
    }
    expect(USAGE).toContain('npx whydiff --version')
  })

  it('prints the schema of the snapshot and of the report from the core package', async () => {
    for (const name of ['snapshot', 'report'] as const) {
      const p = fakeProcess(dir)
      expect(await run(['schema', name], p)).toBe(0)
      expect(p.text.stdout).toBe(
        await readFile(join(root, 'packages', 'core', 'schema', `${name}-v1.schema.json`), 'utf8')
      )
      expect(p.text.stderr).toBe('')
    }
  })

  it('names the next step when explain finds no report', async () => {
    const p = fakeProcess(dir)
    expect(await run(['explain', 'c257ja7'], p)).toBe(2)
    expect(p.text.stderr).toBe(
      'whydiff: no report.json under whydiff-report. Run npx whydiff diff or npx whydiff report first, or name one with --report.\n'
    )
  })

  it('names both ways in when report --from finds no whydiff attachments', async () => {
    const p = fakeProcess(dir)
    expect(await run(['report', '--from', '.'], p)).toBe(2)
    expect(p.text.stderr).toBe(
      `whydiff: ${dir} holds no test with whydiff attachments. Point --from at the test-results directory of a run that used withWhydiff or whydiffCapture.\n`
    )
  })

  it('names the next step when a diff input does not exist', async () => {
    const p = fakeProcess(dir)
    expect(await run(['diff', 'a', 'b'], p)).toBe(2)
    expect(p.text.stderr).toBe(
      'whydiff: a is not a snap name, a .whydiff.json file or a directory. Run npx whydiff snap <url> --name a first, or give a path.\n'
    )
  })
})
