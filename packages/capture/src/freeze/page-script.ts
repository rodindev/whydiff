/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

export interface FreezeArgs {
  readonly style: string
  readonly hideCaret: boolean
  readonly stopAnimations: boolean
  readonly freezeAttribute: string
}

export interface RestoreArgs {
  readonly freezeAttribute: string
  readonly rootAttribute: string
  readonly maskAttribute: string
}

interface FreezeState {
  readonly cancelled: readonly Animation[]
}

/** Runs inside the page: injects the screenshot CSS, hides the caret and stops animations like Playwright does. */
export function freezeInPage(args: FreezeArgs): void {
  const caretRule = '\n*, *::before, *::after { caret-color: transparent !important; }'
  const style = document.createElement('style')
  style.setAttribute(args.freezeAttribute, '')
  style.textContent = args.style + (args.hideCaret ? caretRule : '')
  document.documentElement.append(style)

  const cancelled: Animation[] = []
  if (args.stopAnimations) {
    const roots: (Document | ShadowRoot)[] = [document]
    for (const root of roots) {
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) roots.push(element.shadowRoot)
      }
    }
    const seen = new Set<Animation>()
    for (const root of roots) {
      const scope = root instanceof Document ? [root.documentElement] : [...root.children]
      for (const element of scope) {
        for (const animation of element.getAnimations({ subtree: true })) seen.add(animation)
      }
    }
    for (const animation of seen) {
      if (!animation.effect || animation.playbackRate === 0) continue
      const endTime = animation.effect.getComputedTiming().endTime
      try {
        if (Number.isFinite(endTime)) {
          animation.finish()
        } else {
          animation.cancel()
          cancelled.push(animation)
        }
      } catch {
        // an animation whose target was removed throws; it cannot paint either way
      }
    }
  }
  const state: FreezeState = { cancelled }
  Object.defineProperty(window, Symbol.for('whydiff.freeze'), { value: state, configurable: true })
}

/** Runs inside the page: removes what the freeze added and resumes the animations it cancelled. */
export function restoreInPage(args: RestoreArgs): void {
  for (const style of document.querySelectorAll(`style[${args.freezeAttribute}]`)) style.remove()
  // locators reach into open shadow roots, so the marks can be there too
  const roots: (Document | ShadowRoot)[] = [document]
  for (const root of roots) {
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) roots.push(element.shadowRoot)
      element.removeAttribute(args.rootAttribute)
      element.removeAttribute(args.maskAttribute)
    }
  }
  const key = Symbol.for('whydiff.freeze')
  const state: unknown = Object.getOwnPropertyDescriptor(window, key)?.value
  if (typeof state === 'object' && state !== null && 'cancelled' in state) {
    const cancelled: unknown = state.cancelled
    if (Array.isArray(cancelled)) {
      for (const animation of cancelled) {
        if (animation instanceof Animation) animation.play()
      }
    }
    Reflect.deleteProperty(window, key)
  }
}
