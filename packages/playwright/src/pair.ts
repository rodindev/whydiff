import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  analyzeScreen,
  buildReport,
  clusterCauses,
  diffMask,
  diffRegions,
  parseSnapshot,
  screenKey,
  type ComparedV1,
  type Region,
  type ReportV1,
  type RgbaImage,
  type ScreenInput,
  type SnapshotV1,
} from '@whydiff/core'
import { PNG } from 'pngjs'

import { MAX_LISTED_REGIONS } from './constants.js'
import { VERSION } from './version.js'

/** The two sides of a pair, named as the built-in names its images. */
export const COMPARED: ComparedV1 = { before: 'expected', after: 'actual' }

export const NO_BASELINE =
  'No render-tree snapshot is stored next to the baseline PNG, so only the pixels are described; run with --update-snapshots, or let the assertion pass once with backfill on, to record one.'

/** Who a screenshot belongs to, built the same way by the matcher and the reporter. */
export interface PairIdentity {
  readonly screen: string
  readonly title: string
  readonly file: string
  readonly line: number
  readonly project: string
}

/** A test as a screenshot's identity takes it: project, test id, titles, file, line and repeat index. */
export interface TestIdentity {
  readonly project: string
  readonly testId: string
  /** Describe blocks and the test title, without the file. */
  readonly titles: readonly string[]
  readonly file: string
  readonly line: number
  /** `--repeat-each` index, 0 for the first run and without the flag. */
  readonly repeat: number
}

export interface PixelSummary {
  readonly width: number
  readonly height: number
  readonly differing: number
  readonly regions: readonly Region[]
}

export function pairIdentity(test: TestIdentity, name: string): PairIdentity {
  const title = [...test.titles, name].join(' > ')
  return {
    screen: screenKey(test, title),
    title,
    file: test.file,
    line: test.line,
    project: test.project,
  }
}

export function decodePng(bytes: Uint8Array): RgbaImage {
  const png = PNG.sync.read(Buffer.from(bytes))
  return { width: png.width, height: png.height, data: png.data }
}

export async function readPng(path: string): Promise<RgbaImage> {
  return decodePng(await readFile(path))
}

/** The snapshot stored at `path`, or null when there is none. */
export async function readSnapshot(path: string): Promise<SnapshotV1 | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
  return parseSnapshot(text)
}

/** Writes `text` unless the file already holds exactly these bytes; true when it wrote. */
export async function writeIfChanged(path: string, text: string): Promise<boolean> {
  const current = await readFile(path, 'utf8').catch(() => null)
  if (current === text) return false
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
  return true
}

/** One screenshot through the core, compared with the threshold its actual side was captured with. */
export function analyzePair(
  identity: PairIdentity,
  before: SnapshotV1,
  after: SnapshotV1,
  expected: RgbaImage,
  actual: RgbaImage
): ScreenInput {
  return analyzeScreen({
    ...identity,
    before,
    after,
    expected,
    actual,
    threshold: after.compare.threshold,
  })
}

/** The single-pair report of one analyzed screenshot, as its test explains it. */
export function screenReport(screen: ScreenInput): ReportV1 {
  return buildReport({
    version: VERSION,
    compared: COMPARED,
    screens: [screen],
    clusters: clusterCauses(screen.regions.length > 0 ? [screen] : []),
  })
}

export function pixelSummary(
  expected: RgbaImage,
  actual: RgbaImage,
  threshold: number
): PixelSummary {
  const mask = diffMask(expected, actual, { threshold })
  return {
    width: mask.width,
    height: mask.height,
    differing: mask.differing,
    regions: diffRegions(mask).regions,
  }
}

/** What the pixel mask alone says about a failed screenshot that has no baseline snapshot. */
export function pixelMarkdown(identity: PairIdentity, summary: PixelSummary): string {
  const shown = summary.regions.slice(0, MAX_LISTED_REGIONS)
  const rest = summary.regions.length - shown.length
  return [
    `# whydiff: ${identity.title} | no baseline snapshot`,
    `compared: ${COMPARED.before} -> ${COMPARED.after}`,
    `source: ${sourceOf(identity)} | ${String(summary.width)}x${String(summary.height)} px, ${count(summary.differing)} changed pixels`,
    NO_BASELINE,
    '',
    `## Changed regions (${count(summary.regions.length)})`,
    ...shown.map(
      (r) =>
        `- region ${String(r.width)}x${String(r.height)} at (${String(r.x)},${String(r.y)}), ${count(r.pixels)} changed pixels`
    ),
    ...(rest > 0 ? [`+ ${count(rest)} more regions`] : []),
    '',
  ].join('\n')
}

export function sourceOf(identity: PairIdentity): string {
  return `${identity.file}:${String(identity.line)} | ${identity.project}`
}

/** Thousands separated by commas, as the core's report writes them. */
export function count(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
