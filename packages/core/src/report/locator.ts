import { LOCATOR_TEXT_LIMIT } from '../constants.js'
import type { NodeV1, SnapshotV1 } from '../snapshot/types.js'
import { readable } from './format.js'

const GENERATED_ID = /(^|[-_:])\d+$|:/
// Roles whose naming WAI-ARIA prohibits: Playwright computes no name for them, so a name never matches.
const NAMELESS_ROLES: ReadonlySet<string> = new Set([
  'caption',
  'code',
  'definition',
  'deletion',
  'emphasis',
  'generic',
  'insertion',
  'mark',
  'paragraph',
  'presentation',
  'strong',
  'subscript',
  'suggestion',
  'superscript',
  'term',
  'time',
])
// Every node of the page lies inside them, so as a scope they narrow nothing.
const PAGE_TAGS: ReadonlySet<string> = new Set(['html', 'body'])
const DIGIT = /\d/
// Playwright's generator names a role only by a name with a character that is neither white space nor in a private-use area, where icon fonts put their glyphs; any other name matches every element of the role.
const NAMING = /[^\s\p{Co}]/u

interface Frame {
  readonly tags: ReadonlyMap<string, readonly NodeV1[]>
  readonly classes: ReadonlyMap<string, readonly NodeV1[]>
  readonly testIds: ReadonlyMap<string, readonly NodeV1[]>
  readonly ids: ReadonlyMap<string, readonly NodeV1[]>
  readonly roles: ReadonlyMap<string, readonly NodeV1[]>
  readonly texts: readonly NodeV1[]
}

interface Tree {
  readonly reach: readonly number[]
  readonly enter: readonly number[]
  readonly size: readonly number[]
}

interface Index extends Tree {
  readonly snapshot: SnapshotV1
  readonly wraps: ReadonlySet<number>
  readonly frames: Map<number, Frame>
  readonly specific: Map<number, string | null>
  readonly unique: Map<number, string | null>
}

const indexes = new WeakMap<SnapshotV1, Index>()

/** A Playwright locator that finds the node in the page of its snapshot: test id, role and name, id, own text, each only where it selects the node alone, else css with the node's most selective class, scoped to the nearest ancestor a locator finds alone; a pseudo-element is found as its element, a node in a closed shadow root as its host. */
export function locatorFor(node: NodeV1, snapshot: SnapshotV1): string {
  const index = indexOf(snapshot)
  const target = snapshot.nodes[index.reach[node.i] ?? -1] ?? node
  const frame = target.f ?? 0
  const owner = snapshot.nodes[snapshot.frames[frame]?.owner ?? -1]
  const head = owner === undefined ? '' : `${locatorFor(owner, snapshot)}.contentFrame().`
  const own = specific(index, target)
  if (own !== null) return head + own
  const scope = nearestScope(index, target)
  if (scope === null) return head + css(index, target, null)
  return `${head}${scope.locator}.${css(index, target, scope.node)}`
}

function specific(index: Index, node: NodeV1): string | null {
  const known = index.specific.get(node.i)
  if (known !== undefined) return known
  const found = specificOf(index, node)
  index.specific.set(node.i, found)
  return found
}

function specificOf(index: Index, node: NodeV1): string | null {
  const frame = frameOf(index, node.f ?? 0)
  const { testId, role, name, id, text } = node
  if (testId !== undefined && frame.testIds.get(testId)?.length === 1) {
    return `getByTestId(${quote(testId)})`
  }
  if (
    role !== undefined &&
    name !== undefined &&
    NAMING.test(name) &&
    !NAMELESS_ROLES.has(role) &&
    alone(frame.roles.get(role) ?? [], (other) => contains(other.name, name))
  ) {
    return `getByRole(${quote(role)}, { name: ${quote(name)} })`
  }
  if (id !== undefined && !GENERATED_ID.test(id) && frame.ids.get(id)?.length === 1) {
    return `locator(${quote(`#${ident(id)}`)})`
  }
  if (
    text !== undefined &&
    readable(text) &&
    text.length <= LOCATOR_TEXT_LIMIT &&
    !index.wraps.has(node.i) &&
    alone(frame.texts, (other) => contains(other.text, text))
  ) {
    return `getByText(${quote(text)})`
  }
  return null
}

function nearestScope(index: Index, node: NodeV1): { node: NodeV1; locator: string } | null {
  const { nodes } = index.snapshot
  for (let ancestor = nodes[node.p]; ancestor !== undefined; ancestor = nodes[ancestor.p]) {
    if (!isDescendant(index, node, ancestor)) continue
    const locator =
      specific(index, ancestor) ?? (PAGE_TAGS.has(ancestor.tag) ? null : unique(index, ancestor))
    if (locator !== null) return { node: ancestor, locator }
  }
  return null
}

function unique(index: Index, node: NodeV1): string | null {
  const known = index.unique.get(node.i)
  if (known !== undefined) return known
  const name = classOf(index, node, null)
  const found =
    twinsOf(index, node, name).length === 1 ? `locator(${quote(selector(node, name))})` : null
  index.unique.set(node.i, found)
  return found
}

function css(index: Index, node: NodeV1, scope: NodeV1 | null): string {
  const name = classOf(index, node, scope)
  const twins = twinsOf(index, node, name).filter(
    (other) => scope === null || isDescendant(index, other, scope)
  )
  const nth = twins.length > 1 ? `.nth(${String(twins.indexOf(node))})` : ''
  return `locator(${quote(selector(node, name))})${nth}`
}

function classOf(index: Index, node: NodeV1, scope: NodeV1 | null): string | undefined {
  const { classes } = frameOf(index, node.f ?? 0)
  const [best] = [...new Set(node.cls ?? [])]
    .map((name) => {
      const all = classes.get(classKey(node.tag, name)) ?? []
      const twins =
        scope === null
          ? all.length
          : all.filter((other) => isDescendant(index, other, scope)).length
      return { name, twins, all: all.length }
    })
    .sort(
      (a, b) =>
        a.twins - b.twins ||
        a.all - b.all ||
        Number(DIGIT.test(a.name)) - Number(DIGIT.test(b.name)) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    )
  return best?.name
}

function twinsOf(index: Index, node: NodeV1, name: string | undefined): readonly NodeV1[] {
  const frame = frameOf(index, node.f ?? 0)
  return (
    (name === undefined ? frame.tags.get(node.tag) : frame.classes.get(classKey(node.tag, name))) ??
    []
  )
}

function selector(node: NodeV1, name: string | undefined): string {
  return name === undefined ? node.tag : `${node.tag}.${ident(name)}`
}

function classKey(tag: string, name: string): string {
  return `${tag} ${name}`
}

function indexOf(snapshot: SnapshotV1): Index {
  const known = indexes.get(snapshot)
  if (known !== undefined) return known
  const tree = treeOf(snapshot.nodes)
  const index: Index = {
    ...tree,
    snapshot,
    wraps: wrapsOf(snapshot.nodes, tree),
    frames: new Map(),
    specific: new Map(),
    unique: new Map(),
  }
  indexes.set(snapshot, index)
  return index
}

function treeOf(nodes: readonly NodeV1[]): Tree {
  const reach: number[] = []
  for (const node of nodes) {
    const above = reach[node.p]
    const hosted = node.flags?.some(
      (flag) => flag.startsWith('pseudo:') || flag === 'shadow:closed'
    )
    if (above !== undefined && above !== node.p) reach.push(above)
    else reach.push(hosted === true && node.p >= 0 ? node.p : node.i)
  }
  const size = nodes.map(() => 1)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const p = nodes[i]?.p ?? -1
    if (p >= 0) size[p] = (size[p] ?? 1) + (size[i] ?? 1)
  }
  // pre-order numbers of the parent tree, so a subtree is the range after its root
  const enter: number[] = []
  const next: number[] = []
  let roots = 0
  for (const node of nodes) {
    const start = node.p >= 0 ? (next[node.p] ?? 0) : roots
    enter.push(start)
    next.push(start + 1)
    if (node.p >= 0) next[node.p] = start + (size[node.i] ?? 1)
    else roots = start + (size[node.i] ?? 1)
  }
  return { reach, enter, size }
}

function wrapsOf(nodes: readonly NodeV1[], tree: Tree): Set<number> {
  const out = new Set<number>()
  for (const node of nodes) {
    if (node.text === undefined || tree.reach[node.i] !== node.i) continue
    for (let at = nodes[node.p]; at !== undefined; at = nodes[at.p]) {
      if (isDescendant(tree, node, at)) out.add(at.i)
    }
  }
  return out
}

function frameOf(index: Index, f: number): Frame {
  const known = index.frames.get(f)
  if (known !== undefined) return known
  const peers = index.snapshot.nodes
    .filter((node) => (node.f ?? 0) === f && index.reach[node.i] === node.i)
    // Playwright lists the matches of the light tree before those inside shadow roots
    .sort((a, b) => Number(inShadow(a)) - Number(inShadow(b)) || a.i - b.i)
  const frame: Frame = {
    tags: group(peers, (node) => [node.tag]),
    classes: group(peers, (node) =>
      [...new Set(node.cls ?? [])].map((name) => classKey(node.tag, name))
    ),
    testIds: group(peers, (node) => (node.testId === undefined ? [] : [node.testId])),
    ids: group(peers, (node) => (node.id === undefined ? [] : [node.id])),
    roles: group(peers, (node) => (node.role === undefined ? [] : [node.role])),
    texts: peers.filter((node) => node.text !== undefined),
  }
  index.frames.set(f, frame)
  return frame
}

function group(
  nodes: readonly NodeV1[],
  keys: (node: NodeV1) => readonly string[]
): Map<string, NodeV1[]> {
  const out = new Map<string, NodeV1[]>()
  for (const node of nodes) {
    for (const key of keys(node)) {
      const list = out.get(key)
      if (list === undefined) out.set(key, [node])
      else list.push(node)
    }
  }
  return out
}

function isDescendant(tree: Tree, node: NodeV1, ancestor: NodeV1): boolean {
  // the snapshot nests a slotted light node under its slot; Playwright searches the light tree, not the slot
  if (inShadow(ancestor) && !inShadow(node)) return false
  const offset = (tree.enter[node.i] ?? 0) - (tree.enter[ancestor.i] ?? 0)
  return offset > 0 && offset < (tree.size[ancestor.i] ?? 0)
}

function inShadow(node: NodeV1): boolean {
  return node.flags?.includes('shadow:open') === true
}

function alone(nodes: readonly NodeV1[], test: (node: NodeV1) => boolean): boolean {
  return nodes.filter(test).length === 1
}

function contains(value: string | undefined, part: string): boolean {
  return value?.toLowerCase().includes(part.toLowerCase()) === true
}

// CSSOM "serialize an identifier", the escaping of CSS.escape()
function ident(name: string): string {
  let out = ''
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i)
    const char = name.charAt(i)
    if (
      code <= 0x1f ||
      code === 0x7f ||
      (DIGIT.test(char) && (i === 0 || (i === 1 && name.startsWith('-'))))
    ) {
      out += `\\${code.toString(16)} `
    } else if (name === '-') out += '\\-'
    else if (code >= 0x80 || /[\w-]/.test(char)) out += char
    else out += `\\${char}`
  }
  return out
}

function quote(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}
