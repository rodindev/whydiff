# whydiff: 1 of 1 screenshot changed | 1 cause | 2 unexplained regions
compared: main -> feat/form-reset

1 cause appears on the changed screenshot, 60% of changed pixels; that screenshot has other changes too:
- the "Notes" text field's text is lighter (was #000000, now #090909), on the changed screenshot, 60% of changed pixels (c1ur4wc)

2 unexplained regions on 1 screenshot hold 40% of changed pixels.

## the "Notes" text field's text is lighter (was #000000, now #090909), on the changed screenshot, 60% of changed pixels, only in tests/forms.spec.ts (c1ur4wc)
- at `getByRole('textbox', { name: 'Notes' })` in "s1 >> renders" (s4udgzc)
- color: was #000000, now #090909

## Unexplained regions (2)
Pixels changed, no DOM, style or geometry change found under the region.
Usual reasons: image content, canvas, icon font, text anti-aliasing.
- 2 regions on "s1 >> renders" (s4udgzc), 607 changed pixels: 1 inside the resize corner of `getByRole('textbox', { name: 'Notes' })`, 1 inside `<input>`: placeholder, value text or control internals, which whydiff does not capture; every region with its candidates: `npx whydiff explain s4udgzc`

Test and file of each screenshot id: `report.json#screenshots` or `npx whydiff explain <id>`
