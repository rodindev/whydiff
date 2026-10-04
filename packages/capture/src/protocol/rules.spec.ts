import type { CDPSession } from 'playwright-core'

import { RULE_GROUP_LIMIT } from '../constants.js'
import { main } from '../testing/columns.js'
import { readRuleGroups, ruleGroups, trimmer, type Grouping } from './rules.js'

const BOX = [0, 0, 100, 20] as const

describe('ruleGroups', () => {
  it('groups laid-out elements by style row, tag, normalized classes, id and pseudo type, in document order', () => {
    const { strings, document } = main([
      { tag: 'html', parent: 0, box: BOX },
      { tag: 'div', parent: 1, box: BOX, attrs: { class: 'b a' } },
      { tag: 'div', parent: 1, box: BOX, attrs: { class: ' a  b a' } },
      { tag: 'div', parent: 1, box: BOX, attrs: { class: 'a b', id: 'x' } },
      { tag: 'span', parent: 1, box: BOX, attrs: { class: 'a b' } },
      { tag: 'div', parent: 1, box: BOX, attrs: { class: 'a b' }, style: { display: 'flex' } },
      { tag: 'div', parent: 1, attrs: { class: 'a b' } },
      { tag: '#text', parent: 2, box: BOX, text: 'text' },
      { tag: '::before', parent: 2, box: [0, 0, 0, 0], pseudo: 'before' },
      { tag: '::first-letter', parent: 2, box: [0, 0, 0, 0], pseudo: 'first-letter' },
      { tag: '::before', parent: 3, box: [0, 0, 0, 0], pseudo: 'before' },
    ])
    expect(ruleGroups(document, strings)).toEqual([
      { nodes: [1], backendNodeId: 101 },
      { nodes: [2, 3], backendNodeId: 102 },
      { nodes: [4], backendNodeId: 104 },
      { nodes: [5], backendNodeId: 105 },
      { nodes: [6], backendNodeId: 106 },
      { nodes: [9, 11], backendNodeId: 109 },
    ])
  })
})

interface Fake {
  readonly session: CDPSession
  readonly pushed: number[][]
  readonly asked: number[]
  readonly state: { inFlight: number; mostInFlight: number }
}

function fakeSession(refused: readonly number[] = []): Fake {
  const pushed: number[][] = []
  const asked: number[] = []
  const state = { inFlight: 0, mostInFlight: 0 }
  const session = {
    send(method: string, params: { backendNodeIds?: number[]; nodeId?: number }) {
      if (method === 'DOM.pushNodesByBackendIdsToFrontend') {
        const ids = params.backendNodeIds ?? []
        pushed.push(ids)
        return Promise.resolve({ nodeIds: ids.map((id) => id + 1000) })
      }
      const nodeId = params.nodeId ?? -1
      asked.push(nodeId)
      state.inFlight++
      state.mostInFlight = Math.max(state.mostInFlight, state.inFlight)
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          state.inFlight--
          if (refused.includes(nodeId)) reject(new Error('No node with given id found'))
          else
            resolve({
              inlineStyle: { cssProperties: [{ name: '--ui-node', value: String(nodeId) }] },
            })
        }, 0)
      })
    },
  }
  return { session: session as unknown as CDPSession, pushed, asked, state } // only `send` is used
}

const groups = (count: number, first = 0): Grouping[] =>
  Array.from({ length: count }, (_, i) => ({ nodes: [first + i], backendNodeId: 100 + first + i }))

describe('readRuleGroups', () => {
  it('asks once per group representative with every call in flight at once, and keeps the group order', async () => {
    const fake = fakeSession()
    const [first] = await readRuleGroups([
      { session: fake.session, groups: [{ nodes: [1, 3], backendNodeId: 101 }, ...groups(2, 4)] },
    ])
    expect(fake.pushed).toEqual([[101, 104, 105]])
    expect(fake.asked).toEqual([1101, 1104, 1105])
    expect(fake.state.mostInFlight).toBe(3)
    expect(
      first?.map((group) => [group.nodes, group.matched.inlineStyle?.cssProperties[0]?.value])
    ).toEqual([
      [[1, 3], '1101'],
      [[4], '1104'],
      [[5], '1105'],
    ])
  })

  it('answers with no rules for a node the browser refuses', async () => {
    const fake = fakeSession([1101])
    const [first] = await readRuleGroups([{ session: fake.session, groups: groups(2, 1) }])
    expect(first?.map((group) => group.matched)).toEqual([
      {},
      {
        matchedCSSRules: [],
        inlineStyle: { cssProperties: [{ name: '--ui-node', value: '1102' }] },
      },
    ])
  })

  it('records nothing for any document once the groups of the capture exceed the budget', async () => {
    const page = fakeSession()
    const frame = fakeSession()
    const over = await readRuleGroups([
      { session: page.session, groups: groups(RULE_GROUP_LIMIT) },
      { session: frame.session, groups: groups(1) },
    ])
    expect(over).toEqual([null, null])
    expect(page.asked).toEqual([])
    expect(frame.asked).toEqual([])
    const within = await readRuleGroups([
      { session: page.session, groups: groups(RULE_GROUP_LIMIT - 1) },
      { session: frame.session, groups: groups(1) },
    ])
    expect(within.map((document) => document?.length)).toEqual([RULE_GROUP_LIMIT - 1, 1])
  })

  it('does nothing for a document without groups', async () => {
    const fake = fakeSession()
    expect(await readRuleGroups([{ session: fake.session, groups: [] }])).toEqual([[]])
    expect(fake.pushed).toEqual([])
  })
})

describe('trimmer', () => {
  type Answer = Parameters<ReturnType<typeof trimmer>>[0]
  const range = (startLine: number) => ({
    startLine,
    startColumn: 0,
    endLine: startLine,
    endColumn: 20,
  })
  // a protocol answer carries more than the trimmer reads, such as pseudo elements
  const answer = (selector: string, matchingSelectors: number[] = [0]): Answer => {
    const full = {
      inlineStyle: { cssProperties: [] },
      matchedCSSRules: [
        {
          rule: {
            origin: 'user-agent',
            selectorList: {
              text: 'input, textarea, button',
              selectors: [{ text: 'input' }, { text: 'textarea' }, { text: 'button' }],
            },
            style: { cssProperties: [{ name: 'display', value: 'inline-block' }] },
          },
          matchingSelectors,
        },
        {
          rule: {
            styleSheetId: 's0',
            origin: 'regular',
            selectorList: { text: selector, selectors: [{ text: selector }] },
            layers: [{ text: 'base', styleSheetId: 's0', range: range(0) }],
            style: {
              styleSheetId: 's0',
              range: range(1),
              cssProperties: [
                {
                  name: 'padding',
                  value: '1px',
                  range: range(1),
                  longhandProperties: [{ name: 'padding-top', value: '1px' }],
                },
                { name: 'padding-top', value: '1px' },
              ],
            },
          },
          matchingSelectors: [0],
        },
        {
          rule: {
            origin: 'injected',
            selectorList: { text: '.ad', selectors: [{ text: '.ad' }] },
            style: { cssProperties: [{ name: 'display', value: 'none' }] },
          },
          matchingSelectors: [0],
        },
      ],
      pseudoElements: [{ pseudoType: 'before', matches: [] }],
      inherited: [
        {
          matchedCSSRules: [
            {
              rule: {
                styleSheetId: 's0',
                origin: 'regular',
                selectorList: { text: ':root', selectors: [{ text: ':root' }] },
                style: {
                  styleSheetId: 's0',
                  range: range(2),
                  cssProperties: [
                    { name: '--ui-ink', value: 'red', range: range(2) },
                    { name: 'color', value: 'blue', range: range(2) },
                    { name: '--ui-ink', value: 'red' },
                  ],
                },
              },
              matchingSelectors: [0],
            },
            {
              rule: {
                styleSheetId: 's0',
                origin: 'regular',
                selectorList: { text: 'body', selectors: [{ text: 'body' }] },
                style: { cssProperties: [{ name: 'margin', value: '0', range: range(3) }] },
              },
              matchingSelectors: [0],
            },
          ],
        },
      ],
      cssPropertyRules: [
        {
          styleSheetId: 's0',
          origin: 'regular',
          propertyName: { text: '--ui-tint' },
          style: {
            cssProperties: [
              { name: 'syntax', value: "'*'", range: range(4) },
              { name: 'inherits', value: 'false', range: range(4) },
              { name: 'syntax', value: '"*"' },
              { name: 'inherits', value: 'false' },
            ],
          },
        },
      ],
    }
    return full
  }

  it('keeps what the assembler reads: the matched selectors of a browser rule, source flags, custom properties of ancestors', () => {
    expect(trimmer()(answer('.ui-a', [2]))).toEqual({
      inlineStyle: { cssProperties: [] },
      matchedCSSRules: [
        {
          rule: {
            origin: 'user-agent',
            selectorList: { text: 'button' },
            style: { cssProperties: [{ name: 'display', value: 'inline-block' }] },
          },
        },
        {
          rule: {
            styleSheetId: 's0',
            origin: 'regular',
            selectorList: { text: '.ui-a' },
            layers: [{ text: 'base', styleSheetId: 's0', range: { startLine: 0, startColumn: 0 } }],
            style: {
              cssProperties: [
                {
                  name: 'padding',
                  value: '1px',
                  source: true,
                  longhandProperties: [{ name: 'padding-top' }],
                },
                { name: 'padding-top', value: '1px' },
              ],
            },
          },
        },
      ],
      inherited: [
        {
          matchedCSSRules: [
            {
              rule: {
                styleSheetId: 's0',
                origin: 'regular',
                selectorList: { text: ':root' },
                style: { cssProperties: [{ name: '--ui-ink', value: 'red', source: true }] },
              },
            },
          ],
        },
      ],
      cssPropertyRules: [
        {
          styleSheetId: 's0',
          propertyName: { text: '--ui-tint' },
          style: { cssProperties: [{ name: 'inherits', value: 'false', source: true }] },
        },
      ],
    })
  })

  it('shares the kept declarations of one style source between the answers of a document', () => {
    const trim = trimmer()
    const [a, b] = [trim(answer('.ui-a')), trim(answer('.ui-a'))]
    expect(b.matchedCSSRules?.[1]?.rule.style).toBe(a.matchedCSSRules?.[1]?.rule.style)
    expect(b.inherited?.[0]?.matchedCSSRules[0]?.rule.style).toBe(
      a.inherited?.[0]?.matchedCSSRules[0]?.rule.style
    )
    expect(b.matchedCSSRules?.[0]?.rule.style).not.toBe(a.matchedCSSRules?.[0]?.rule.style)
    expect(trimmer()(answer('.ui-a')).matchedCSSRules?.[1]?.rule.style).not.toBe(
      a.matchedCSSRules?.[1]?.rule.style
    )
  })
})
