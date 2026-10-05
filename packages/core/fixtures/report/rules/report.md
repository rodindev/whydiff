# whydiff: 5 of 5 screenshots changed | 2 causes | 0 unexplained regions
compared: main -> feat/framework-upgrade

2 causes appear on all 5 changed screenshots, 100% of changed pixels, and account for every changed pixel there:
- the color, font-weight and padding properties of 3 `<div>` elements, buttons and links changed, on 3 of 5 changed screenshots, 60% of changed pixels (`*`, c1aw389)
- the inner spacing of 2 `<div>` elements shrank by 8 to 10 px, on 2 of 5 changed screenshots, 40% of changed pixels (`.ui-col` and 2 more, c8hd8de)

## the color, font-weight and padding properties of 3 `<div>` elements, buttons and links changed, on 3 of 5 changed screenshots, 60% of changed pixels (`*`, c1aw389)
- for example, the "Save" button's inner spacing shrank by 8 px, at `getByText('Save')` in "s1 >> renders" (s4udgzc)
- `*` from `reset.css` (unlayered) now sets color (was #0000ff, now #000000), font-weight (was 700, now 400), padding-left (was 8px, now 0px)
- to restore it: change the rule in `reset.css`, or set the old values in your own stylesheet if `reset.css` comes from a dependency
- all occurrences: `npx whydiff explain c1aw389`

## the inner spacing of 2 `<div>` elements shrank by 8 to 10 px, on 2 of 5 changed screenshots, 40% of changed pixels (`.ui-col` and 2 more, c8hd8de)
- for example, the "Col" element's inner spacing shrank by 8 px, at `getByText('Col')` in "s4 >> renders" (s4udi5f)
- `.ui-col` and 2 more from `framework.css` (layer `framework.components`) now sets padding-left (values differ per element: `npx whydiff explain c8hd8de`) in place of `.ui-col` from `app.css` (unlayered)
- to restore it: change the rule in `framework.css`, or set the old values in your own stylesheet if `framework.css` comes from a dependency
- all occurrences: `npx whydiff explain c8hd8de`

Test and file of each screenshot id: `report.json#screenshots` or `npx whydiff explain <id>`
