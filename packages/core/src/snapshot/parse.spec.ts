import { readdirSync, readFileSync } from 'node:fs'

import { WhydiffError } from '../errors.js'
import { parseSnapshot } from './parse.js'

const fixture = (name: string): string =>
  readFileSync(new URL(`../../fixtures/snapshot/${name}`, import.meta.url), 'utf8')

const invalid: Record<'schema' | 'semantic', Record<string, string>> = {
  schema: {
    'unknown-key.json': '$.extra',
    'short-box.json': '$.nodes[0].box',
    'bad-source.json': '$.tool.source',
    'missing-nodes.json': '$.nodes',
    'threshold-range.json': '$.compare.threshold',
    'stacking-false.json': '$.nodes[0].stacking',
    'sheet-without-hash.json': '$.sheets[0].hash',
    'sheet-inline-false.json': '$.sheets[0].inline',
    'rule-without-selector.json': '$.rules[0].selector',
    'rule-sheet-and-inline.json': '$.rules[0]',
    'attribution-below-minus-one.json': '$.attributions[0][0]',
    'declaration-without-prop.json': '$.declarations[1].prop',
    'uses-below-zero.json': '$.uses[0][0]',
  },
  semantic: {
    'sparse-index.json': '$.nodes[0].i',
    'parent-not-earlier.json': '$.nodes[0].p',
    'style-out-of-range.json': '$.nodes[0].s',
    'style-row-length.json': '$.styles[0]',
    'main-frame-owner.json': '$.frames[0].owner',
    'frame-out-of-range.json': '$.nodes[0].f',
    'root-out-of-range.json': '$.image.root',
    'attribution-row-length.json': '$.attributions[0]',
    'attribution-out-of-range.json': '$.nodes[0].a',
    'rule-index-out-of-range.json': '$.attributions[0][1]',
    'rule-sheet-out-of-range.json': '$.rules[0].sheet',
    'attribution-user-agent.json': '$.attributions[0][0]',
    'declaration-rule-out-of-range.json': '$.declarations[1].rule',
    'declaration-initial-without-value.json': '$.declarations[1].initial',
    'declaration-reads-later.json': '$.declarations[1].reads[0]',
    'declaration-reads-longhand.json': '$.declarations[2].reads[0]',
    'declarations-without-uses.json': '$.declarations',
    'uses-row-count.json': '$.uses',
    'uses-out-of-range.json': '$.uses[0][1]',
    'uses-props-order.json': '$.uses[0][1]',
    'uses-other-rule.json': '$.uses[0][1]',
  },
}

describe('parseSnapshot', () => {
  it('parses the minimal fixture', () => {
    const snapshot = parseSnapshot(fixture('minimal.whydiff.json'))
    expect(snapshot.formatVersion).toBe(1)
    expect(snapshot.nodes).toHaveLength(1)
    expect(snapshot.nodes[0]?.role).toBeUndefined()
    expect(snapshot.rules).toBeUndefined()
    expect(snapshot.attributions).toBeUndefined()
    expect(snapshot.declarations).toBeUndefined()
    expect(snapshot.uses).toBeUndefined()
  })

  it('parses the full fixture with every optional field', () => {
    const snapshot = parseSnapshot(fixture('full.whydiff.json'))
    expect(snapshot.tool.capturedAfterMs).toBe(12)
    expect(snapshot.image.root).toBe(1)
    expect(snapshot.sheets[1]?.harness).toBe(true)
    expect(snapshot.frames[1]?.owner).toBe(4)
    expect(snapshot.nodes[2]?.cls).toEqual(['ui-btn', 'ui-btn--large'])
    expect(snapshot.nodes[3]?.lineBoxes).toHaveLength(2)
    expect(snapshot.nodes[7]?.flags).toEqual(['pseudo:before', 'hidden'])
    expect(snapshot.rules).toEqual([
      { sheet: 0, selector: '.ui-btn', layer: 'framework-components' },
      { inline: true, selector: '' },
      { sheet: 1, selector: '.ui-btn', important: true },
      { userAgent: true, selector: 'html' },
      { sheet: 0, selector: ':root', layer: 'framework-core' },
      { sheet: 0, selector: '@property --ui-surface' },
    ])
    expect(snapshot.attributions).toEqual([
      [-1, -1, -1, -1, -1],
      [0, -1, 2, 1, 0],
    ])
    expect(snapshot.declarations?.[3]).toEqual({
      prop: '--ui-surface',
      rule: 5,
      value: 'oklch(0.7 0.2 30)',
      initial: true,
    })
    expect(snapshot.declarations?.[2]?.reads).toEqual([1])
    expect(snapshot.uses).toEqual([[0], [2, 4]])
    expect(snapshot.nodes.map((n) => n.a)).toEqual([0, undefined, 1, ...Array<undefined>(5)])
  })

  it('rejects text that is not JSON', () => {
    expect(failure(() => parseSnapshot('{')).message).toContain('not valid JSON')
  })

  it('rejects a newer format version', () => {
    expect(() => parseSnapshot('{"formatVersion":2}')).toThrow(/newer than this build/)
  })

  for (const kind of ['schema', 'semantic'] as const) {
    it(`lists every ${kind} fixture on disk`, () => {
      const onDisk = readdirSync(
        new URL(`../../fixtures/snapshot/invalid/${kind}/`, import.meta.url)
      )
      expect(onDisk.sort()).toEqual(Object.keys(invalid[kind]).sort())
    })

    it.each(Object.entries(invalid[kind]))(`rejects ${kind} fixture %s at %s`, (file, path) => {
      expect(failure(() => parseSnapshot(fixture(`invalid/${kind}/${file}`))).message).toContain(
        path
      )
    })
  }
})

function failure(run: () => unknown): WhydiffError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(WhydiffError)
    expect(error).toHaveProperty('code', 'invalid-snapshot')
    return error as WhydiffError // asserted above
  }
  throw new Error('expected parseSnapshot to throw')
}
