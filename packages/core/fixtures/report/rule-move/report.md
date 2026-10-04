# whydiff: 4 of 4 screenshots changed | 1 cause | 0 unexplained regions
compared: main -> feat/framework-upgrade

1 cause appears on all 4 changed screenshots, 100% of changed pixels, and accounts for every changed pixel there:
- the inner spacing of 2 of 4 `<div>` elements shrank by 12 to 16 px, on all 4 changed screenshots, 100% of changed pixels (`.ui-col`, cfnwmqa)

## the inner spacing of 2 of 4 `<div>` elements shrank by 12 to 16 px, on all 4 changed screenshots, 100% of changed pixels (`.ui-col`, cfnwmqa)
- for example, the "Col" element's inner spacing shrank by 12 px, at `getByText('Col')` in "s1 >> renders" (s4udgzc)
- `.ui-col` from `framework-*.css` (layer `framework.components`) now sets font-weight (was 400, now 700); changed its declaration of color (was #0000ff, now #ff0000); no longer sets padding-left (values differ per element: `npx whydiff explain cfnwmqa`)
- it moved from unlayered into layer `framework.components`: its declarations now lose to any declaration of the same property outside a layer, whatever the selectors' specificity
- to restore it: change the rule in the source file that builds `framework-*.css`, or set the old values in your own stylesheet if the rule comes from a dependency; whydiff cannot tell from a built sheet which it is
- all occurrences: `npx whydiff explain cfnwmqa`

Test and file of each screenshot id: `report.json#screenshots` or `npx whydiff explain <id>`
