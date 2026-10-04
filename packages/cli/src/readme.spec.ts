import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EXCLUDED_PLAYWRIGHT } from '@whydiff/playwright'

import { MIN_NODE, MIN_PLAYWRIGHT } from './constants.js'
import { run } from './main.js'
import { fakeProcess } from './testing.js'

const README = '../../../README.md'
const readme = new URL(README, import.meta.url).pathname
const fixture = new URL('../fixtures/readme/', import.meta.url).pathname
// The fence after the README's comment naming the fixture: what `whydiff diff before after` prints.
const EXAMPLE = /(<!-- [^\n]*packages\/cli\/fixtures\/readme[^\n]* -->\n\n```text\n)[\s\S]*?(```\n)/

interface Manifest {
  engines: { node: string }
}

describe('the README', () => {
  let out: string

  beforeEach(async () => {
    out = await mkdtemp(join(tmpdir(), 'whydiff-readme-'))
  })

  afterEach(async () => {
    await rm(out, { recursive: true, force: true })
  })

  it('shows what diff prints for the fixture today; -u writes it there', async () => {
    const p = fakeProcess(fixture)
    expect(await run(['diff', 'before', 'after', '--out', out], p)).toBe(0)
    const text = await readFile(readme, 'utf8')
    expect(text).toMatch(EXAMPLE)
    const example = text.replace(
      EXAMPLE,
      (_, open: string, close: string) => `${open}${p.text.stdout}${close}`
    )
    await expect(example).toMatchFileSnapshot(README)
  })

  it('leaves no placeholder for a fact', async () => {
    const text = await readFile(readme, 'utf8')
    expect(text.match(/\[(?:N|headline|date|version|reproduction)\]/g)).toBeNull()
  })

  it('names the Node and Playwright releases the packages and doctor go by', async () => {
    const text = await readFile(readme, 'utf8')
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8')
    ) as Manifest // this package's own manifest
    expect(manifest.engines.node).toBe(`>=${MIN_NODE}`)
    expect(text).toContain(`Node ${manifest.engines.node.replace('>=', '')} or later`)
    expect(text).toContain(`\`@playwright/test\` ${MIN_PLAYWRIGHT} or later`)
    for (const release of EXCLUDED_PLAYWRIGHT) expect(text).toContain(release)
  })
})
