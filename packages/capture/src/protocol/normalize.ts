import type { DocumentSnapshot, LayoutTree, NodeTree, TextBoxes } from '../raw.js'

type Optional<T> = { readonly [K in keyof T]?: T[K] }

interface ProtocolDocument {
  readonly documentURL: number
  readonly frameId: number
  readonly nodes: Optional<NodeTree>
  readonly layout: LayoutTree
  readonly textBoxes: TextBoxes
  readonly scrollOffsetX?: number
  readonly scrollOffsetY?: number
  readonly contentWidth?: number
  readonly contentHeight?: number
}

/** The protocol declares every node column optional; a document always carries them, so fill the gaps once here. */
export function normalizeDocument(document: ProtocolDocument): DocumentSnapshot {
  const { nodes } = document
  const columns: NodeTree = {
    parentIndex: nodes.parentIndex ?? [],
    nodeType: nodes.nodeType ?? [],
    nodeName: nodes.nodeName ?? [],
    nodeValue: nodes.nodeValue ?? [],
    backendNodeId: nodes.backendNodeId ?? [],
    attributes: nodes.attributes ?? [],
  }
  return {
    documentURL: document.documentURL,
    frameId: document.frameId,
    nodes: {
      ...columns,
      ...(nodes.textValue && { textValue: nodes.textValue }),
      ...(nodes.inputValue && { inputValue: nodes.inputValue }),
      ...(nodes.inputChecked && { inputChecked: nodes.inputChecked }),
      ...(nodes.pseudoType && { pseudoType: nodes.pseudoType }),
      ...(nodes.shadowRootType && { shadowRootType: nodes.shadowRootType }),
      ...(nodes.currentSourceURL && { currentSourceURL: nodes.currentSourceURL }),
    },
    layout: document.layout,
    textBoxes: document.textBoxes,
    scrollOffsetX: document.scrollOffsetX ?? 0,
    scrollOffsetY: document.scrollOffsetY ?? 0,
    contentWidth: document.contentWidth ?? 0,
    contentHeight: document.contentHeight ?? 0,
  }
}
