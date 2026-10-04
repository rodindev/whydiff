import { rawSheet } from '../testing/columns.js'
import { anonymousLayers, layerNamer } from './layers.js'

describe('anonymousLayers', () => {
  it('finds blocks without a name and imports with a bare layer, in source order', () => {
    const css = [
      '@import url(reset.css) layer;',
      '@import "base.css" LAYER supports(display: grid);',
      '@import url(theme.css) layer(theme);',
      '@import url(layer.css);',
      '@layer app, theme;',
      '@layer app { .ui-a { color: red } }',
      '@layer{ .ui-b { color: red } }',
      '@media screen { @layer /* print */ { .ui-c { color: red } } }',
      '/* @layer { } */ .ui-d::before { content: "@layer { }" }',
    ].join('\n')
    expect(anonymousLayers(css)).toEqual(
      ['@import url(reset', '@import "base', '@layer{', '@layer /*'].map((at) => css.indexOf(at))
    )
  })
})

describe('layerNamer', () => {
  const at = (startLine: number, startColumn: number) => ({ startLine, startColumn })

  it('numbers an anonymous layer among those of the sheet that declares it and keeps names as written', () => {
    const name = layerNamer([
      rawSheet('s0', '@import url(base.css) layer;\n@layer {}\n@layer   {\n  @layer {}\n}'),
      rawSheet('s1', '@layer {}'),
    ])
    expect([
      name({ text: 'framework.components', styleSheetId: 's0', range: at(1, 0) }),
      name({ text: '', styleSheetId: 's0', range: at(0, 22) }),
      name({ text: '', styleSheetId: 's0', range: at(1, 7) }),
      name({ text: '', styleSheetId: 's0', range: at(2, 9) }),
      name({ text: '', styleSheetId: 's0', range: at(3, 9) }),
      name({ text: '', styleSheetId: 's1', range: at(0, 7) }),
    ]).toEqual([
      'framework.components',
      '<anonymous #1>',
      '<anonymous #2>',
      '<anonymous #3>',
      '<anonymous #4>',
      '<anonymous #1>',
    ])
  })

  it('says only <anonymous> when the browser gave no position or no text for the sheet', () => {
    const name = layerNamer([rawSheet('s0', '@layer {}'), rawSheet('routed', '')])
    expect([
      name({ text: '', styleSheetId: 's0' }),
      name({ text: '', styleSheetId: 'unknown', range: at(0, 7) }),
      name({ text: '', styleSheetId: 'routed', range: at(0, 7) }),
      name({ text: '' }),
    ]).toEqual(['<anonymous>', '<anonymous>', '<anonymous>', '<anonymous>'])
  })
})
