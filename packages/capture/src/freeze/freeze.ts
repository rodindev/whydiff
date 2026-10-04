import type { CDPSession, Locator } from 'playwright-core'
import { WhydiffError } from '@whydiff/core'

import {
  FRAME_SCRIPT_TIMEOUT_MS,
  FREEZE_ATTRIBUTE,
  MASK_ATTRIBUTE,
  ROOT_ATTRIBUTE,
} from '../constants.js'
import type { ResolvedOptions } from '../options.js'
import { freezeInPage, restoreInPage } from './page-script.js'

interface ContextCreated {
  readonly context: { readonly id: number; readonly auxData?: { readonly isDefault?: unknown } }
}

interface World {
  readonly session: CDPSession
  readonly contextId: number
}

/** Puts every frame in the state the screenshot saw and returns the function that undoes it. */
export async function freeze(
  sessions: readonly CDPSession[],
  options: ResolvedOptions
): Promise<() => Promise<void>> {
  const worlds = await mainWorlds(sessions)
  const restore = async (): Promise<void> => {
    await inEveryWorld(worlds, restoreInPage, {
      freezeAttribute: FREEZE_ATTRIBUTE,
      rootAttribute: ROOT_ATTRIBUTE,
      maskAttribute: MASK_ATTRIBUTE,
    })
  }
  try {
    // Playwright's order: the element before the page is prepared, the masks after
    if (options.root !== null) await markRoot(options.root)
    await inEveryWorld(worlds, freezeInPage, {
      style: options.style,
      hideCaret: options.caret === 'hide',
      stopAnimations: options.animations === 'disabled',
      freezeAttribute: FREEZE_ATTRIBUTE,
    })
    for (const mask of options.mask) {
      await mask.evaluateAll((elements, attribute) => {
        for (const element of elements) element.setAttribute(attribute, '')
      }, MASK_ATTRIBUTE)
    }
  } catch (error) {
    await restore()
    throw error
  }
  return restore
}

// `evaluateAll` reads the page once and never waits; `evaluate` waits for an element up to
// `actionTimeout`, by default until the test times out.
async function markRoot(root: Locator): Promise<void> {
  const count = await root.evaluateAll((elements, attribute) => {
    if (elements.length === 1) elements[0]?.setAttribute(attribute, '')
    return elements.length
  }, ROOT_ATTRIBUTE)
  if (count === 1) return
  const matches =
    count === 0
      ? 'matches no element, and whydiff does not wait for one'
      : `matches ${String(count)} elements, and whydiff captures one`
  throw new WhydiffError(
    'capture-failed',
    `${root.toString()} ${matches}. Make it match the one element the screenshot shows.`
  )
}

// a frame without a main world, like a lazy iframe that never loaded, cannot answer: skip it
async function mainWorlds(sessions: readonly CDPSession[]): Promise<World[]> {
  const worlds: World[] = []
  for (const session of sessions) {
    const onCreated = ({ context }: ContextCreated): void => {
      if (context.auxData?.isDefault === true) worlds.push({ session, contextId: context.id })
    }
    session.on('Runtime.executionContextCreated', onCreated)
    try {
      await session.send('Runtime.enable')
    } finally {
      session.off('Runtime.executionContextCreated', onCreated)
    }
    await session.send('Runtime.disable')
  }
  return worlds
}

async function inEveryWorld<T>(
  worlds: readonly World[],
  script: (args: T) => void,
  args: T
): Promise<void> {
  const functionDeclaration = script.toString()
  await Promise.all(
    worlds.map(({ session, contextId }) =>
      settle(
        session.send('Runtime.callFunctionOn', {
          functionDeclaration,
          executionContextId: contextId,
          arguments: [{ value: args }],
        })
      )
    )
  )
}

async function settle(work: Promise<unknown>): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, FRAME_SCRIPT_TIMEOUT_MS)
  })
  try {
    await Promise.race([work, timeout])
  } catch {
    // a frame that navigated away or was detached is left as it is
  } finally {
    clearTimeout(timer)
  }
}
