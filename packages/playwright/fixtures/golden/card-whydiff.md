What changed on this screen:
- a `<div>` is 24 px wider (was 200, now 224) (c1dsr5a)

# whydiff: named failure > card | 1 cause | 0 unexplained regions
compared: expected -> actual
source: matcher.spec.ts:20 | matcher | 800x600 px, 1,920 changed pixels | s1eeet9

## a `<div>` is 24 px wider (was 200, now 224), on the changed screenshot, 100% of changed pixels (c1dsr5a)
- at `locator('#card')`
- padding-left: was 0, now 24px; the children were laid out again
- as a result, 1 element moved 24 px right
