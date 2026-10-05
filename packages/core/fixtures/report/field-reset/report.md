# whydiff: 2 of 2 screenshots changed | 2 causes | 0 unexplained regions
compared: main -> feat/form-reset

2 causes appear on all 2 changed screenshots, 100% of changed pixels, and account for every changed pixel there:
- the inner spacing of 4 buttons and text fields shrank by 8 to 24 px, on all 2 changed screenshots, 54% of changed pixels (`*`, c1aw389)
- 2 text fields become visible, on all 2 changed screenshots, 46% of changed pixels (`.ui-field`, c3gywtd)

## the inner spacing of 4 buttons and text fields shrank by 8 to 24 px, on all 2 changed screenshots, 54% of changed pixels (`*`, c1aw389)
- for example, the "Notes s1" text field's inner spacing shrank by 8 px, at `getByRole('textbox', { name: 'Notes s1' })` in "s1 >> renders" (s4udgzc)
- `*` from `reset.css` (unlayered) now sets padding (all sides, values differ per element: `npx whydiff explain c1aw389`)
- to restore it: change the rule in `reset.css`, or set the old values in your own stylesheet if `reset.css` comes from a dependency
- all occurrences: `npx whydiff explain c1aw389`

## 2 text fields become visible, on all 2 changed screenshots, 46% of changed pixels (`.ui-field`, c3gywtd)
- for example, the "Notes s1" text field becomes visible, at `getByRole('textbox', { name: 'Notes s1' })` in "s1 >> renders" (s4udgzc)
- `.ui-field` from `app.css` (unlayered) no longer sets opacity (was 0, now 1)
- to restore it: change the rule in `app.css`, or set opacity back to 0 in your own stylesheet if `app.css` comes from a dependency
- all occurrences: `npx whydiff explain c3gywtd`

Test and file of each screenshot id: `report.json#screenshots` or `npx whydiff explain <id>`
