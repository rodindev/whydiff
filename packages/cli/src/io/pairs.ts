import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseSnapshot, WhydiffError, type RgbaImage, type SnapshotV1 } from '@whydiff/core'

import { SNAPS_DIR } from '../constants.js'
import { readPng } from './png.js'
import { isRunDir, runSides, snapshotSides, type RunSide } from './runs.js'

const SIDECAR = '.whydiff.json'

/** One argument of `diff`, classified: a single snapshot with its PNG, a two-run output, or a snapshot directory. */
export type Input =
  | {
      readonly kind: 'single'
      readonly label: string
      readonly snapshot: string
      readonly png: string
    }
  | { readonly kind: 'run'; readonly label: string; readonly dir: string }
  | { readonly kind: 'snapshots'; readonly label: string; readonly dir: string }

/** The two files of one side of a pair. */
interface PairSide {
  readonly snapshot: string
  readonly png: string
}

/** Who a pair belongs to, as the report names it. */
interface ScreenIdentity {
  readonly screen: string
  readonly title: string
  readonly file?: string
  readonly line?: number
  readonly project?: string
}

/** One screenshot to analyze: its identity and the files of both sides. */
export interface InputPair extends ScreenIdentity {
  readonly before: PairSide
  readonly after: PairSide
}

/** A pair that cannot be analyzed because a run recorded no PNG for it; `missing` names the inputs without one. */
export interface PairWithoutPng extends ScreenIdentity {
  readonly missing: readonly string[]
}

/** The pairs two inputs form, what was found on one side only, and the pairs a run recorded no PNG for. */
export interface Paired {
  readonly pairs: readonly InputPair[]
  readonly unpaired: readonly string[]
  readonly withoutPng: readonly PairWithoutPng[]
}

/** A snap name, a `.whydiff.json` file with its PNG beside it, or a directory; anything else is an error. */
export async function resolveInput(arg: string, cwd: string): Promise<Input> {
  const path = resolve(cwd, arg)
  const info = await stat(path).catch(() => null)
  if (info?.isDirectory() === true) {
    return (await isRunDir(path))
      ? { kind: 'run', label: arg, dir: path }
      : { kind: 'snapshots', label: arg, dir: path }
  }
  if (info?.isFile() === true && path.endsWith(SIDECAR)) return single(arg, path)
  const snap = join(cwd, SNAPS_DIR, `${arg}${SIDECAR}`)
  if (await exists(snap)) return single(arg, snap)
  throw new WhydiffError(
    'invalid-option',
    `${arg} is not a snap name, a .whydiff.json file or a directory. Run npx whydiff snap <url> --name ${arg} first, or give a path.`
  )
}

/** Pairs two inputs of the same kind; a single file pairs with a single file, directories by their keys. */
export async function pairInputs(before: Input, after: Input): Promise<Paired> {
  if (before.kind === 'single' && after.kind === 'single') {
    return {
      pairs: [
        {
          screen: `${before.label}|${after.label}`,
          title: `${before.label} -> ${after.label}`,
          before: { snapshot: before.snapshot, png: before.png },
          after: { snapshot: after.snapshot, png: after.png },
        },
      ],
      unpaired: [],
      withoutPng: [],
    }
  }
  if (before.kind === 'run' && after.kind === 'run') {
    return pairSides(await runSides(before.dir), await runSides(after.dir), before, after)
  }
  if (before.kind === 'snapshots' && after.kind === 'snapshots') {
    const left = await snapshotSides(before.dir)
    const right = await snapshotSides(after.dir)
    const paired = pairSides(left.sides, right.sides, before, after)
    return {
      ...paired,
      unpaired: [
        ...paired.unpaired,
        ...left.withoutSnapshot.map((key) => `${before.label}: ${key}.png has no .whydiff.json`),
        ...right.withoutSnapshot.map((key) => `${after.label}: ${key}.png has no .whydiff.json`),
      ],
    }
  }
  throw new WhydiffError(
    'invalid-option',
    `${before.label} is ${describe(before)} and ${after.label} is ${describe(after)}; both sides of a diff must be of the same kind.`
  )
}

function pairSides(
  left: ReadonlyMap<string, RunSide>,
  right: ReadonlyMap<string, RunSide>,
  before: Input,
  after: Input
): Paired {
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort()
  const pairs: InputPair[] = []
  const unpaired: string[] = []
  const withoutPng: PairWithoutPng[] = []
  for (const key of keys) {
    const a = left.get(key)
    const b = right.get(key)
    if (a === undefined || b === undefined) {
      unpaired.push(`${a === undefined ? after.label : before.label}: ${key} has no counterpart`)
      continue
    }
    if (a.png === null || b.png === null) {
      withoutPng.push({
        ...identityOf(key, b),
        missing: [
          ...(a.png === null ? [before.label] : []),
          ...(b.png === null ? [after.label] : []),
        ],
      })
      continue
    }
    pairs.push({
      ...identityOf(key, b),
      before: { snapshot: a.snapshot, png: a.png },
      after: { snapshot: b.snapshot, png: b.png },
    })
  }
  return { pairs: pairs.sort(comparePairs), unpaired, withoutPng: withoutPng.sort(comparePairs) }
}

function identityOf(key: string, side: RunSide): ScreenIdentity {
  return {
    screen: key,
    title: side.title,
    ...(side.file === undefined ? {} : { file: side.file }),
    ...(side.line === undefined ? {} : { line: side.line }),
    ...(side.project === undefined ? {} : { project: side.project }),
  }
}

/** The reporter's order: project, file, line, title, then the key. */
function comparePairs(a: ScreenIdentity, b: ScreenIdentity): number {
  return (
    compareText(a.project ?? '', b.project ?? '') ||
    compareText(a.file ?? '', b.file ?? '') ||
    (a.line ?? 0) - (b.line ?? 0) ||
    compareText(a.title, b.title) ||
    compareText(a.screen, b.screen)
  )
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

async function single(label: string, snapshot: string): Promise<Input> {
  const png = snapshot.slice(0, -SIDECAR.length) + '.png'
  if (!(await exists(png))) {
    throw new WhydiffError(
      'invalid-option',
      `${png} is missing next to ${snapshot}. Keep the PNG beside its snapshot, as whydiff snap writes them.`
    )
  }
  return { kind: 'single', label, snapshot, png }
}

function describe(input: Input): string {
  switch (input.kind) {
    case 'single':
      return 'one snapshot'
    case 'run':
      return 'a two-run output directory'
    case 'snapshots':
      return 'a snapshot directory'
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    (info) => info.isFile(),
    () => false
  )
}

/** Both snapshots and both images of a pair, decoded. */
export interface PairFiles {
  readonly before: SnapshotV1
  readonly after: SnapshotV1
  readonly expected: RgbaImage
  readonly actual: RgbaImage
}

/** Reads and decodes both snapshots and both PNGs of a pair. */
export async function readPairFiles(pair: InputPair): Promise<PairFiles> {
  const [before, after, expected, actual] = await Promise.all([
    readFile(pair.before.snapshot, 'utf8').then(parseSnapshot),
    readFile(pair.after.snapshot, 'utf8').then(parseSnapshot),
    readPng(pair.before.png),
    readPng(pair.after.png),
  ])
  return { before, after, expected, actual }
}
