import { readFileSync } from 'node:fs'
import fc from 'fast-check'

import { parseSnapshot } from './parse.js'
import { serializeSnapshot } from './serialize.js'
import type { DeclarationV1, FrameV1, NodeV1, Rect, RuleV1, SheetV1, SnapshotV1 } from './types.js'

const fixture = (name: string): string =>
  readFileSync(new URL(`../../fixtures/snapshot/${name}`, import.meta.url), 'utf8')

describe('serializeSnapshot', () => {
  it.each(['minimal', 'full'])('writes the %s fixture back byte for byte', (name) => {
    const text = fixture(`${name}.whydiff.json`)
    expect(serializeSnapshot(parseSnapshot(text))).toBe(text)
  })

  it('does not depend on the construction order of keys', () => {
    const snapshot = parseSnapshot(fixture('full.whydiff.json'))
    const reversed = Object.fromEntries(Object.entries(snapshot).reverse()) as SnapshotV1 // same keys, reversed order
    expect(serializeSnapshot(reversed)).toBe(serializeSnapshot(snapshot))
  })

  it('round-trips generated snapshots and is idempotent', () => {
    fc.assert(
      fc.property(snapshotArbitrary(), (snapshot) => {
        const text = serializeSnapshot(snapshot)
        const parsed = parseSnapshot(text)
        expect(parsed).toEqual(snapshot)
        expect(serializeSnapshot(parsed)).toBe(text)
      })
    )
  })
})

const px = fc.integer({ min: -32_000, max: 192_000 }).map((n) => n / 64)
const size = fc.integer({ min: 0, max: 192_000 }).map((n) => n / 64)
const rect: fc.Arbitrary<Rect> = fc.tuple(px, px, size, size)
const point = fc.tuple(px, px)
const word = fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/)
const text = fc.string({ maxLength: 20 })

function nodeArbitrary(
  index: number,
  styleCount: number,
  frameCount: number,
  rowCount: number
): fc.Arbitrary<NodeV1> {
  return fc.record(
    {
      i: fc.constant(index),
      p: fc.integer({ min: -1, max: index - 1 }),
      f: fc.integer({ min: 0, max: frameCount - 1 }),
      tag: word,
      role: word,
      name: text,
      id: word,
      testId: word,
      cls: fc.array(word, { maxLength: 3 }),
      text,
      value: text,
      checked: fc.boolean(),
      box: rect,
      lineBoxes: fc.array(rect, { minLength: 1, maxLength: 3 }),
      scroll: rect,
      img: word,
      s: fc.integer({ min: 0, max: styleCount - 1 }),
      a: fc.integer({ min: 0, max: rowCount - 1 }),
      layer: fc.nat({ max: 9 }),
      stacking: fc.constant(true),
      font: word,
      src: text,
      flags: fc.uniqueArray(fc.constantFrom('clipped', 'hidden', 'shadow:open'), { maxLength: 2 }),
    },
    { requiredKeys: ['i', 'p', 'tag', 'box', 's'] }
  )
}

// custom properties only, so the uses rows can stay empty and every row still validates
function declarationArbitrary(index: number, ruleCount: number): fc.Arbitrary<DeclarationV1> {
  return fc
    .record(
      {
        prop: word.map((name) => `--${name}`),
        rule: fc.integer({ min: 0, max: ruleCount - 1 }),
        value: text,
        initial: fc.constant(true),
        inherited: fc.constant(true),
        reads:
          index === 0
            ? fc.constant([])
            : fc.uniqueArray(fc.nat({ max: index - 1 }), { maxLength: 2 }),
      },
      { requiredKeys: ['prop'] }
    )
    .filter((entry) => entry.initial === undefined || entry.value !== undefined)
}

function snapshotArbitrary(): fc.Arbitrary<SnapshotV1> {
  return fc
    .record({
      props: fc.uniqueArray(word, { minLength: 1, maxLength: 4 }),
      styleCount: fc.integer({ min: 1, max: 4 }),
      nodeCount: fc.integer({ min: 1, max: 8 }),
      frameCount: fc.integer({ min: 1, max: 2 }),
      sheetCount: fc.integer({ min: 1, max: 2 }),
      ruleCount: fc.integer({ min: 1, max: 3 }),
      rowCount: fc.integer({ min: 1, max: 3 }),
      declarationCount: fc.integer({ min: 1, max: 3 }),
    })
    .chain((counts) => {
      const { props, styleCount, nodeCount, frameCount, sheetCount, ruleCount, rowCount } = counts
      const row = fc.array(text, { minLength: props.length, maxLength: props.length })
      const mainFrame: fc.Arbitrary<FrameV1> = fc.record({
        url: text,
        owner: fc.constant(null),
        offset: point,
        scroll: point,
        status: fc.constantFrom('captured', 'skipped', 'approximate'),
      })
      const childFrame: fc.Arbitrary<FrameV1> = fc.record({
        url: text,
        owner: fc.integer({ min: 0, max: nodeCount - 1 }),
        offset: point,
        scroll: point,
        status: fc.constantFrom('captured', 'skipped', 'approximate'),
      })
      const frames = frameCount === 1 ? fc.tuple(mainFrame) : fc.tuple(mainFrame, childFrame)
      const sheet: fc.Arbitrary<SheetV1> = fc.record(
        {
          href: text,
          inline: fc.constant(true),
          hash: word,
          harness: fc.constant(true),
        },
        { requiredKeys: ['hash'] }
      )
      const sheetRule: fc.Arbitrary<RuleV1> = fc.record(
        {
          sheet: fc.integer({ min: 0, max: sheetCount - 1 }),
          selector: text,
          layer: word,
          important: fc.constant(true),
        },
        { requiredKeys: ['sheet', 'selector'] }
      )
      const inlineRule: fc.Arbitrary<RuleV1> = fc.record(
        { inline: fc.constant(true), selector: fc.constant(''), important: fc.constant(true) },
        { requiredKeys: ['inline', 'selector'] }
      )
      const rules = fc.array(fc.oneof(sheetRule, inlineRule), {
        minLength: ruleCount,
        maxLength: ruleCount,
      })
      const attributions = fc.array(
        fc.array(fc.integer({ min: -1, max: ruleCount - 1 }), {
          minLength: props.length,
          maxLength: props.length,
        }),
        { minLength: rowCount, maxLength: rowCount }
      )
      const declarations = fc.tuple(
        ...Array.from({ length: counts.declarationCount }, (_, i) =>
          declarationArbitrary(i, ruleCount)
        )
      )
      const nodes = fc.tuple(
        ...Array.from({ length: nodeCount }, (_, i) =>
          nodeArbitrary(i, styleCount, frameCount, rowCount)
        )
      )
      return fc.record({
        formatVersion: fc.constant(1 as const),
        tool: fc.record(
          {
            name: fc.constant('whydiff' as const),
            version: word,
            source: fc.constant('cdp' as const),
            browser: text,
            capturedAfterMs: fc.nat({ max: 5000 }),
          },
          { requiredKeys: ['name', 'version', 'source', 'browser'] }
        ),
        page: fc.record({ url: text, title: text }),
        image: fc.record(
          {
            width: fc.nat({ max: 4000 }),
            height: fc.nat({ max: 20_000 }),
            k: fc.constantFrom(1, 2),
            layoutFactor: fc.constantFrom(1, 2),
            origin: point,
            fullPage: fc.boolean(),
            root: fc.integer({ min: 0, max: nodeCount - 1 }),
          },
          { requiredKeys: ['width', 'height', 'k', 'layoutFactor', 'origin', 'fullPage'] }
        ),
        viewport: fc.record({ width: size, height: size, scrollX: px, scrollY: px }),
        content: fc.record({ width: size, height: size }),
        compare: fc.record(
          {
            threshold: fc.constantFrom(0, 0.2, 0.35, 1),
            maxDiffPixels: fc.nat({ max: 100 }),
            maxDiffPixelRatio: fc.constantFrom(0.001, 0.01),
            animations: fc.constantFrom('disabled', 'allow'),
            caret: fc.constantFrom('hide', 'initial'),
            scale: fc.constantFrom('css', 'device'),
          },
          { requiredKeys: ['threshold', 'animations', 'caret', 'scale'] }
        ),
        frames,
        masks: fc.array(rect, { maxLength: 2 }),
        sheets: fc.array(sheet, { minLength: sheetCount, maxLength: sheetCount }),
        props: fc.constant(props),
        styles: fc.array(row, { minLength: styleCount, maxLength: styleCount }),
        rules,
        attributions,
        declarations,
        uses: fc.constant(Array.from({ length: rowCount }, (): number[] => [])),
        nodes,
      })
    })
}
