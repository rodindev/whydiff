report: report.json

What changed on this screen:
- the "Lonely one" button's label is lighter (was #000000, now #090909) (c2esjnt)

# whydiff: s4 >> renders | 1 cause | 1 unexplained region
compared: main -> feat/buttons | chromium 147 1000x800
source: tests/hero.spec.ts:40 | chromium | 1000x800 px, 4,900 changed pixels | s4udi5f

## the "Lonely one" button's label is lighter (was #000000, now #090909), on 1 of 4 changed screenshots, 20% of changed pixels (c2esjnt)
- at `getByText('Lonely one')`
- color: was #000000, now #090909

## Unexplained regions (1)
Pixels changed, no DOM, style or geometry change found under the region.
Usual reasons: image content, canvas, icon font, text anti-aliasing.
- uuc6ba1 in "s4 >> renders" (s4udi5f) | region 50x50 at (320,320), 2,500 changed pixels | under `<img>` | candidates, by how much of their box changed: `locator('img.hero')` 12.5%, `locator('body')` 0.6%, `locator('html')` 0.6%

## members of c2esjnt
- 1 member on 1 screenshot: color #000000 -> #090909
  - s4udi5f | s4 >> renders | getByText('Lonely one') | 1 element
