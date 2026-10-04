import type { DocumentSnapshot, RareString } from '../raw.js'

type RareColumn = 'textValue' | 'inputValue' | 'pseudoType' | 'shadowRootType' | 'currentSourceURL'

/** Lookups over one document that the emitter needs repeatedly. */
export interface IndexedDocument {
  readonly strings: readonly string[]
  readonly document: DocumentSnapshot
  /** First layout row of each node, -1 when the node has none. */
  readonly rowOf: readonly number[]
  readonly childrenOf: readonly (readonly number[])[]
  /** Text box bounds per layout row. */
  readonly textBoxesOf: ReadonlyMap<number, readonly (readonly number[])[]>
  readonly stackingRows: ReadonlySet<number>
  readonly columns: ReadonlyMap<string, number>
  /** First node index per backend node id. */
  readonly nodeOf: ReadonlyMap<number, number>
  /** Value per node index of each sparse string column. */
  readonly rare: Readonly<Record<RareColumn, ReadonlyMap<number, string>>>
  /** Node indices whose input is checked. */
  readonly checked: ReadonlySet<number>
}

export function indexDocument(
  strings: readonly string[],
  document: DocumentSnapshot,
  props: readonly string[]
): IndexedDocument {
  const { nodes, layout, textBoxes } = document
  const rowOf: number[] = nodes.parentIndex.map(() => -1)
  layout.nodeIndex.forEach((nodeIndex, row) => {
    if (rowOf[nodeIndex] === -1) rowOf[nodeIndex] = row
  })
  const childrenOf: number[][] = nodes.parentIndex.map(() => [])
  nodes.parentIndex.forEach((parent, index) => {
    if (parent >= 0) childrenOf[parent]?.push(index)
  })
  const nodeOf = new Map<number, number>()
  nodes.backendNodeId.forEach((backendNodeId, index) => {
    if (!nodeOf.has(backendNodeId)) nodeOf.set(backendNodeId, index)
  })
  const textBoxesOf = new Map<number, (readonly number[])[]>()
  textBoxes.layoutIndex.forEach((row, index) => {
    const bounds = textBoxes.bounds[index]
    if (bounds === undefined) return
    const list = textBoxesOf.get(row)
    if (list === undefined) textBoxesOf.set(row, [bounds])
    else list.push(bounds)
  })
  return {
    strings,
    document,
    rowOf,
    childrenOf,
    textBoxesOf,
    stackingRows: new Set(layout.stackingContexts.index),
    columns: new Map(props.map((prop, index) => [prop, index])),
    nodeOf,
    rare: {
      textValue: rareValues(nodes.textValue, strings),
      inputValue: rareValues(nodes.inputValue, strings),
      pseudoType: rareValues(nodes.pseudoType, strings),
      shadowRootType: rareValues(nodes.shadowRootType, strings),
      currentSourceURL: rareValues(nodes.currentSourceURL, strings),
    },
    checked: new Set(nodes.inputChecked?.index),
  }
}

function rareValues(
  column: RareString | undefined,
  strings: readonly string[]
): Map<number, string> {
  const values = new Map<number, string>()
  if (column === undefined) return values
  column.index.forEach((nodeIndex, at) => {
    const value = strings[column.value[at] ?? -1]
    if (value !== undefined && !values.has(nodeIndex)) values.set(nodeIndex, value)
  })
  return values
}

export function attribute(
  indexed: IndexedDocument,
  nodeIndex: number,
  name: string
): string | null {
  const pairs = indexed.document.nodes.attributes[nodeIndex] ?? []
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    if (indexed.strings[pairs[i] ?? -1] !== name) continue
    const value = pairs[i + 1] ?? -1
    return value < 0 ? '' : (indexed.strings[value] ?? '') // an empty value has no string table entry
  }
  return null
}

/** Computed value of `prop` on a layout row, or null when the whitelist does not carry it. */
export function styleValue(indexed: IndexedDocument, row: number, prop: string): string | null {
  const column = indexed.columns.get(prop)
  if (column === undefined) return null
  const stringIndex = indexed.document.layout.styles[row]?.[column]
  return stringIndex === undefined ? null : (indexed.strings[stringIndex] ?? null)
}
