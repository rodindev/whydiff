import {
  SNAPSHOT_FORMAT_VERSION,
  type DeclarationV1,
  type NodeFlag,
  type NodeV1,
  type Rect,
  type RuleV1,
  type SheetV1,
  type SnapshotV1,
} from '../snapshot/types.js'

/** One node of a hand-written tree; children are nested, everything else is optional. */
export interface TreeSpec {
  readonly tag: string
  readonly box?: Rect
  readonly id?: string
  readonly testId?: string
  readonly role?: string
  readonly name?: string
  readonly text?: string
  readonly cls?: readonly string[]
  /** Style values in the order of `props`. */
  readonly style?: readonly string[]
  /** Index into the `attributions` of the options. */
  readonly a?: number
  readonly f?: number
  /** Number of rendered text lines; the box is split into that many line boxes. */
  readonly lines?: number
  readonly scroll?: Rect
  readonly layer?: number
  readonly stacking?: true
  readonly font?: string
  readonly flags?: readonly NodeFlag[]
  readonly children?: readonly TreeSpec[]
}

export interface TreeOptions {
  readonly props?: readonly string[]
  readonly origin?: readonly [number, number]
  readonly k?: number
  readonly sheets?: readonly SheetV1[]
  readonly rules?: readonly RuleV1[]
  readonly attributions?: readonly (readonly number[])[]
  readonly declarations?: readonly DeclarationV1[]
  readonly uses?: readonly (readonly number[])[]
}

const DEFAULT_BOX: Rect = [0, 0, 100, 100]
type Mutable<T> = { -readonly [K in keyof T]: T[K] }

function lineBoxes(box: Rect, lines: number): Rect[] {
  const height = box[3] / lines
  return Array.from({ length: lines }, (_, i) => [box[0], box[1] + i * height, box[2], height])
}

/** Builds a valid snapshot from nested specs: pre-order indices, deduplicated style rows, one frame. */
export function buildSnapshot(roots: readonly TreeSpec[], options: TreeOptions = {}): SnapshotV1 {
  const props = options.props ?? ['display']
  const styles: string[][] = []
  const styleIndex = new Map<string, number>()
  const nodes: NodeV1[] = []
  const visit = (spec: TreeSpec, parent: number): void => {
    const row = spec.style ?? props.map(() => 'block')
    const key = row.join('\u0000')
    let s = styleIndex.get(key)
    if (s === undefined) {
      s = styles.length
      styleIndex.set(key, s)
      styles.push([...row])
    }
    const node: Mutable<NodeV1> = {
      i: nodes.length,
      p: parent,
      tag: spec.tag,
      box: spec.box ?? DEFAULT_BOX,
      s,
    }
    if (spec.a !== undefined) node.a = spec.a
    if (spec.f !== undefined) node.f = spec.f
    if (spec.role !== undefined) node.role = spec.role
    if (spec.name !== undefined) node.name = spec.name
    if (spec.id !== undefined) node.id = spec.id
    if (spec.testId !== undefined) node.testId = spec.testId
    if (spec.cls !== undefined) node.cls = [...spec.cls]
    if (spec.text !== undefined) node.text = spec.text
    if (spec.lines !== undefined && spec.lines > 1) node.lineBoxes = lineBoxes(node.box, spec.lines)
    if (spec.scroll !== undefined) node.scroll = spec.scroll
    if (spec.layer !== undefined) node.layer = spec.layer
    if (spec.stacking !== undefined) node.stacking = spec.stacking
    if (spec.font !== undefined) node.font = spec.font
    if (spec.flags !== undefined) node.flags = [...spec.flags]
    nodes.push(node)
    for (const child of spec.children ?? []) visit(child, node.i)
  }
  for (const root of roots) visit(root, -1)
  const origin = options.origin ?? [0, 0]
  const snapshot: Mutable<SnapshotV1> = {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    tool: { name: 'whydiff', version: '0.0.1', source: 'cdp', browser: 'chromium 147.0.0' },
    page: { url: 'http://app.test/', title: 'Fixture' },
    image: {
      width: 1000,
      height: 800,
      k: options.k ?? 1,
      layoutFactor: 1,
      origin: [origin[0], origin[1]],
      fullPage: false,
    },
    viewport: { width: 1000, height: 800, scrollX: origin[0], scrollY: origin[1] },
    content: { width: 1000, height: 800 },
    compare: { threshold: 0.2, animations: 'disabled', caret: 'hide', scale: 'css' },
    frames: [
      {
        url: 'http://app.test/',
        owner: null,
        offset: [0, 0],
        scroll: [origin[0], origin[1]],
        status: 'captured',
      },
    ],
    masks: [],
    sheets: [...(options.sheets ?? [])],
    props: [...props],
    styles,
    nodes,
  }
  if (options.rules !== undefined) snapshot.rules = [...options.rules]
  if (options.attributions !== undefined)
    snapshot.attributions = options.attributions.map((r) => [...r])
  if (options.declarations !== undefined) snapshot.declarations = [...options.declarations]
  if (options.uses !== undefined) snapshot.uses = options.uses.map((r) => [...r])
  return snapshot
}
