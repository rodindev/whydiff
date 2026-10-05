What changed on this screen:
- the `"Total *"` button's label is lighter (was #000000, now #090909) (c3p6wov)
- a `<div>`'s inner spacing shrank by 12 px (c13u1c7)

# whydiff: `cart <ui-badge> > __totals__` | 2 causes | 0 unexplained regions
compared: main -> feat/ui-upgrade
source: 1000x800 px, 18,400 changed pixels | s4udgzc

## the inner spacing of 2 `<div>` elements shrank by 12 px, on all 2 changed screenshots, 87% of changed pixels (`.ui-row`, c13u1c7)
- a `<div>`'s inner spacing shrank by 12 px, at `locator('div.\\!ui-p-0').locator('div.ui-row')`
- `.ui-row` from `vendor-ui-*.css` (layer `ui.components`) no longer sets padding-left (was 12px, now 0px)
- it moved from unlayered into layer `ui.components`: its declarations now lose to any declaration of the same property outside a layer, whatever the selectors' specificity
- to restore it: set padding-left back to 12px in your own stylesheet; do not edit `vendor-ui-*.css`, which reads as a dependency's (vendor in its name)

## the labels of 2 buttons are lighter (was #000000, now #090909), on all 2 changed screenshots, 13% of changed pixels (c3p6wov)
- the `"Total *"` button's label is lighter (was #000000, now #090909), at `getByRole('button', { name: 'Total *' })`
- color: was #000000, now #090909
