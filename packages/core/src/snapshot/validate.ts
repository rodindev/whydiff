import { WhydiffError } from '../errors.js'
import {
  CAPTURE_SOURCES,
  COMPARE_KEYS,
  CONTENT_KEYS,
  DECLARATION_KEYS,
  FRAME_KEYS,
  FRAME_STATUSES,
  IMAGE_KEYS,
  NODE_FLAGS,
  NODE_KEYS,
  PAGE_KEYS,
  ROOT_KEYS,
  RULE_KEYS,
  SCREENSHOT_SCALES,
  SHEET_KEYS,
  TOOL_KEYS,
  VIEWPORT_KEYS,
} from './shape.js'
import {
  SNAPSHOT_FORMAT_VERSION,
  type CompareV1,
  type ContentV1,
  type DeclarationV1,
  type FrameV1,
  type ImageV1,
  type NodeV1,
  type PageV1,
  type Point,
  type Rect,
  type RuleV1,
  type SheetV1,
  type SnapshotV1,
  type ToolV1,
  type ViewportV1,
} from './types.js'

type Raw = Record<string, unknown>
type Check<T> = (value: unknown, path: string) => T
type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/** Checks a parsed JSON value against format v1 and returns it typed; throws WhydiffError otherwise. */
export function validateSnapshot(value: unknown): SnapshotV1 {
  const raw = record(value, '$', ROOT_KEYS)
  if (raw.formatVersion !== SNAPSHOT_FORMAT_VERSION) {
    fail('$.formatVersion', `expected ${String(SNAPSHOT_FORMAT_VERSION)}`)
  }
  const snapshot: Mutable<SnapshotV1> = {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    tool: tool(raw.tool, '$.tool'),
    page: page(raw.page, '$.page'),
    image: image(raw.image, '$.image'),
    viewport: viewport(raw.viewport, '$.viewport'),
    content: content(raw.content, '$.content'),
    compare: compare(raw.compare, '$.compare'),
    frames: list(raw.frames, '$.frames', frame),
    masks: list(raw.masks, '$.masks', rect),
    sheets: list(raw.sheets, '$.sheets', sheet),
    props: list(raw.props, '$.props', string),
    styles: list(raw.styles, '$.styles', (v, p) => list(v, p, string)),
    nodes: list(raw.nodes, '$.nodes', node),
  }
  assign(
    snapshot,
    'rules',
    optional(raw, 'rules', '$', (v, p) => list(v, p, rule))
  )
  assign(
    snapshot,
    'attributions',
    optional(raw, 'attributions', '$', (v, p) =>
      list(v, p, (row, q) => list(row, q, (n, r) => integer(n, r, -1)))
    )
  )
  assign(
    snapshot,
    'declarations',
    optional(raw, 'declarations', '$', (v, p) => list(v, p, declaration))
  )
  assign(
    snapshot,
    'uses',
    optional(raw, 'uses', '$', (v, p) =>
      list(v, p, (row, q) => list(row, q, (n, r) => integer(n, r, 0)))
    )
  )
  checkRelations(snapshot)
  return snapshot
}

function fail(path: string, message: string): never {
  throw new WhydiffError(
    'invalid-snapshot',
    `${path}: ${message}. Re-capture the snapshot with the whydiff version you diff with.`
  )
}

function record(value: unknown, path: string, keys: readonly string[]): Raw {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'expected an object')
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`${path}.${key}`, 'unknown key')
  }
  return value as Raw // narrowed to a plain object above
}

function list<T>(value: unknown, path: string, item: Check<T>): T[] {
  if (!Array.isArray(value)) fail(path, 'expected an array')
  return value.map((element: unknown, index) => item(element, `${path}[${String(index)}]`))
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'expected a string')
  return value
}

function number(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'expected a finite number')
  return value
}

function integer(value: unknown, path: string, min: number): number {
  const n = number(value, path)
  if (!Number.isInteger(n) || n < min) fail(path, `expected an integer of at least ${String(min)}`)
  return n
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'expected a boolean')
  return value
}

function oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  const match = allowed.find((item) => item === value)
  if (match === undefined) fail(path, `expected one of ${allowed.join(', ')}`)
  return match
}

function literalTrue(value: unknown, path: string): true {
  if (value !== true) fail(path, 'expected true')
  return true
}

function tuple(value: unknown, path: string, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length) {
    fail(path, `expected ${String(length)} numbers`)
  }
  return value.map((element: unknown, index) => number(element, `${path}[${String(index)}]`))
}

function rect(value: unknown, path: string): Rect {
  const [x, y, width, height] = tuple(value, path, 4) as [number, number, number, number] // tuple checked the length
  if (width < 0 || height < 0) fail(path, 'expected a non-negative size')
  return [x, y, width, height]
}

function point(value: unknown, path: string): Point {
  const [x, y] = tuple(value, path, 2) as [number, number] // tuple checked the length
  return [x, y]
}

function optional<T>(raw: Raw, key: string, path: string, check: Check<T>): T | undefined {
  return raw[key] === undefined ? undefined : check(raw[key], `${path}.${key}`)
}

function assign<T extends object, K extends keyof T>(
  target: Mutable<T>,
  key: K,
  value: T[K] | undefined
): void {
  if (value !== undefined) target[key] = value
}

function tool(value: unknown, path: string): ToolV1 {
  const raw = record(value, path, TOOL_KEYS)
  const out: Mutable<ToolV1> = {
    name: oneOf(raw.name, `${path}.name`, ['whydiff']),
    version: string(raw.version, `${path}.version`),
    source: oneOf(raw.source, `${path}.source`, CAPTURE_SOURCES),
    browser: string(raw.browser, `${path}.browser`),
  }
  assign(out, 'capturedAfterMs', optional(raw, 'capturedAfterMs', path, number))
  return out
}

function page(value: unknown, path: string): PageV1 {
  const raw = record(value, path, PAGE_KEYS)
  return { url: string(raw.url, `${path}.url`), title: string(raw.title, `${path}.title`) }
}

function image(value: unknown, path: string): ImageV1 {
  const raw = record(value, path, IMAGE_KEYS)
  const out: Mutable<ImageV1> = {
    width: integer(raw.width, `${path}.width`, 0),
    height: integer(raw.height, `${path}.height`, 0),
    k: number(raw.k, `${path}.k`),
    layoutFactor: number(raw.layoutFactor, `${path}.layoutFactor`),
    origin: point(raw.origin, `${path}.origin`),
    fullPage: boolean(raw.fullPage, `${path}.fullPage`),
  }
  assign(
    out,
    'root',
    optional(raw, 'root', path, (v, p) => integer(v, p, 0))
  )
  return out
}

function viewport(value: unknown, path: string): ViewportV1 {
  const raw = record(value, path, VIEWPORT_KEYS)
  return {
    width: number(raw.width, `${path}.width`),
    height: number(raw.height, `${path}.height`),
    scrollX: number(raw.scrollX, `${path}.scrollX`),
    scrollY: number(raw.scrollY, `${path}.scrollY`),
  }
}

function content(value: unknown, path: string): ContentV1 {
  const raw = record(value, path, CONTENT_KEYS)
  return { width: number(raw.width, `${path}.width`), height: number(raw.height, `${path}.height`) }
}

function compare(value: unknown, path: string): CompareV1 {
  const raw = record(value, path, COMPARE_KEYS)
  const threshold = number(raw.threshold, `${path}.threshold`)
  if (threshold < 0 || threshold > 1) fail(`${path}.threshold`, 'expected a number from 0 to 1')
  const out: Mutable<CompareV1> = {
    threshold,
    animations: string(raw.animations, `${path}.animations`),
    caret: string(raw.caret, `${path}.caret`),
    scale: oneOf(raw.scale, `${path}.scale`, SCREENSHOT_SCALES),
  }
  assign(
    out,
    'maxDiffPixels',
    optional(raw, 'maxDiffPixels', path, (v, p) => integer(v, p, 0))
  )
  assign(out, 'maxDiffPixelRatio', optional(raw, 'maxDiffPixelRatio', path, number))
  return out
}

function frame(value: unknown, path: string): FrameV1 {
  const raw = record(value, path, FRAME_KEYS)
  return {
    url: string(raw.url, `${path}.url`),
    owner: raw.owner === null ? null : integer(raw.owner, `${path}.owner`, 0),
    offset: point(raw.offset, `${path}.offset`),
    scroll: point(raw.scroll, `${path}.scroll`),
    status: oneOf(raw.status, `${path}.status`, FRAME_STATUSES),
  }
}

function sheet(value: unknown, path: string): SheetV1 {
  const raw = record(value, path, SHEET_KEYS)
  const out: Mutable<SheetV1> = { hash: string(raw.hash, `${path}.hash`) }
  assign(out, 'href', optional(raw, 'href', path, string))
  assign(out, 'inline', optional(raw, 'inline', path, literalTrue))
  assign(out, 'harness', optional(raw, 'harness', path, literalTrue))
  return out
}

function rule(value: unknown, path: string): RuleV1 {
  const raw = record(value, path, RULE_KEYS)
  const out: Mutable<RuleV1> = { selector: string(raw.selector, `${path}.selector`) }
  assign(
    out,
    'sheet',
    optional(raw, 'sheet', path, (v, p) => integer(v, p, 0))
  )
  assign(out, 'inline', optional(raw, 'inline', path, literalTrue))
  assign(out, 'userAgent', optional(raw, 'userAgent', path, literalTrue))
  const kinds = [out.sheet, out.inline, out.userAgent].filter((kind) => kind !== undefined)
  if (kinds.length !== 1) fail(path, 'expected exactly one of a sheet index, inline or userAgent')
  assign(out, 'layer', optional(raw, 'layer', path, string))
  assign(out, 'important', optional(raw, 'important', path, literalTrue))
  return out
}

function declaration(value: unknown, path: string): DeclarationV1 {
  const raw = record(value, path, DECLARATION_KEYS)
  const out: Mutable<DeclarationV1> = { prop: string(raw.prop, `${path}.prop`) }
  assign(
    out,
    'rule',
    optional(raw, 'rule', path, (v, p) => integer(v, p, 0))
  )
  assign(out, 'value', optional(raw, 'value', path, string))
  assign(out, 'initial', optional(raw, 'initial', path, literalTrue))
  assign(out, 'inherited', optional(raw, 'inherited', path, literalTrue))
  assign(
    out,
    'reads',
    optional(raw, 'reads', path, (v, p) => list(v, p, (n, q) => integer(n, q, 0)))
  )
  return out
}

function node(value: unknown, path: string): NodeV1 {
  const raw = record(value, path, NODE_KEYS)
  const out: Mutable<NodeV1> = {
    i: integer(raw.i, `${path}.i`, 0),
    p: integer(raw.p, `${path}.p`, -1),
    tag: string(raw.tag, `${path}.tag`),
    box: rect(raw.box, `${path}.box`),
    s: integer(raw.s, `${path}.s`, 0),
  }
  assign(
    out,
    'f',
    optional(raw, 'f', path, (v, p) => integer(v, p, 0))
  )
  assign(
    out,
    'a',
    optional(raw, 'a', path, (v, p) => integer(v, p, 0))
  )
  assign(out, 'role', optional(raw, 'role', path, string))
  assign(out, 'name', optional(raw, 'name', path, string))
  assign(out, 'id', optional(raw, 'id', path, string))
  assign(out, 'testId', optional(raw, 'testId', path, string))
  assign(
    out,
    'cls',
    optional(raw, 'cls', path, (v, p) => list(v, p, string))
  )
  assign(out, 'text', optional(raw, 'text', path, string))
  assign(out, 'value', optional(raw, 'value', path, string))
  assign(out, 'checked', optional(raw, 'checked', path, boolean))
  assign(
    out,
    'lineBoxes',
    optional(raw, 'lineBoxes', path, (v, p) => list(v, p, rect))
  )
  assign(out, 'scroll', optional(raw, 'scroll', path, rect))
  assign(out, 'img', optional(raw, 'img', path, string))
  assign(
    out,
    'layer',
    optional(raw, 'layer', path, (v, p) => integer(v, p, 0))
  )
  assign(out, 'stacking', optional(raw, 'stacking', path, literalTrue))
  assign(out, 'font', optional(raw, 'font', path, string))
  assign(out, 'src', optional(raw, 'src', path, string))
  assign(
    out,
    'flags',
    optional(raw, 'flags', path, (v, p) => list(v, p, (f, q) => oneOf(f, q, NODE_FLAGS)))
  )
  return out
}

function checkRelations(snapshot: SnapshotV1): void {
  const nodeCount = snapshot.nodes.length
  if (snapshot.image.root !== undefined && snapshot.image.root >= nodeCount) {
    fail('$.image.root', 'node index out of range')
  }
  const propCount = snapshot.props.length
  snapshot.styles.forEach((row, index) => {
    if (row.length !== propCount) {
      fail(`$.styles[${String(index)}]`, `expected ${String(propCount)} values, one per prop`)
    }
  })
  const rules = snapshot.rules ?? []
  const attributions = snapshot.attributions ?? []
  rules.forEach((rule, index) => {
    if (rule.sheet !== undefined && rule.sheet >= snapshot.sheets.length) {
      fail(`$.rules[${String(index)}].sheet`, 'sheet index out of range')
    }
  })
  attributions.forEach((row, index) => {
    const path = `$.attributions[${String(index)}]`
    if (row.length !== propCount) fail(path, `expected ${String(propCount)} values, one per prop`)
    row.forEach((entry, column) => {
      if (entry >= rules.length) fail(`${path}[${String(column)}]`, 'rule index out of range')
      if (rules[entry]?.userAgent === true) {
        fail(`${path}[${String(column)}]`, 'expected an author rule, not a browser rule')
      }
    })
  })
  checkDeclarations(snapshot)
  snapshot.frames.forEach((frame, index) => {
    const path = `$.frames[${String(index)}].owner`
    if (index === 0 && frame.owner !== null) fail(path, 'expected null for the main frame')
    if (frame.owner !== null && frame.owner >= nodeCount) fail(path, 'node index out of range')
  })
  snapshot.nodes.forEach((node, index) => {
    const path = `$.nodes[${String(index)}]`
    if (node.i !== index) fail(`${path}.i`, `expected ${String(index)}, indices are dense`)
    if (node.p >= index) fail(`${path}.p`, 'expected the index of an earlier node or -1')
    if (node.s >= snapshot.styles.length) fail(`${path}.s`, 'style index out of range')
    if (node.a !== undefined && node.a >= attributions.length)
      fail(`${path}.a`, 'attribution index out of range')
    if (node.f !== undefined && node.f >= snapshot.frames.length)
      fail(`${path}.f`, 'frame index out of range')
  })
}

function checkDeclarations(snapshot: SnapshotV1): void {
  const { declarations, uses, rules, attributions, props } = snapshot
  if (declarations === undefined && uses === undefined) return
  if (
    declarations === undefined ||
    uses === undefined ||
    rules === undefined ||
    attributions === undefined
  ) {
    fail('$.declarations', 'expected together with uses, rules and attributions')
  }
  declarations.forEach((entry, index) => {
    const path = `$.declarations[${String(index)}]`
    if (entry.rule !== undefined && entry.rule >= rules.length) {
      fail(`${path}.rule`, 'rule index out of range')
    }
    if (entry.initial === true && entry.value === undefined) {
      fail(`${path}.initial`, 'expected a value')
    }
    entry.reads?.forEach((read, at) => {
      const readPath = `${path}.reads[${String(at)}]`
      if (read >= index) fail(readPath, 'expected the index of an earlier declaration')
      if (declarations[read]?.prop.startsWith('--') !== true) {
        fail(readPath, 'expected a custom property')
      }
    })
  })
  if (uses.length !== attributions.length) {
    fail('$.uses', `expected ${String(attributions.length)} rows, one per attribution row`)
  }
  uses.forEach((row, index) => {
    let previous = -1
    row.forEach((entry, at) => {
      const path = `$.uses[${String(index)}][${String(at)}]`
      const declaration = declarations[entry]
      if (declaration === undefined) fail(path, 'declaration index out of range')
      const column = props.indexOf(declaration.prop)
      if (column <= previous) fail(path, 'expected a longhand of props, after the previous one')
      previous = column
      const attribution = attributions[index]?.[column]
      const browser = rules[declaration.rule ?? -1]?.userAgent === true
      if (browser ? attribution !== -1 : declaration.rule !== attribution) {
        fail(
          path,
          'expected the rule the attribution row names, or a browser rule where it names none'
        )
      }
    })
  })
}
