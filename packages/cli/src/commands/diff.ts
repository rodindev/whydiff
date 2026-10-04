import { relative, resolve } from 'node:path'
import {
  analyzeScreen,
  buildReport,
  clusterCauses,
  renderReport,
  serializeReport,
  WhydiffError,
  type ComparedV1,
  type RenderOptions,
  type ScreenInput,
} from '@whydiff/core'

import { flagValue, hasFlag, integerFlag, type FlagSpec, type ParsedArgs } from '../args.js'
import { EXIT_CHANGED, REPORT_DIR } from '../constants.js'
import type { Context } from '../context.js'
import {
  pairInputs,
  readPairFiles,
  resolveInput,
  type InputPair,
  type PairWithoutPng,
} from '../io/pairs.js'
import { writeReportFiles } from '../io/reportDir.js'
import { VERSION } from '../version.js'

const NO_PNG =
  'No PNG was recorded next to the snapshot on the side named, so the pair is not compared: name the screenshot, whydiffCapture cannot tell which baseline an unnamed call that passed was compared with; an assertion that failed before it took a screenshot has none; a copy that failed is a whydiff annotation of the test.'

/** Flags of `diff`. */
export const DIFF_FLAGS: FlagSpec = {
  out: true,
  'max-causes': true,
  'exit-code': false,
  json: false,
  help: false,
}

/** Analyzes every pair two inputs form, clusters the causes and writes the report; prints the Markdown. */
export async function diff(args: ParsedArgs, ctx: Context): Promise<number> {
  const [before, after] = args.positionals
  if (before === undefined || after === undefined || args.positionals.length > 2) {
    throw new WhydiffError(
      'invalid-option',
      'diff takes two inputs: npx whydiff diff <before> <after>.'
    )
  }
  const left = await resolveInput(before, ctx.cwd)
  const right = await resolveInput(after, ctx.cwd)
  const { pairs, unpaired, withoutPng } = await pairInputs(left, right)
  for (const line of unpaired) ctx.ui.warn(line)
  if (pairs.length === 0 && withoutPng.length === 0) {
    throw new WhydiffError(
      'invalid-option',
      `${before} and ${after} share no screenshot. Both sides need the same project, test and screenshot names.`
    )
  }
  const started = performance.now()
  const done = ctx.ui.start(`analyzing ${count(pairs.length, 'pair')}`)
  const screens: ScreenInput[] = []
  for (const pair of pairs) screens.push(await analyzePair(pair))
  const report = buildReport({
    version: VERSION,
    compared: comparedOf(before, after, screens),
    screens,
    clusters: clusterCauses(screens.filter((s) => s.regions.length > 0)),
  })
  const maxCauses = flagValue(args, 'max-causes')
  const options: RenderOptions =
    maxCauses === undefined ? {} : { maxClusters: integerFlag(args, 'max-causes', 0) }
  const markdown =
    (pairs.length === 0
      ? withoutPairsHeader(before, after, withoutPng.length)
      : renderReport(report, options)) + withoutPngSection(withoutPng)
  const files = await writeReportFiles(
    resolve(ctx.cwd, flagValue(args, 'out') ?? REPORT_DIR),
    report,
    markdown
  )
  const { summary } = report
  const outcome =
    pairs.length === 0
      ? `${noneCompared(withoutPng.length)}, ${String(withoutPng.length)} without a PNG`
      : `${String(summary.screenshots.changed)} of ${count(summary.screenshots.compared, 'screenshot')} changed, ${count(summary.causes, 'cause')}, ${count(summary.unexplained, 'unexplained region')}`
  done(`${outcome} in ${String(Math.round(performance.now() - started))} ms`)
  ctx.ui.info(relative(ctx.cwd, files.markdown))
  ctx.out(hasFlag(args, 'json') ? serializeReport(report) : markdown)
  return hasFlag(args, 'exit-code') && summary.screenshots.changed > 0 ? EXIT_CHANGED : 0
}

async function analyzePair(pair: InputPair): Promise<ScreenInput> {
  const { before, after, expected, actual } = await readPairFiles(pair)
  return analyzeScreen({
    screen: pair.screen,
    title: pair.title,
    ...(pair.file === undefined ? {} : { file: pair.file }),
    ...(pair.line === undefined ? {} : { line: pair.line }),
    ...(pair.project === undefined ? {} : { project: pair.project }),
    before,
    after,
    expected,
    actual,
    threshold: after.compare.threshold,
  })
}

/** The two labels, plus the browser and viewport when every after side agrees on them. */
function comparedOf(before: string, after: string, screens: readonly ScreenInput[]): ComparedV1 {
  const same = (values: readonly string[]): string | undefined =>
    values.length > 0 && values.every((v) => v === values[0] && v !== '') ? values[0] : undefined
  const browser = same(screens.map((s) => s.after.tool.browser))
  const viewport = same(
    screens.map((s) => `${String(s.after.viewport.width)}x${String(s.after.viewport.height)}`)
  )
  return {
    before,
    after,
    ...(browser === undefined ? {} : { browser }),
    ...(viewport === undefined ? {} : { viewport }),
  }
}

/** The headline and the compared sides of a diff whose every pair lacks a PNG, in place of the report's. */
function withoutPairsHeader(before: string, after: string, withoutPng: number): string {
  return `# whydiff: ${before} -> ${after} | ${noneCompared(withoutPng)} | ${String(withoutPng)} without a PNG\ncompared: ${before} -> ${after}\n`
}

function noneCompared(screenshots: number): string {
  return `0 of ${count(screenshots, 'screenshot')} compared`
}

/** The reporter's "No baseline snapshot" section, holding the pairs a run recorded no PNG for. */
function withoutPngSection(pairs: readonly PairWithoutPng[]): string {
  if (pairs.length === 0) return ''
  const lines = pairs.map((pair) => {
    const source =
      pair.file === undefined || pair.line === undefined
        ? []
        : [`${pair.file}:${String(pair.line)}`]
    const project = pair.project === undefined || pair.project === '' ? [] : [pair.project]
    const parts = [pair.title, ...source, ...project]
    return `- ${parts.join(' | ')} | no PNG in ${pair.missing.join(' and ')}`
  })
  return `\n## No baseline snapshot (${String(pairs.length)})\n${NO_PNG}\n${lines.join('\n')}\n`
}

function count(value: number, word: string): string {
  return `${String(value)} ${word}${value === 1 ? '' : 's'}`
}
