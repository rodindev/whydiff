import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { WhydiffError } from '@whydiff/core'
import type { BrowserType } from 'playwright-core'

// Only playwright-core's private registry names the headless shell's path: bundled into
// lib/coreBundle.js since 1.60, a module of its own before, with the same call in both.
const REGISTRIES: readonly { readonly file: string; readonly keys: readonly string[] }[] = [
  { file: 'lib/coreBundle.js', keys: ['registry', 'registry'] },
  { file: 'lib/server/registry/index.js', keys: ['registry'] },
]

/** The `chromium` of the project's playwright-core, reached through @playwright/test and playwright when present. */
export async function loadChromium(cwd: string): Promise<BrowserType> {
  const path = resolvePlaywrightCore(cwd)
  const loaded: unknown = await import(pathToFileURL(path).href)
  const chromium = exportOf(loaded, 'chromium') ?? exportOf(exportOf(loaded, 'default'), 'chromium')
  if (typeof chromium !== 'object' || chromium === null || !('launch' in chromium)) {
    throw new WhydiffError(
      'unsupported-browser',
      `${path} does not export chromium. Install playwright-core 1.53 or later in the project.`
    )
  }
  return chromium as BrowserType // playwright-core's own export, checked for its launch function above
}

/** The headless shell that `chromium.launch()` without `channel` or `executablePath` starts, as the project's playwright-core names it; null when its registry cannot be read. */
export function headlessShellPath(cwd: string): string | null {
  const core = dirname(resolvePlaywrightCore(cwd))
  const require = createRequire(import.meta.url)
  for (const { file, keys } of REGISTRIES) {
    const path = join(core, file)
    if (!existsSync(path)) continue
    const loaded: unknown = require(path)
    const registry = keys.reduce((value, key) => exportOf(value, key), loaded)
    const executable = call(registry, 'findExecutable', 'chromium-headless-shell')
    const shell = call(executable, 'executablePath')
    if (typeof shell === 'string') return shell
  }
  return null
}

/** The playwright-core module the project resolves, or an error that names what to install. */
function resolvePlaywrightCore(cwd: string): string {
  let dir = cwd
  for (const pkg of ['@playwright/test', 'playwright']) {
    const manifest = tryResolve(`${pkg}/package.json`, dir)
    if (manifest !== null) dir = dirname(manifest)
  }
  const found = tryResolve('playwright-core', dir) ?? tryResolve('playwright-core', null)
  if (found === null) {
    throw new WhydiffError(
      'unsupported-browser',
      'playwright-core was not found from this directory. Install @playwright/test or playwright-core (npm i -D playwright-core), then run npx playwright-core install chromium-headless-shell or set WHYDIFF_CHROMIUM to a Chromium binary.'
    )
  }
  return found
}

function exportOf(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && key in value
    ? Reflect.get(value, key)
    : undefined
}

function call(value: unknown, method: string, ...args: string[]): unknown {
  const fn = exportOf(value, method)
  return typeof fn === 'function' ? Reflect.apply(fn, value, args) : undefined
}

function tryResolve(id: string, dir: string | null): string | null {
  const require = createRequire(dir === null ? import.meta.url : join(dir, 'package.json'))
  try {
    return require.resolve(id)
  } catch {
    return null
  }
}
