import type { CDPSession } from 'playwright-core'

import { FONT_SAMPLE_PROPS } from '../constants.js'
import type { DocumentSnapshot } from '../raw.js'

const TEXT_NODE = 3

/** One backend node id per distinct (family, weight, style) tuple among elements that render text. */
export function fontSamples(
  document: DocumentSnapshot,
  props: readonly string[]
): readonly number[] {
  const columns = FONT_SAMPLE_PROPS.map((prop) => props.indexOf(prop))
  if (columns.some((column) => column < 0)) return []
  const { nodes, layout } = document
  const hasText = new Set<number>()
  layout.nodeIndex.forEach((nodeIndex, row) => {
    if (nodes.nodeType[nodeIndex] === TEXT_NODE && layout.text[row] !== undefined) {
      hasText.add(nodes.parentIndex[nodeIndex] ?? -1)
    }
  })
  const samples = new Map<string, number>()
  layout.nodeIndex.forEach((nodeIndex, row) => {
    if (!hasText.has(nodeIndex)) return
    const style = layout.styles[row] ?? []
    const key = columns.map((column) => style[column]).join(',')
    const backendNodeId = nodes.backendNodeId[nodeIndex]
    if (!samples.has(key) && backendNodeId !== undefined) samples.set(key, backendNodeId)
  })
  return [...samples.values()]
}

/** Platform font actually used by each sampled node, by backend node id. */
export async function readFonts(
  session: CDPSession,
  backendNodeIds: readonly number[]
): Promise<Map<number, string>> {
  const fonts = new Map<number, string>()
  if (backendNodeIds.length === 0) return fonts
  const { nodeIds } = await session.send('DOM.pushNodesByBackendIdsToFrontend', {
    backendNodeIds: [...backendNodeIds],
  })
  const results = await Promise.all(
    nodeIds.map((nodeId) => session.send('CSS.getPlatformFontsForNode', { nodeId }))
  )
  results.forEach((result, index) => {
    const backendNodeId = backendNodeIds[index]
    const font = result.fonts.reduce<{ name: string; glyphs: number } | null>(
      (best, entry) =>
        best === null || entry.glyphCount > best.glyphs
          ? { name: entry.postScriptName, glyphs: entry.glyphCount }
          : best,
      null
    )
    if (backendNodeId !== undefined && font !== null) fonts.set(backendNodeId, font.name)
  })
  return fonts
}
