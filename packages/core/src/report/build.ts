import { TINY_REGION_AREA } from '../constants.js'
import { contains, px } from '../causes/context.js'
import { regionRect } from '../causes/regions.js'
import type { Cause, Effect } from '../causes/types.js'
import type { Cluster } from '../cluster/types.js'
import type { ImageV1, NodeV1, Point, Rect, SnapshotV1 } from '../snapshot/types.js'
import { code } from './format.js'
import { headlineOf } from './headline.js'
import { screenshotId, unexplainedId } from './ids.js'
import { locatorFor } from './locator.js'
import { observe } from './observe.js'
import { renderCauseText, runSummaryText, runTotals, summaryParts } from './render.js'
import {
  REPORT_FORMAT_VERSION,
  type CauseDraft,
  type CauseV1,
  type LeadV1,
  type EffectV1,
  type MatchWord,
  type MemberChangeV1,
  type MemberV1,
  type ReportDraft,
  type ReportInput,
  type ReportV1,
  type ScreenInput,
  type ScreenshotV1,
  type UnexplainedV1,
} from './types.js'

type Mutable<T> = { -readonly [K in keyof T]: T[K] }
const PICTURE_TAGS: ReadonlySet<string> = new Set(['img', 'canvas', 'video', 'svg', 'picture'])
const CONTROL_TAGS: ReadonlySet<string> = new Set(['input', 'textarea', 'select'])

/** Turns a run's clusters and screens into the report; deterministic, no timestamps. */
export function buildReport(input: ReportInput): ReportV1 {
  const screensByKey = new Map(input.screens.map((screen) => [screen.screen, screen]))
  const causes = input.clusters.clusters.map((cluster) => buildCause(cluster, screensByKey))
  const unexplained: UnexplainedV1[] = []
  const screenshots: ScreenshotV1[] = input.screens.map((screen) => {
    const id = screenshotId(screen.screen)
    const own = unexplainedOf(screen, id)
    unexplained.push(...own)
    return screenshotEntry(screen, id, causes, own)
  })
  const changed = screenshots.filter((s) => s.status === 'changed')
  return describeRun({
    formatVersion: REPORT_FORMAT_VERSION,
    tool: {
      name: 'whydiff',
      version: input.version,
      rules: { cluster: input.clusters.rulesVersion },
    },
    compared: input.compared,
    summary: {
      screenshots: {
        compared: screenshots.length,
        changed: changed.length,
        identical: screenshots.length - changed.length,
      },
      causes: causes.length,
      unexplained: unexplained.length,
      massChange: changed.filter((s) => s.massChange).length,
    },
    screenshots,
    causes,
    unexplained,
  })
}

/** Writes each cause's headline and text and the run summary from the rest of the report, the run a cause's impact is a share of; a build and a merge of shard reports both end with it. */
export function describeRun(report: ReportDraft): ReportV1 {
  const totals = runTotals(report)
  const causes = report.causes.map((draft) => {
    const cause: CauseV1 = { ...draft, headline: headlineOf(draft, totals), text: '' }
    return { ...cause, text: renderCauseText(cause, report) }
  })
  const parts = summaryParts({ ...report, causes })
  const lead: LeadV1 = {
    causes: parts.top.map((cause) => cause.id),
    screenshots: parts.screenshots,
    settled: parts.settled,
    pixels: parts.pixels,
    text: runSummaryText(parts),
  }
  return { ...report, causes, summary: { ...report.summary, lead } }
}

function buildCause(cluster: Cluster, screens: ReadonlyMap<string, ScreenInput>): CauseDraft {
  const members = cluster.members.map((member) => {
    const screen = screens.get(member.screen)
    const cause = screen?.explanation.causes[member.cause]
    if (screen === undefined || cause === undefined) {
      throw new Error(
        `cluster member ${member.screen}#${String(member.cause)} is outside the screens`
      )
    }
    const node = nodeOf(screen, cause)
    return {
      screenshot: screenshotId(member.screen),
      locator: node === undefined ? '?' : locatorFor(node, snapshotOf(screen, cause)),
      src: node?.src,
      nodes: member.nodes,
      file: screen.file,
      match: matchOf(screen, cause),
      effects: cause.effects,
      changes:
        'changes' in cluster.summary || cluster.summary.kind === 'rule'
          ? ownChanges(screen, cause)
          : [],
      observation: observe(screen, cause.node),
      box: boxOf(screen, cause),
    }
  })
  const example = members.reduce((best, m) => (m.nodes > best.nodes ? m : best))
  const ambiguous = members.filter((m) => m.match === 'ambiguous').length
  const files = new Set(members.map((m) => m.file).filter((f): f is string => f !== undefined))
  const [file] = files
  const out: Mutable<CauseDraft> = {
    id: cluster.id,
    key: cluster.key,
    kind: cluster.kind,
    level: cluster.level,
    summary: cluster.summary,
    scope: cluster.screens > 1 ? 'global' : 'local',
    match:
      ambiguous > 0 ? 'ambiguous' : members.every((m) => m.match === 'exact') ? 'exact' : 'likely',
    ambiguous,
    screenshots: cluster.screens,
    elements: members.reduce((sum, m) => sum + m.nodes, 0),
    pixels: cluster.pixels,
    effects: effectsOf(members.flatMap((m) => m.effects)),
    example: { screenshot: example.screenshot, locator: example.locator },
    members: members.map((m) => {
      const entry: Mutable<MemberV1> = {
        screenshot: m.screenshot,
        locator: m.locator,
        elements: m.nodes,
        effects: effectsOf(m.effects),
      }
      if (m.changes.length > 0) entry.changes = m.changes
      if (m.observation !== undefined) entry.observation = m.observation
      entry.box = m.box
      return entry
    }),
  }
  if (out.scope === 'local' && files.size === 1 && file !== undefined) out.file = file
  if (example.src !== undefined) out.example = { ...out.example, src: example.src }
  return out
}

/** The cause node's own non-derived changes as captured, in property order. */
function ownChanges(screen: ScreenInput, cause: Cause): MemberChangeV1[] {
  const { node } = cause
  if (!('before' in node)) return []
  const pair = screen.deltas.pairs.find((p) => p.before === node.before)
  return (pair?.style ?? [])
    .filter((c) => c.derived === undefined)
    .map(({ prop, from, to }) => ({ prop, from, to }))
    .sort((a, b) => (a.prop < b.prop ? -1 : a.prop > b.prop ? 1 : 0))
}

/** The cause node's box in whole PNG pixels of each side it exists on. */
function boxOf(screen: ScreenInput, cause: Cause): NonNullable<MemberV1['box']> {
  const { node } = cause
  const on = (snapshot: SnapshotV1, index: number): Rect | undefined => {
    const box = snapshot.nodes[index]?.box
    return box === undefined ? undefined : pngRect(box, snapshot.image)
  }
  const before =
    'added' in node ? undefined : on(screen.before, 'removed' in node ? node.removed : node.before)
  const after =
    'removed' in node ? undefined : on(screen.after, 'added' in node ? node.added : node.after)
  return {
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  }
}

/** A box in document CSS px as the whole PNG pixels it covers. */
function pngRect(box: Rect, image: ImageV1): Rect {
  const left = Math.floor((box[0] - image.origin[0]) * image.k)
  const top = Math.floor((box[1] - image.origin[1]) * image.k)
  const right = Math.ceil((box[0] + box[2] - image.origin[0]) * image.k)
  const bottom = Math.ceil((box[1] + box[3] - image.origin[1]) * image.k)
  return [left, top, right - left, bottom - top]
}

function snapshotOf(screen: ScreenInput, cause: Cause): SnapshotV1 {
  return 'added' in cause.node ? screen.after : screen.before
}

function nodeOf(screen: ScreenInput, cause: Cause): NodeV1 | undefined {
  const { node } = cause
  if ('added' in node) return screen.after.nodes[node.added]
  return screen.before.nodes['removed' in node ? node.removed : node.before]
}

function matchOf(screen: ScreenInput, cause: Cause): MatchWord {
  const { node } = cause
  if (!('before' in node)) return 'exact'
  const pair = screen.matching.pairs.find((p) => p.before === node.before)
  if (pair === undefined) return 'likely'
  if (pair.ambiguous === true) return 'ambiguous'
  return pair.pass === 1 ? 'exact' : 'likely'
}

/** Totals per effect kind; the shifted vector is the most common one, with how many moved by it when not all did. */
function effectsOf(effects: readonly Effect[]): EffectV1[] {
  const kinds: Effect['kind'][] = ['shifted', 'resized', 'reflowed', 'painted', 'inherited']
  const out: EffectV1[] = []
  for (const kind of kinds) {
    const matching = effects.filter((e) => e.kind === kind)
    const nodes = matching.reduce((sum, e) => sum + e.nodes.length, 0)
    if (nodes === 0) continue
    const vectors = new Map<string, { vector: Point; count: number }>()
    for (const effect of matching) {
      if (effect.vector === undefined) continue
      const key = `${String(effect.vector[0])},${String(effect.vector[1])}`
      const entry = vectors.get(key)
      if (entry === undefined)
        vectors.set(key, { vector: effect.vector, count: effect.nodes.length })
      else entry.count += effect.nodes.length
    }
    const top = [...vectors.entries()].sort(
      (a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1)
    )[0]
    if (top === undefined) out.push({ kind, nodes })
    else if (top[1].count === nodes) out.push({ kind, nodes, vector: top[1].vector })
    else out.push({ kind, nodes, vector: top[1].vector, vectorNodes: top[1].count })
  }
  return out
}

function screenshotEntry(
  screen: ScreenInput,
  id: string,
  causes: readonly CauseDraft[],
  own: readonly UnexplainedV1[]
): ScreenshotV1 {
  const out: Mutable<ScreenshotV1> = {
    id,
    title: screen.title,
    status: screen.regions.length > 0 ? 'changed' : 'identical',
    width: screen.before.image.width,
    height: screen.before.image.height,
    regions: screen.regions.length,
    pixels: screen.differing,
    massChange: screen.massChange,
    causes: causes.filter((c) => c.members.some((m) => m.screenshot === id)).map((c) => c.id),
    unexplained: own.map((u) => u.id),
  }
  if (screen.file !== undefined) out.file = screen.file
  if (screen.line !== undefined) out.line = screen.line
  if (screen.project !== undefined) out.project = screen.project
  if (screen.sizeMismatch !== null) {
    out.sizeMismatch = {
      before: [screen.sizeMismatch.expected.width, screen.sizeMismatch.expected.height],
      after: [screen.sizeMismatch.actual.width, screen.sizeMismatch.actual.height],
    }
  }
  return out
}

function unexplainedOf(screen: ScreenInput, screenshot: string): UnexplainedV1[] {
  const out: UnexplainedV1[] = []
  screen.explanation.regions.forEach((explained, index) => {
    if (explained.causes.length > 0) return
    const region = screen.regions[index]
    if (region === undefined) return
    const candidates = explained.candidates.map((candidate) => {
      const snapshot = candidate.before !== null ? screen.before : screen.after
      const index = candidate.before ?? candidate.after
      const node = index === null ? undefined : snapshot.nodes[index]
      return {
        locator: node === undefined ? '?' : locatorFor(node, snapshot),
        share: candidate.share,
        tag: node?.tag,
        node,
        snapshot,
      }
    })
    const rect: Rect = [region.x, region.y, region.width, region.height]
    const entry: Mutable<UnexplainedV1> = {
      id: unexplainedId(screen.screen, rect),
      screenshot,
      region: rect,
      pixels: region.pixels,
      candidates: candidates.map(({ locator, share }) => ({ locator, share })),
    }
    const top = candidates[0]
    const corner =
      explained.corner === undefined ? undefined : screen.before.nodes[explained.corner]
    if (corner !== undefined)
      entry.note = `inside the resize corner of ${code(locatorFor(corner, screen.before))}`
    else if (region.width * region.height < TINY_REGION_AREA) entry.note = 'anti-aliasing'
    else if (top?.tag !== undefined && PICTURE_TAGS.has(top.tag))
      entry.note = `under ${code(`<${top.tag}>`)}`
    else if (
      top?.node !== undefined &&
      CONTROL_TAGS.has(top.node.tag) &&
      contains(contentBox(top.snapshot, top.node), regionRect(region, top.snapshot.image))
    )
      entry.note = `inside ${code(`<${top.node.tag}>`)}: placeholder, value text or control internals, which whydiff does not capture`
    out.push(entry)
  })
  return out
}

function contentBox(snapshot: SnapshotV1, node: NodeV1): Rect {
  const length = (prop: string): number => {
    const column = snapshot.props.indexOf(prop)
    return column < 0 ? 0 : px(snapshot.styles[node.s]?.[column] ?? null)
  }
  const left = length('border-left-width') + length('padding-left')
  const top = length('border-top-width') + length('padding-top')
  const right = length('border-right-width') + length('padding-right')
  const bottom = length('border-bottom-width') + length('padding-bottom')
  const [x, y, width, height] = node.box
  return [x + left, y + top, width - left - right, height - top - bottom]
}
