What changed on this screen:
- the "Help" button's inner spacing grew by 4 px (c6npvfg)

# whydiff: s1 >> renders | 1 cause | 0 unexplained regions
compared: before -> after
source: tests/settings.spec.ts | chromium | 1000x800 px, 2,400 changed pixels | s4udgzc

## the "Help" button's inner spacing grew by 4 px, on the changed screenshot, 100% of changed pixels (`.ui-btn`, c6npvfg)
- at `getByText('Help')`
- `.ui-btn` from `ui-kit.css` (unlayered) changed its declaration of padding-left (was 12px, now 16px)
- to restore it: change the rule in `ui-kit.css`, or set padding-left back to 12px in your own stylesheet if `ui-kit.css` comes from a dependency
