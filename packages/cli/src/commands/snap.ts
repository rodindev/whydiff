import { mkdir, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { captureSnapshot, type CaptureOptions } from '@whydiff/capture'
import { serializeSnapshot, WhydiffError } from '@whydiff/core'
import type { Page } from 'playwright-core'

import { flagValue, hasFlag, requireFlag, type FlagSpec, type ParsedArgs } from '../args.js'
import { DEFAULT_VIEWPORT, SNAPS_DIR } from '../constants.js'
import type { Context } from '../context.js'
import { loadChromium } from '../io/browser.js'

/** Flags of `snap`. */
export const SNAP_FLAGS: FlagSpec = {
  name: true,
  selector: true,
  'full-page': false,
  viewport: true,
  'wait-for': true,
  'storage-state': true,
  out: true,
  executable: true,
  help: false,
}

const NAME = /^[A-Za-z0-9_.-]+$/
const VIEWPORT = /^(\d+)x(\d+)$/
const MILLISECONDS = /^\d+$/
const SCREENSHOT = { animations: 'disabled', caret: 'hide', scale: 'css' } as const

/** Opens a page in Chromium, takes its PNG and the matching snapshot, and writes both under the snaps directory. */
export async function snap(args: ParsedArgs, ctx: Context): Promise<number> {
  const [url] = args.positionals
  if (url === undefined || args.positionals.length > 1) {
    throw new WhydiffError(
      'invalid-option',
      'snap takes one URL: npx whydiff snap <url> --name <name>.'
    )
  }
  const name = requireFlag(args, 'name', 'snap')
  if (!NAME.test(name)) {
    throw new WhydiffError(
      'invalid-option',
      `--name ${name} must use letters, digits, dots, dashes and underscores only; it names two files.`
    )
  }
  const viewport = parseViewport(flagValue(args, 'viewport'))
  const out = resolve(ctx.cwd, flagValue(args, 'out') ?? SNAPS_DIR)
  const chromium = await loadChromium(ctx.cwd)
  const executablePath = flagValue(args, 'executable') ?? ctx.env.WHYDIFF_CHROMIUM
  const done = ctx.ui.start(`opening ${url}`)
  const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
  try {
    const storageState = flagValue(args, 'storage-state')
    const context = await browser.newContext({
      viewport,
      ...(storageState === undefined ? {} : { storageState: resolve(ctx.cwd, storageState) }),
    })
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'load' })
    await waitFor(page, flagValue(args, 'wait-for'))
    const selector = flagValue(args, 'selector')
    const root = selector === undefined ? null : page.locator(selector)
    const fullPage = hasFlag(args, 'full-page')
    const png =
      root === null
        ? await page.screenshot({ ...SCREENSHOT, fullPage })
        : await root.screenshot(SCREENSHOT)
    const capture: CaptureOptions = { ...SCREENSHOT, fullPage, ...(root === null ? {} : { root }) }
    const snapshot = await captureSnapshot(page, capture)
    const files = { png: join(out, `${name}.png`), snapshot: join(out, `${name}.whydiff.json`) }
    await mkdir(out, { recursive: true })
    await writeFile(files.png, png)
    await writeFile(files.snapshot, serializeSnapshot(snapshot))
    done(
      `${name}: ${String(snapshot.nodes.length)} nodes, ${String(snapshot.image.width)}x${String(snapshot.image.height)} px`
    )
    ctx.out(`${relative(ctx.cwd, files.png)}\n${relative(ctx.cwd, files.snapshot)}\n`)
    return 0
  } finally {
    await browser.close()
  }
}

function parseViewport(value: string | undefined): { width: number; height: number } {
  if (value === undefined) return DEFAULT_VIEWPORT
  const match = VIEWPORT.exec(value)
  const width = Number(match?.[1])
  const height = Number(match?.[2])
  if (match === null || width < 1 || height < 1) {
    throw new WhydiffError('invalid-option', `--viewport takes WIDTHxHEIGHT in px, not ${value}.`)
  }
  return { width, height }
}

async function waitFor(page: Page, value: string | undefined): Promise<void> {
  if (value === undefined) return
  if (MILLISECONDS.test(value)) await page.waitForTimeout(Number(value))
  else await page.locator(value).first().waitFor()
}
