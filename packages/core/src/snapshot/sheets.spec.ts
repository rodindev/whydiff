import { buildSnapshot } from '../testing/snapshots.js'
import { sheetName } from './sheets.js'

const named = (href: string): string =>
  sheetName(buildSnapshot([{ tag: 'div' }], { sheets: [{ href, hash: 'h1' }] }), 0)

const together = (...hrefs: string[]): string[] => {
  const snapshot = buildSnapshot([{ tag: 'div' }], {
    sheets: hrefs.map((href, i) => ({ href: `http://app.test${href}`, hash: `h${String(i)}` })),
  })
  return hrefs.map((_, i) => sheetName(snapshot, i))
}

describe('sheetName', () => {
  it.each([
    ['vite', '/assets/index-DNgj_66d.css', 'index-*.css'],
    ['vite with a dashed name', '/assets/vendor-grid-D79WzvNx.css', 'vendor-grid-*.css'],
    ['vite with a dash in the hash', '/assets/vendor-grid-D7-WzvNx.css', 'vendor-grid-*.css'],
    ['vite with a leading dash in the hash', '/assets/index--Ngj_66d.css', 'index-*.css'],
    ['vite 4 in hex', '/assets/index-ef980167.css', 'index-*.css'],
    ['react router', '/assets/root-AE-gBz9I.css', 'root-*.css'],
    ['sveltekit', '/_app/immutable/assets/_layout.DHzLV-Oq.css', '_layout.*.css'],
    ['sveltekit for a numbered node', '/_app/immutable/assets/0.Be5pTVV_.css', '0.*.css'],
    ['nuxt', '/_nuxt/entry.B203oo-1.css', 'entry.*.css'],
    ['astro', '/_astro/index.DAV0zVuo.css', 'index.*.css'],
    ['webpack', '/static/css/main.3f9a2c1b.css', 'main.*.css'],
    ['webpack chunk', '/static/css/723.a1b2c3d4e5f6a7b8c9d0.css', '723.*.css'],
    ['webpack hash of digits only', '/static/css/main.40712386.css', 'main.*.css'],
    ['create react app chunk', '/static/css/787.cb2c2d6a.chunk.css', '787.*.chunk.css'],
    ['minified bundle', '/css/styles.3f9a2c1b.min.css', 'styles.*.min.css'],
    ['hugo minified bundle', '/css/main.min.' + 'ab12'.repeat(16) + '.css', 'main.min.*.css'],
    ['parcel', '/dist/index.447d3ccb.css', 'index.*.css'],
    ['next.js', '/_next/static/css/44d83526643d7f06.css', '*.css'],
    ['esbuild', '/out/entry-5XWHNDYC.css', 'entry-*.css'],
    ['angular', '/styles-5INURTSO.css', 'styles-*.css'],
    ['propshaft', '/assets/application-2242cc06.css', 'application-*.css'],
    [
      'sprockets sha-256 digest',
      '/assets/application-' + 'e3b0'.repeat(16) + '.css',
      'application-*.css',
    ],
    ['a hash as the whole name', '/a1b2c3d4e5f6.css', '*.css'],
  ])('reads the %s hash as *', (_, path, expected) => {
    expect(named(`http://app.test${path}?v=3#top`)).toBe(expected)
  })

  it.each([
    ['a plain name', '/app.css'],
    ['a lowercase word', '/assets/vendor-buttons.css'],
    ['a short segment', '/assets/theme-v2.css'],
    ['a lowercase word with a digit', '/assets/theme-dark12.css'],
    ['a font subset', '/fonts/fonts-latin1.css'],
    ['lowercase words with digits across a dash', '/assets/theme-v2-dark1.css'],
    ['a minified library', '/vendor/widgets.min.css'],
    ['a segment over 64 characters', '/assets/app-' + 'ab12'.repeat(16) + 'a.css'],
    ['another extension', '/assets/index-DNgj_66d.js'],
    ['a capitalized whole name', '/styles/Header.css'],
    ['a snake case whole name', '/styles/global_styles.css'],
    ['a dash and a hash with no name before them', '/assets/-D7-WzvNx.css'],
    ['a next.js turbopack name, lowercase and not hex', '/_next/static/chunks/0bvc3j5yilzwz.css'],
  ])('keeps %s', (_, path) => {
    expect(named(`http://app.test${path}`)).toBe(path.slice(path.lastIndexOf('/') + 1))
  })

  it.each([
    ['a capitalized whole name with a digit', '/styles/Header2.css', '*.css'],
    ['a camel case plugin name', '/vendor/plugin.colorPicker.css', 'plugin.*.css'],
  ])(
    'reads %s as a hash, as its characters could be a Rollup hash such as DIlXbKeZ',
    (_, path, expected) => {
      expect(named(`http://app.test${path}`)).toBe(expected)
    }
  )

  it('gives a rebuilt bundle the name of the one it replaces', () => {
    expect(named('http://app.test/assets/vendor-grid-DIlXbKeZ.css')).toBe(
      named('http://app.test/assets/vendor-grid-D79WzvNx.css')
    )
  })

  it('keeps the hash of every file whose name another file of the snapshot reads the same', () => {
    expect(
      together(
        '/assets/index-DNgj_66d.css',
        '/assets/index-CiOyfy0p.css',
        '/assets/vendor-D79WzvNx.css',
        '/vendor/jquery.dataTables.css',
        '/vendor/jquery.mCustomScrollbar.css'
      )
    ).toEqual([
      'index-DNgj_66d.css',
      'index-CiOyfy0p.css',
      'vendor-*.css',
      'jquery.dataTables.css',
      'jquery.mCustomScrollbar.css',
    ])
  })

  it('reads a file linked twice as one file', () => {
    expect(together('/assets/index-DNgj_66d.css', '/assets/index-DNgj_66d.css?v=2')).toEqual([
      'index-*.css',
      'index-*.css',
    ])
  })
})
