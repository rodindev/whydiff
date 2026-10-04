import {
  COMPARE_KEYS,
  CONTENT_KEYS,
  DECLARATION_KEYS,
  FRAME_KEYS,
  IMAGE_KEYS,
  NODE_KEYS,
  PAGE_KEYS,
  ROOT_KEYS,
  RULE_KEYS,
  SHEET_KEYS,
  TOOL_KEYS,
  VIEWPORT_KEYS,
} from './shape.js'
import type { SnapshotV1 } from './types.js'

const SHAPES: Readonly<Record<string, readonly string[]>> = {
  tool: TOOL_KEYS,
  page: PAGE_KEYS,
  image: IMAGE_KEYS,
  viewport: VIEWPORT_KEYS,
  content: CONTENT_KEYS,
  compare: COMPARE_KEYS,
}

/** Writes a snapshot in its canonical text form: fixed key order, one style row, rule, attribution row, declaration, uses row and node per line. */
export function serializeSnapshot(snapshot: SnapshotV1): string {
  const present = ROOT_KEYS.filter((key) => snapshot[key] !== undefined)
  const entries = present.map((key, index) => {
    const last = index === present.length - 1
    return `  ${JSON.stringify(key)}: ${rootValue(snapshot, key)}${last ? '' : ','}`
  })
  return `{\n${entries.join('\n')}\n}\n`
}

function rootValue(snapshot: SnapshotV1, key: (typeof ROOT_KEYS)[number]): string {
  switch (key) {
    case 'styles':
      return multiline(snapshot.styles.map((row) => JSON.stringify(row)))
    case 'rules':
      return multiline((snapshot.rules ?? []).map((rule) => JSON.stringify(pick(rule, RULE_KEYS))))
    case 'attributions':
      return multiline((snapshot.attributions ?? []).map((row) => JSON.stringify(row)))
    case 'declarations':
      return multiline(
        (snapshot.declarations ?? []).map((entry) => JSON.stringify(pick(entry, DECLARATION_KEYS)))
      )
    case 'uses':
      return multiline((snapshot.uses ?? []).map((row) => JSON.stringify(row)))
    case 'nodes':
      return multiline(snapshot.nodes.map((node) => JSON.stringify(pick(node, NODE_KEYS))))
    case 'frames':
      return JSON.stringify(snapshot.frames.map((frame) => pick(frame, FRAME_KEYS)))
    case 'sheets':
      return multiline(snapshot.sheets.map((sheet) => JSON.stringify(pick(sheet, SHEET_KEYS))))
    case 'tool':
    case 'page':
    case 'image':
    case 'viewport':
    case 'content':
    case 'compare':
      return JSON.stringify(pick(snapshot[key], SHAPES[key] ?? []))
    default:
      return JSON.stringify(snapshot[key])
  }
}

function multiline(items: readonly string[]): string {
  if (items.length === 0) return '[]'
  return `[\n${items.map((item) => `    ${item}`).join(',\n')}\n  ]`
}

function pick(value: object, keys: readonly string[]): Record<string, unknown> {
  const source = value as Record<string, unknown> // read-only access by known key names
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  return out
}
