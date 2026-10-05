# whydiff: 4 of 5 screenshots changed | 3 causes | 1 unexplained region
compared: main -> feat/buttons | chromium 147 1000x800

3 causes appear on all 4 changed screenshots, 79% of changed pixels; they account for every changed pixel on 3 of them:
- the inner spacing of 2 buttons grew by 8 px, on 2 of 4 changed screenshots, 40% of changed pixels (c3ln8mq)
- the "Lonely one" button's label is lighter (was #000000, now #090909), on 1 of 4 changed screenshots, 20% of changed pixels (c2esjnt)
- the "Reset it" button's inner spacing grew by 12 px, on 1 of 4 changed screenshots, 20% of changed pixels (c1m5c6x)

1 unexplained region on 1 screenshot holds 21% of changed pixels.

## the inner spacing of 2 buttons grew by 8 px, on 2 of 4 changed screenshots, 40% of changed pixels (c3ln8mq)
- for example, the "Save it" button's inner spacing grew by 8 px, at `getByText('Save it')` in "s1 >> renders" (s4udgzc)
- padding-left: was 0, now 8px
- all occurrences: `npx whydiff explain c3ln8mq`

## the "Lonely one" button's label is lighter (was #000000, now #090909), on 1 of 4 changed screenshots, 20% of changed pixels, only in tests/hero.spec.ts (c2esjnt)
- at `getByText('Lonely one')` in "s4 >> renders" (s4udi5f)
- color: was #000000, now #090909

## the "Reset it" button's inner spacing grew by 12 px, on 1 of 4 changed screenshots, 20% of changed pixels, only in tests/buttons.spec.ts (c1m5c6x)
- at `getByText('Reset it')` in "s3 >> renders" (s4udg7a)
- padding-left: was 0, now 12px

## Unexplained regions (1)
Pixels changed, no DOM, style or geometry change found under the region.
Usual reasons: image content, canvas, icon font, text anti-aliasing.
- 1 region on "s4 >> renders" (s4udi5f), 2,500 changed pixels: 1 under `<img>`; around `locator('img.hero')`; every region with its candidates: `npx whydiff explain s4udi5f`

Unchanged: 1 screenshot is pixel-identical and not listed.
Test and file of each screenshot id: `report.json#screenshots` or `npx whydiff explain <id>`
