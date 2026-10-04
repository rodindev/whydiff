import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = new URL('..', import.meta.url).pathname
const PLAYWRIGHT_VERSION = /'@playwright\/test': (\S+)/
const EVERY_TARBALL = ['LICENSE', 'README.md', 'package.json']
const PACKED_FILES: Readonly<Record<string, RegExp>> = {
  '@whydiff/core': /^(dist\/index\.(js|d\.ts)|schema\/[\w-]+\.schema\.json)$/,
  '@whydiff/capture': /^dist\/index\.(js|d\.ts)$/,
  '@whydiff/playwright': /^dist\/[\w-]+\.(js|d\.ts)$/,
  whydiff: /^dist\/main\.js$/,
}
// The ISC licence of the vendored pixelmatch asks for its notice in every copy of the code.
const PIXELMATCH_NOTICE = ['ISC License', 'Mapbox']
// Static and dynamic imports as rolldown prints them: one statement per line, double quotes.
const IMPORT =
  /^(?:import|export)\b[^"\n]*\bfrom "([^"]+)";$|^import "([^"]+)";$|\bimport\("([^"]+)"\)/gm
const PAGE =
  '  await page.setContent(\'<div id="a" style="width: 40px; height: 40px; background: red"></div>\')'
const EXPLICIT_SPEC = [
  "import { expect, test } from '@playwright/test'",
  "import { whydiffCapture } from '@whydiff/playwright'",
  "test('smoke', async ({ page }) => {",
  PAGE,
  "  await expect.soft(page).toHaveScreenshot('a.png')",
  "  await whydiffCapture(page, 'a.png')",
  '})',
  '',
].join('\n')
const MATCHER_SPEC = [
  "import { expect as baseExpect, test as baseTest } from '@playwright/test'",
  "import { withWhydiff } from '@whydiff/playwright'",
  'const { expect, test } = withWhydiff(baseTest, baseExpect)',
  "test('smoke', async ({ page }) => {",
  PAGE,
  "  await expect(page).toHaveScreenshot('a.png')",
  '})',
  '',
].join('\n')

const work = await mkdtemp(join(tmpdir(), 'whydiff-pack-'))
try {
  const tarballs = join(work, 'tarballs')
  await mkdir(tarballs)
  await run(
    'pnpm',
    ['-r', '--filter', './packages/*', 'exec', 'pnpm', 'pack', '--pack-destination', tarballs],
    {
      cwd: root,
    }
  )
  const files = (await readdir(tarballs))
    .filter((file) => file.endsWith('.tgz'))
    .sort()
    .map((file) => join(tarballs, file))
  for (const file of files) {
    await checkTarball(file)
    await run('pnpm', ['exec', 'publint', 'run', file, '--strict'], { cwd: root })
    await run('pnpm', ['exec', 'attw', file, '--profile', 'esm-only'], { cwd: root })
  }

  const workspace = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')
  const playwright = PLAYWRIGHT_VERSION.exec(workspace)?.[1] ?? 'latest'
  const esm = join(work, 'esm')
  const cjs = join(work, 'cjs')
  const explicitNodes = await smoke(esm, { type: 'module' }, files, playwright, {
    'playwright.config.mjs': config('ignoreSnapshots: true'),
    'tests/smoke.spec.mjs': EXPLICIT_SPEC,
  })
  const matcherNodes = await smoke(cjs, {}, files, playwright, {
    'playwright.config.ts': config("updateSnapshots: 'all'"),
    'tests/smoke.spec.ts': MATCHER_SPEC,
  })

  const { stdout: imported } = await run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import s from '@whydiff/core/schema/report-v1.schema.json' with { type: 'json' }\nconsole.log(s.title)",
    ],
    { cwd: esm }
  )
  const { stdout: required } = await run(
    process.execPath,
    ['-e', "console.log(require('@whydiff/core/schema/snapshot-v1.schema.json').title)"],
    { cwd: cjs }
  )
  if (imported.trim() !== 'whydiff report v1' || required.trim() !== 'whydiff snapshot v1')
    throw new Error(`schemas by package path: ${imported.trim()}, ${required.trim()}`)

  const cli = join(esm, 'node_modules', '.bin', 'whydiff')
  const packed: unknown = JSON.parse(
    await readFile(join(esm, 'node_modules', 'whydiff', 'package.json'), 'utf8')
  )
  const { stdout: version } = await run(cli, ['--version'], { cwd: esm })
  if (!isRecord(packed) || version.trim() !== packed.version)
    throw new Error(`the packed cli printed version ${version.trim()}`)
  const { stdout: schema } = await run(cli, ['schema', 'report'], { cwd: esm })
  const parsedSchema: unknown = JSON.parse(schema)
  if (!isRecord(parsedSchema) || parsedSchema.title !== 'whydiff report v1')
    throw new Error(`unexpected schema from the packed cli: ${schema.slice(0, 80)}`)
  const checks = await doctor(cli, esm)
  const playwrightCheck = checks.find(
    (check) => check.check === `explicit call on @playwright/test ${playwright}`
  )
  const chromiumCheck = checks.find((check) =>
    check.check.startsWith('chromium-headless-shell at ')
  )
  if (playwrightCheck?.status !== 'ok' || chromiumCheck?.status !== 'ok')
    throw new Error(`doctor in the packed install: ${JSON.stringify(checks)}`)

  const sizes = await Promise.all(
    files.map(async (file) => `${basename(file)} ${String((await stat(file)).size)} B`)
  )
  console.log(
    `pack-smoke ok: ${sizes.join(', ')}; ${String(explicitNodes)} nodes captured by the explicit call in an ESM project, ${String(matcherNodes)} by withWhydiff in a CommonJS one, the reporter wrote report.json in both; schemas resolve by package path; the whydiff bin answers version, schema and doctor`
  )
} finally {
  await rm(work, { recursive: true, force: true })
}

async function checkTarball(file: string): Promise<void> {
  const name = basename(file)
  const { stdout: listing } = await run('tar', ['-tzf', file])
  const paths = listing
    .trim()
    .split('\n')
    .map((line) => line.replace(/^package\//, ''))
  const { stdout: text } = await run('tar', ['-xzOf', file, 'package/package.json'])
  const manifest: unknown = JSON.parse(text)
  if (!isRecord(manifest) || typeof manifest.name !== 'string')
    throw new Error(`${name} has no package name`)
  const allowed = PACKED_FILES[manifest.name]
  if (allowed === undefined) throw new Error(`${name}: no file allowlist for ${manifest.name}`)
  const stray = paths.filter((path) => !EVERY_TARBALL.includes(path) && !allowed.test(path))
  if (stray.length > 0) throw new Error(`${name} packs ${stray.join(', ')}`)
  const expected = [...EVERY_TARBALL, ...targets(manifest.exports), ...targets(manifest.bin)]
  const missing = expected.filter((path) => !paths.includes(path))
  if (missing.length > 0) throw new Error(`${name} lacks ${missing.join(', ')}`)
  if (/"(workspace|catalog):/.test(text))
    throw new Error(`${name} keeps a workspace or catalog range`)
  if (manifest.name === '@whydiff/core') {
    const { stdout: bundle } = await run('tar', ['-xzOf', file, 'package/dist/index.js'])
    const lost = PIXELMATCH_NOTICE.filter((word) => !bundle.includes(word))
    if (lost.length > 0)
      throw new Error(`${name}: dist/index.js lost the pixelmatch notice, no ${lost.join(' or ')}`)
  }
  await checkImports(file, manifest, paths)
}

async function checkImports(
  file: string,
  manifest: Record<string, unknown>,
  paths: readonly string[]
): Promise<void> {
  const declared = [manifest.dependencies, manifest.peerDependencies].flatMap((field) =>
    isRecord(field) ? Object.keys(field) : []
  )
  const neutral = manifest.name === '@whydiff/core'
  for (const path of paths.filter((path) => path.startsWith('dist/'))) {
    const { stdout: code } = await run('tar', ['-xzOf', file, `package/${path}`])
    for (const [, from, bare, dynamic] of code.matchAll(IMPORT)) {
      const specifier = from ?? bare ?? dynamic ?? ''
      if (specifier.startsWith('.') || (!neutral && specifier.startsWith('node:'))) continue
      const segments = specifier.startsWith('@') ? 2 : 1
      if (!declared.includes(specifier.split('/').slice(0, segments).join('/')))
        throw new Error(
          `${basename(file)}: ${path} imports ${specifier}, which is not among its dependencies`
        )
    }
  }
}

// The source condition points at files that are never packed, and a wildcard names no single file.
function targets(value: unknown, condition = ''): string[] {
  if (typeof value === 'string') {
    return condition === 'whydiff-source' || value.includes('*') ? [] : [value.replace(/^\.\//, '')]
  }
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, target]) => targets(target, key))
}

function config(setting: string): string {
  return `import { defineConfig } from '@playwright/test'\nexport default defineConfig({ testDir: './tests', ${setting}, reporter: [['list'], ['@whydiff/playwright/reporter']], use: { whydiff: { threshold: 0.35 } } })\n`
}

async function smoke(
  project: string,
  fields: Record<string, string>,
  tarballs: readonly string[],
  playwright: string,
  sources: Record<string, string>
): Promise<number> {
  await mkdir(project)
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify({ name: 'whydiff-pack-smoke', private: true, ...fields })
  )
  await run(
    'npm',
    [
      'install',
      '--no-save',
      '--no-audit',
      '--no-fund',
      `@playwright/test@${playwright}`,
      ...tarballs,
    ],
    { cwd: project }
  )
  for (const [path, text] of Object.entries(sources)) {
    await mkdir(dirname(join(project, path)), { recursive: true })
    await writeFile(join(project, path), text)
  }
  await run(
    process.execPath,
    [join(project, 'node_modules', '@playwright', 'test', 'cli.js'), 'test'],
    {
      cwd: project,
      env: { ...process.env, CI: '1', WHYDIFF_OUT: join(project, 'whydiff-results') },
    }
  )

  const report: unknown = JSON.parse(
    await readFile(join(project, 'whydiff-report', 'report.json'), 'utf8')
  )
  if (!isRecord(report) || report.formatVersion !== 1)
    throw new Error(`the reporter wrote no report in ${basename(project)}`)
  const manifest = await readFile(join(project, 'whydiff-results', 'manifest.jsonl'), 'utf8')
  const line: unknown = JSON.parse(manifest.trim())
  if (!isRecord(line) || typeof line.snapshot !== 'string')
    throw new Error(`unexpected manifest line: ${manifest}`)
  if (typeof line.error === 'string')
    throw new Error(`capture failed in the packed install: ${line.error}`)
  const snapshot: unknown = JSON.parse(
    await readFile(join(project, 'whydiff-results', line.snapshot), 'utf8')
  )
  return isRecord(snapshot) && Array.isArray(snapshot.nodes) ? snapshot.nodes.length : 0
}

/** `whydiff doctor --json` in the project, without `WHYDIFF_CHROMIUM`, so doctor looks for the headless shell itself; exit 2 is a failed check, which the caller judges. */
async function doctor(cli: string, project: string): Promise<{ status: string; check: string }[]> {
  const env = { ...process.env, WHYDIFF_CHROMIUM: undefined }
  let stdout: string
  try {
    stdout = (await run(cli, ['doctor', '--json'], { cwd: project, env })).stdout
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('stdout' in error)) throw error
    stdout = String(error.stdout)
  }
  const checks: unknown = JSON.parse(stdout)
  if (!Array.isArray(checks)) throw new Error(`unexpected doctor output: ${stdout.slice(0, 80)}`)
  return checks.map((check: unknown) => {
    if (!isRecord(check) || typeof check.status !== 'string' || typeof check.check !== 'string')
      throw new Error(`unexpected doctor line: ${JSON.stringify(check)}`)
    return { status: check.status, check: check.check }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
