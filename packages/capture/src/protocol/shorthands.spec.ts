import type { CDPSession } from 'playwright-core'

import type { RuleGroup } from '../raw.js'
import { shorthands, unexpanded } from './shorthands.js'

const LONGHANDS: Readonly<Record<string, readonly string[]>> = {
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  '-webkit-transform': ['transform'],
  color: ['color'],
}

function fakeSession(fails = false): { session: CDPSession; asked: string[][] } {
  const asked: string[][] = []
  const session = {
    send(method: string, params: { arguments?: { value: string[] }[] }) {
      if (method === 'Page.getFrameTree')
        return Promise.resolve({ frameTree: { frame: { id: 'F' } } })
      if (method === 'Page.createIsolatedWorld') return Promise.resolve({ executionContextId: 7 })
      const names = params.arguments?.[0]?.value ?? []
      asked.push(names)
      if (fails) return Promise.reject(new Error('Execution context was destroyed.'))
      return Promise.resolve({ result: { value: names.map((name) => LONGHANDS[name] ?? []) } })
    },
  }
  return { session: session as unknown as CDPSession, asked } // only `send` is used
}

describe('unexpanded', () => {
  it('lists the names written in a source without longhands, sorted, custom properties and expanded shorthands left out', () => {
    const groups: RuleGroup[] = [
      {
        nodes: [1],
        matched: {
          inlineStyle: {
            cssProperties: [{ name: 'padding', value: 'var(--ui-pad)', source: true }],
          },
          matchedCSSRules: [
            {
              rule: {
                origin: 'regular',
                selectorList: { text: '.ui-a' },
                style: {
                  cssProperties: [
                    { name: '-webkit-transform', value: 'none', source: true },
                    {
                      name: 'margin',
                      value: '0',
                      source: true,
                      longhandProperties: [{ name: 'margin-top' }],
                    },
                    { name: '--ui-pad', value: '1px', source: true },
                    { name: 'transform', value: 'none' },
                  ],
                },
              },
            },
          ],
        },
      },
    ]
    expect(unexpanded([groups, null])).toEqual(['-webkit-transform', 'padding'])
  })
})

describe('shorthands', () => {
  it('asks the browser once per browser version and name, in an isolated world', async () => {
    const { session, asked } = fakeSession()
    expect(await shorthands(session, 'probes-once', ['color', 'padding'])).toEqual(
      new Map([
        ['color', ['color']],
        ['padding', LONGHANDS.padding],
      ])
    )
    expect(await shorthands(session, 'probes-once', ['-webkit-transform', 'padding'])).toEqual(
      new Map([
        ['-webkit-transform', ['transform']],
        ['padding', LONGHANDS.padding],
      ])
    )
    expect(asked).toEqual([['color', 'padding'], ['-webkit-transform']])
  })

  it('answers without the names a failed probe left out, and asks for them again next time', async () => {
    const failing = fakeSession(true)
    expect(await shorthands(failing.session, 'fails-once', ['padding'])).toEqual(new Map())
    const working = fakeSession()
    expect(await shorthands(working.session, 'fails-once', ['padding'])).toEqual(
      new Map([['padding', LONGHANDS.padding]])
    )
    expect(working.asked).toEqual([['padding']])
  })
})
