import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const fixture = new URL('../packages/cli/fixtures/readme/', import.meta.url).pathname
const cli = new URL('../packages/cli/dist/main.js', import.meta.url).pathname
const SCREENS = ['items', 'settings', 'usage']
const VIEWPORT = '480x320'

for (const side of ['before', 'after']) {
  // The fixture's own server, the one its Playwright project starts: one origin for both sides,
  // so the snapshots name the same stylesheets and the same page.
  const server = spawn(process.execPath, ['serve.ts'], {
    cwd: fixture,
    env: { ...process.env, WHYDIFF_README_SIDE: side },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  try {
    await once(server.stdout, 'data')
    await rm(join(fixture, side), { recursive: true, force: true })
    for (const screen of SCREENS) {
      const url = `http://127.0.0.1:4173/${screen}.html`
      const args = ['snap', url, '--name', screen, '--viewport', VIEWPORT, '--out', side]
      await run(process.execPath, [cli, ...args], { cwd: fixture })
    }
  } finally {
    server.kill()
    await once(server, 'exit')
  }
}
console.log(
  `captured ${SCREENS.join(', ')} before and after into ${fixture}; pnpm test:run -u packages/cli/src/readme.spec.ts writes the README's example`
)
