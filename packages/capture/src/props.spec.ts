import type { CDPSession } from 'playwright-core'

import { acceptedProps, RULE_PROPS, STYLE_PROPS } from './props.js'

function fakeSession(rejected: readonly string[]): {
  session: CDPSession
  state: { calls: number }
} {
  const state = { calls: 0 }
  const session = {
    send(method: string, params: { computedStyles: string[] }) {
      state.calls++
      const bad = params.computedStyles.find((name) => rejected.includes(name))
      return bad === undefined
        ? Promise.resolve({})
        : Promise.reject(new Error(`Protocol error (${method}): invalid CSS property name: ${bad}`))
    },
  }
  return { session: session as unknown as CDPSession, state } // only `send` is used
}

describe('STYLE_PROPS', () => {
  it('records the longhands that change what an element paints', () => {
    expect(STYLE_PROPS).toEqual(
      expect.arrayContaining([
        'mask-image',
        'clip-path',
        'filter',
        'backdrop-filter',
        'text-shadow',
        'mix-blend-mode',
        'outline-style',
        'outline-offset',
      ])
    )
  })

  it('records the individual transforms and only reads the writing mode, which maps flow-relative declarations', () => {
    expect(STYLE_PROPS).toEqual(
      expect.arrayContaining(['transform', 'translate', 'rotate', 'scale'])
    )
    expect(STYLE_PROPS).not.toContain('writing-mode')
    expect(RULE_PROPS).toContain('writing-mode')
  })

  it('shares no name with RULE_PROPS, so the browser is asked for each longhand once', () => {
    expect(RULE_PROPS.filter((name) => STYLE_PROPS.includes(name))).toEqual([])
  })
})

describe('acceptedProps', () => {
  it('returns the whole whitelist and the rule props when the browser accepts them, with one probe', async () => {
    const { session, state } = fakeSession([])
    expect(await acceptedProps(session, 'accepts-all')).toEqual({
      props: STYLE_PROPS,
      ruleProps: RULE_PROPS,
    })
    expect(state.calls).toBe(1)
  })

  it('bisects out the names the browser rejects and keeps the order', async () => {
    const { session } = fakeSession(['contain', 'flex-basis', 'container-type'])
    const { props, ruleProps } = await acceptedProps(session, 'rejects-three')
    expect(props).toEqual(STYLE_PROPS.filter((name) => name !== 'contain' && name !== 'flex-basis'))
    expect(ruleProps).toEqual(RULE_PROPS.filter((name) => name !== 'container-type'))
  })

  it('probes once per browser version', async () => {
    const { session, state } = fakeSession([])
    await acceptedProps(session, 'cached')
    await acceptedProps(session, 'cached')
    expect(state.calls).toBe(1)
  })

  it('rethrows errors that are not about property names and does not cache them', async () => {
    const session = {
      send: () => Promise.reject(new Error('Target closed')),
    } as unknown as CDPSession // only `send` is used
    await expect(acceptedProps(session, 'broken')).rejects.toThrow('Target closed')
    await expect(acceptedProps(session, 'broken')).rejects.toThrow('Target closed')
  })
})
