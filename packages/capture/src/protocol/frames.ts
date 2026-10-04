import type { CDPSession } from 'playwright-core'

/** Parent id and URL of every frame the sessions know about. */
export interface FrameTree {
  readonly parents: ReadonlyMap<string, string | null>
  readonly urls: ReadonlyMap<string, string>
}

interface ProtocolFrameTree {
  readonly frame: { readonly id: string; readonly parentId?: string; readonly url: string }
  readonly childFrames?: readonly ProtocolFrameTree[]
}

export async function readFrameTree(sessions: readonly CDPSession[]): Promise<FrameTree> {
  const parents = new Map<string, string | null>()
  const urls = new Map<string, string>()
  const visit = (tree: ProtocolFrameTree): void => {
    parents.set(tree.frame.id, tree.frame.parentId ?? null)
    urls.set(tree.frame.id, tree.frame.url)
    for (const child of tree.childFrames ?? []) visit(child)
  }
  for (const session of sessions) {
    const { frameTree } = await session.send('Page.getFrameTree')
    visit(frameTree)
  }
  return { parents, urls }
}

/** Backend node id of the iframe element that owns `frameId`, asked from the session of the parent document. */
export async function frameOwner(session: CDPSession, frameId: string): Promise<number | null> {
  try {
    const { backendNodeId } = await session.send('DOM.getFrameOwner', { frameId })
    return backendNodeId
  } catch {
    return null
  }
}
