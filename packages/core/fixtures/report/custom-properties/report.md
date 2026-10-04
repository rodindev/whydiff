# whydiff: 2 of 2 screenshots changed | 7 causes | 0 unexplained regions
compared: main -> feat/tokens

1 cause appears on all 2 changed screenshots, 14% of changed pixels; every one of those screenshots has other changes too:
- the shadows of 2 `<div>` elements appear, on all 2 changed screenshots, 14% of changed pixels (`*` and 2 more, c2azv0u)

The other 6 causes hold 86% of changed pixels.

## the shadows of 2 `<div>` elements appear, on all 2 changed screenshots, 14% of changed pixels (`*` and 2 more, c2azv0u)
- for example, the "ring s1" element's shadow appears, at `getByText('ring s1')` in "s1 >> renders" (s4udgzc)
- `*` and 2 more from `app.css` (layer `base`) now sets --ui-glow, --ui-ring
- --ui-glow, --ui-ring are read by box-shadow, which was invalid without them
- to restore it: change the rule in `app.css`, or set the old values in your own stylesheet if `app.css` comes from a dependency
- all occurrences: `npx whydiff explain c2azv0u`

## 2 buttons are 2 px wider, on all 2 changed screenshots, 14% of changed pixels (`.ui-reset .ui-btn`, c1rjqha)
- for example, the "btn s1" button is 2 px wider (was 200, now 202) and 2 px taller (was 40, now 42), at `getByText('btn s1')` in "s1 >> renders" (s4udgzc)
- `.ui-reset .ui-btn` from `app.css` (unlayered) now sets border-width (all sides, was 2px, now 3px) in place of the browser's default `button { border-width: 2px }`
- to restore it: change the rule in `app.css`, or set border-width (all sides) back to 2px in your own stylesheet if `app.css` comes from a dependency
- all occurrences: `npx whydiff explain c1rjqha`

## the borders of 2 `<div>` elements disappear, on all 2 changed screenshots, 14% of changed pixels (`@property --ui-border-style`, c1i00el)
- for example, the "frame s1" element's border disappears, at `getByText('frame s1')` in "s1 >> renders" (s4udgzc)
- `@property --ui-border-style` from `app.css` no longer registers it (initial value solid)
- --ui-border-style is read by border-style (all sides), which is invalid without it
- to restore it: change the rule in `app.css`, or set --ui-border-style back to solid in your own stylesheet if `app.css` comes from a dependency
- all occurrences: `npx whydiff explain c1i00el`

## the backgrounds of 2 `<div>` elements are lighter (was #353535, now #ffffff), on all 2 changed screenshots, 14% of changed pixels (style attribute of an ancestor, c232xsm)
- for example, the "surface s1" element's background is lighter (was #353535, now #ffffff) and its border changes colour, at `getByText('surface s1')` in "s1 >> renders" (s4udgzc)
- the style attribute of an ancestor changed its declaration of --ui-surface (was #353535, now #ffffff)
- --ui-surface is read by background-color, border-color (all sides)
- to restore it: change the style attribute where the markup or a script sets it
- all occurrences: `npx whydiff explain c232xsm`

## the shadows of 2 `<div>` elements change, on all 2 changed screenshots, 14% of changed pixels (`.ui-card`, c4acdp1)
- for example, the "card s1" element's shadow changes, at `getByText('card s1')` in "s1 >> renders" (s4udgzc)
- `.ui-card` from `app.css` (unlayered) now sets box-shadow (was `rgba(0, 0, 0, 0.2) 0px 1px 2px 0px`, now `rgba(0, 0, 0, 0.2) 0px 1px 2px 0px, rgb(0, 0, 0) 0px 0px 0px 1px`) in place of `.ui-elevated` from `app.css` (unlayered)
- box-shadow reads --ui-shadow, set by `.ui-elevated` from `app.css` (unlayered)
- to restore it: change the rule in `app.css`, or set box-shadow back to `rgba(0, 0, 0, 0.2) 0px 1px 2px 0px` in your own stylesheet if `app.css` comes from a dependency
- all occurrences: `npx whydiff explain c4acdp1`

## the inner spacing of 2 `<div>` elements grew by 4 px, on all 2 changed screenshots, 14% of changed pixels (`:root` and 1 more, c32ihgf)
- for example, the "panel s1" element's inner spacing grew by 4 px, at `getByText('panel s1')` in "s1 >> renders" (s4udgzc)
- `:root` and 1 more from `app.css` (layer `theme`) changed its declaration of --ui-space (was 4px, now 5px)
- --ui-space is read by padding (all sides), row-gap
- to restore it: change the rule in `app.css`, or set --ui-space back to 4px in your own stylesheet if `app.css` comes from a dependency
- all occurrences: `npx whydiff explain c32ihgf`

## the column-gap property of 2 elements changed, on all 2 changed screenshots, 14% of changed pixels (`:root`, c2jd0t3)
- for example, column-gap (was 4px, now 6px) changed, at `getByText('row s1')` in "s1 >> renders" (s4udgzc)
- `:root` from `app.css` (layer `theme`) no longer sets --ui-gap
- --ui-gap is read by column-gap, which now uses its var() fallback
- to restore it: change the rule in `app.css`, or set --ui-gap back to 4px in your own stylesheet if `app.css` comes from a dependency
- all occurrences: `npx whydiff explain c2jd0t3`

Test and file of each screenshot id: `report.json#screenshots` or `npx whydiff explain <id>`
