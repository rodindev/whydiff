import { appendFile, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type { FullConfig, TestInfo } from '@playwright/test'
import { serializeSnapshot, type SnapshotV1 } from '@whydiff/core'

import type { WhydiffUseOptions } from './options.js'

const MANIFEST = 'manifest.jsonl'
const SAFE = /[^A-Za-z0-9_.-]+/g
const PNG = /\.png$/i
const SIDECAR = /\.whydiff\.json$/

/** One line of `manifest.jsonl`: enough to pair the snapshot with its test and screenshot across runs. */
export interface ManifestLine {
  readonly project: string
  readonly testId: string
  readonly title: string
  readonly file: string
  readonly line: number
  readonly ordinal: number
  readonly name: string
  readonly retry: number
  readonly receiver: 'page' | 'locator'
  /** The baseline PNG on the machine that ran the tests; kept for reference. */
  readonly screenshot: string | null
  readonly snapshot: string | null
  /** The copy of the PNG the built-in compared, relative to the run root like `snapshot`; null when none was recorded. */
  readonly png: string | null
  readonly error?: string
}

/** Directory the Playwright config lives in, the base for relative paths; the test root when there is no config file. */
export function configDir(testInfo: TestInfo): string {
  const { configFile, rootDir } = testInfo.config
  return configFile === undefined ? rootDir : dirname(configFile)
}

/** `.shard-<current>-of-<total>` in a sharded run, empty otherwise: the reporter names its files with it. */
export function shardSuffix(shard: FullConfig['shard']): string {
  return shard === null ? '' : `.shard-${String(shard.current)}-of-${String(shard.total)}`
}

/** The directory each run records its snapshots and manifest into: `WHYDIFF_OUT`, else `use.whydiff.outputDir`; null when neither is set and nothing is recorded per run. */
export function outputRoot(use: WhydiffUseOptions): string | null {
  return process.env.WHYDIFF_OUT ?? use.outputDir ?? null
}

/** File-safe form of a screenshot name: `shop/cart.png` becomes `shop-cart`; anonymous calls become `screenshot`. */
export function sanitizeName(name: readonly string[] | null): string {
  if (name === null) return 'screenshot'
  return name.join('-').replace(PNG, '').replace(SAFE, '-') || 'screenshot'
}

export function snapshotPath(
  root: string,
  testInfo: TestInfo,
  ordinal: number,
  name: string
): string {
  const retry = testInfo.retry > 0 ? `-retry${String(testInfo.retry)}` : ''
  return join(
    root,
    testInfo.project.name.replace(SAFE, '-') || 'default',
    testInfo.testId,
    `${String(ordinal)}-${name}${retry}.whydiff.json`
  )
}

/** The baseline the built-in will compare against; asked before it runs, so an unnamed call gets its own index. */
export function predictBaseline(testInfo: TestInfo, name: readonly string[] | null): string {
  if (name === null) return nextUnnamedPath(testInfo)
  const [single] = name
  if (name.length === 1 && single !== undefined) {
    return testInfo.snapshotPath(single, { kind: 'screenshot' })
  }
  return testInfo.snapshotPath(...name)
}

function nextUnnamedPath(testInfo: TestInfo): string {
  const snapshotPathOf = testInfo.snapshotPath.bind(testInfo) as unknown as UnnamedSnapshotPath // the { kind } overload is untyped
  return snapshotPathOf({ kind: 'screenshot' })
}

type UnnamedSnapshotPath = (options: { kind: 'screenshot' }) => string

/** `<baseline minus .png>.whydiff.json`: the baseline-side snapshot lives next to its PNG. */
export function sidecarPath(baseline: string): string {
  return `${baseline.replace(PNG, '')}.whydiff.json`
}

/** `<snapshot minus .whydiff.json>.png`: the PNG a two-run snapshot was compared with lives next to it. */
export function pngPath(snapshot: string): string {
  return `${snapshot.replace(SIDECAR, '')}.png`
}

export async function writeSnapshot(path: string, snapshot: SnapshotV1): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, serializeSnapshot(snapshot))
}

export async function copyPng(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true })
  await copyFile(from, to)
}

export async function appendManifest(root: string, line: ManifestLine): Promise<void> {
  await mkdir(root, { recursive: true })
  await appendFile(join(root, MANIFEST), `${JSON.stringify(line)}\n`)
}

export function relativeTo(root: string, path: string): string {
  return relative(root, path).split('\\').join('/')
}
