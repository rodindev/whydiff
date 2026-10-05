# whydiff: 1 of 1 screenshot changed | 1 cause | 0 unexplained regions
compared: before -> after

1 cause appears on the changed screenshot, 100% of changed pixels, and accounts for every changed pixel there:
- the "Help" button's inner spacing grew by 4 px, on the changed screenshot, 100% of changed pixels (`.ui-btn`, c2m60cz)

## the "Help" button's inner spacing grew by 4 px, on the changed screenshot, 100% of changed pixels, only in tests/settings.spec.ts (`.ui-btn`, c2m60cz)
- at `getByText('Help')` in "s1 >> renders" (s4udgzc)
- `.ui-btn` from `ui-kit.css` (unlayered) changed its declaration of padding-left (was 12px, now 16px)
- to restore it: change the rule in `ui-kit.css`, or set padding-left back to 12px in your own stylesheet if `ui-kit.css` comes from a dependency

Test and file of each screenshot id: `report.json#screenshots` or `npx whydiff explain <id>`
