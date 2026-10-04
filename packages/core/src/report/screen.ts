import { explainChanges } from '../causes/causes.js'
import { computeDeltas } from '../deltas/deltas.js'
import { matchSnapshots } from '../match/match.js'
import { diffMask, diffRegions, type RgbaImage } from '../pixels/index.js'
import type { Rect, SnapshotV1 } from '../snapshot/types.js'
import type { ScreenInput } from './types.js'

/** One screenshot pair as an adapter holds it: both snapshots, both decoded PNGs and the pair's threshold. */
export interface ScreenSource {
  readonly screen: string
  readonly title: string
  readonly file?: string
  readonly line?: number
  readonly project?: string
  readonly before: SnapshotV1
  readonly after: SnapshotV1
  readonly expected: RgbaImage
  readonly actual: RgbaImage
  readonly threshold: number
}

/** Runs one pair through pixels, matching, deltas and causes, in the shape the report builder takes. */
export function analyzeScreen(input: ScreenSource): ScreenInput {
  const { before, after } = input
  const mask = diffMask(input.expected, input.actual, { threshold: input.threshold })
  const { regions, massChange } = diffRegions(mask)
  const rects: Rect[] = regions.map((r) => [r.x, r.y, r.width, r.height])
  const matching = matchSnapshots(before, after, { regions: rects, massChange })
  const deltas = computeDeltas(before, after, matching, { regions: rects })
  return {
    screen: input.screen,
    title: input.title,
    ...(input.file === undefined ? {} : { file: input.file }),
    ...(input.line === undefined ? {} : { line: input.line }),
    ...(input.project === undefined ? {} : { project: input.project }),
    before,
    after,
    matching,
    deltas,
    explanation: explainChanges(before, after, matching, deltas, { regions, mask }),
    regions,
    differing: mask.differing,
    massChange,
    sizeMismatch: mask.sizeMismatch,
  }
}
