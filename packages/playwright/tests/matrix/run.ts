import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = new URL('../../../../', import.meta.url).pathname
const fixture = new URL('../../fixtures/project/', import.meta.url).pathname
const RELEASES = ['1.53.2', '1.59.1', '1.61.1', 'latest']
const releases = process.argv.length > 2 ? process.argv.slice(2) : RELEASES

if (!existsSync(join(root, 'packages/playwright/dist/reporter.js'))) {
  throw new Error('build the packages first: pnpm build')
}
const work = await mkdtemp(join(tmpdir(), 'whydiff-matrix-'))
const failed: string[] = []
try {
  const tarballs = join(work, 'tarballs')
  await mkdir(tarballs)
  await run(
    'pnpm',
    ['-r', '--filter', './packages/*', 'exec', 'pnpm', 'pack', '--pack-destination', tarballs],
    { cwd: root }
  )
  const files = (await readdir(tarballs)).filter((file) => file.endsWith('.tgz')).sort()
  for (const release of releases) {
    const project = join(work, release)
    await cp(join(fixture, 'tests'), join(project, 'tests'), { recursive: true })
    await cp(join(fixture, 'playwright.config.ts'), join(project, 'playwright.config.ts'))
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({ name: 'whydiff-matrix', private: true, type: 'module' })
    )
    await run(
      'npm',
      [
        'install',
        '--no-save',
        '--no-audit',
        '--no-fund',
        // npm takes no prerelease as satisfying a peer range such as >=1.53.0
        ...(release.includes('-') ? ['--legacy-peer-deps'] : []),
        `@playwright/test@${release}`,
        ...files.map((file) => join(tarballs, file)),
      ],
      { cwd: project }
    )
    try {
      await run(
        'pnpm',
        [
          'exec',
          'vitest',
          'run',
          'packages/playwright/src/with.spec.ts',
          'packages/playwright/src/html-report.spec.ts',
          'packages/cli/src/commands/doctor.spec.ts',
        ],
        { cwd: root, env: { ...process.env, WHYDIFF_MATRIX_PROJECT: project } }
      )
      console.log(`@playwright/test ${release}: passed`)
    } catch (error) {
      failed.push(release)
      const output =
        typeof error === 'object' && error !== null && 'stdout' in error && 'stderr' in error
          ? `${String(error.stdout)}${String(error.stderr)}`
          : String(error)
      console.log(`@playwright/test ${release}: failed\n${output}`)
    }
  }
} finally {
  await rm(work, { recursive: true, force: true })
}
if (failed.length > 0) process.exitCode = 1
