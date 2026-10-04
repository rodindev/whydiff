# whydiff: 2 of 2 screenshots changed | 2 causes | 0 unexplained regions
compared: main -> feat/ui-upgrade

2 causes appear on all 2 changed screenshots, 100% of changed pixels, and account for every changed pixel there:
- the inner spacing of 2 `<div>` elements shrank by 12 px, on all 2 changed screenshots, 87% of changed pixels (`.ui-row`, c1g6bij)
- the labels of 2 buttons are lighter (was #000000, now #090909), on all 2 changed screenshots, 13% of changed pixels (c3hhw9m)

## the inner spacing of 2 `<div>` elements shrank by 12 px, on all 2 changed screenshots, 87% of changed pixels (`.ui-row`, c1g6bij)
- for example, a `<div>`'s inner spacing shrank by 12 px, at `locator('div.\\!ui-p-0').locator('div.ui-row')` in `"cart <ui-badge> > __totals__"` (s4udgzc)
- `.ui-row` from `vendor-ui-*.css` (layer `ui.components`) no longer sets padding-left (was 12px, now 0px)
- it moved from unlayered into layer `ui.components`: its declarations now lose to any declaration of the same property outside a layer, whatever the selectors' specificity
- to restore it: set padding-left back to 12px in your own stylesheet; do not edit `vendor-ui-*.css`, which reads as a dependency's (vendor in its name)
- all occurrences: `npx whydiff explain c1g6bij`

## the labels of 2 buttons are lighter (was #000000, now #090909), on all 2 changed screenshots, 13% of changed pixels (c3hhw9m)
- for example, the `"Total *"` button's label is lighter (was #000000, now #090909), at `getByRole('button', { name: 'Total *' })` in `"cart <ui-badge> > __totals__"` (s4udgzc)
- color: was #000000, now #090909
- all occurrences: `npx whydiff explain c3hhw9m`

Test and file of each screenshot id: `report.json#screenshots` or `npx whydiff explain <id>`
