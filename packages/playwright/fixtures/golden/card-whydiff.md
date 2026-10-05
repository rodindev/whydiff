What changed on this screen:
- a `<div>` is 24 px wider (was 200, now 224) (cxjwf9h)

# whydiff: named failure > card | 1 cause | 0 unexplained regions
compared: expected -> actual
source: matcher.spec.ts:20 | matcher | 800x600 px, 1,920 changed pixels | s1eeet9

## a `<div>` is 24 px wider (was 200, now 224), on the changed screenshot, 100% of changed pixels (`#card`, cxjwf9h)
- at `locator('#card')`
- `#card` from `<style> #1` (unlayered) changed its declaration of padding-left (was 0px, now 24px)
- as a result, 1 element moved 24 px right
- to restore it: change the rule where `<style> #1` comes from, or set padding-left back to 0px in your own stylesheet if a dependency injects it; whydiff cannot tell which
