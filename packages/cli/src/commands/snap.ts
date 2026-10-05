import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { captureSnapshot, type CaptureOptions } from '@whydiff/capture'
import { serializeSnapshot, WhydiffError } from '@whydiff/core'
import type { Locator, Page } from 'playwright-core'

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
  const executable = flagValue(args, 'executable')
  const executablePath = executable ?? ctx.env.WHYDIFF_CHROMIUM
  if (executablePath !== undefined && !existsSync(executablePath)) {
    throw new WhydiffError(
      'invalid-option',
      `${executable === undefined ? 'WHYDIFF_CHROMIUM' : '--executable'} names ${executablePath}, which does not exist. Point it at a Chromium binary, or leave it out to use Playwright's headless shell.`
    )
  }
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
      root === null || selector === undefined
        ? await page.screenshot({ ...SCREENSHOT, fullPage })
        : await elementPng(root, selector)
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

/** Waits as --wait-for says, an element or milliseconds; a selector that never matches is an error that names the next step. */
export async function waitFor(page: Page, value: string | undefined): Promise<void> {
  if (value === undefined) return
  if (MILLISECONDS.test(value)) {
    await page.waitForTimeout(Number(value))
    return
  }
  try {
    await page.locator(value).first().waitFor()
  } catch (error) {
    if (!isTimeout(error)) throw error
    throw new WhydiffError(
      'capture-failed',
      `--wait-for ${value} matched no element before Playwright's timeout. Check the selector against the page, or wait a number of milliseconds instead, as --wait-for 2000 does.`
    )
  }
}

/** The PNG of the one element --selector names; naming several, or none before Playwright's timeout, is an error that names the next step. */
export async function elementPng(root: Locator, selector: string): Promise<Buffer> {
  try {
    return await root.screenshot(SCREENSHOT)
  } catch (error) {
    const count = await root.count()
    if (count > 1) {
      throw new WhydiffError(
        'invalid-option',
        `--selector ${selector} matches ${String(count)} elements and snap captures one. Narrow it to one, for example --selector "${selector} >> nth=0" for the first.`
      )
    }
    if (!isTimeout(error)) throw error
    throw new WhydiffError(
      'capture-failed',
      `--selector ${selector} matched no element before Playwright's timeout. Check the selector against the page, or let the page settle first with --wait-for.`
    )
  }
}

// By name: the TimeoutError class is the project's playwright-core's, which this package only loads.
function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError'
}
