# whydiff

Explains why a screenshot changed: which element, which CSS rule, which tests.

[![npm](https://img.shields.io/npm/v/whydiff)](https://www.npmjs.com/package/whydiff) [![CI](https://github.com/rodindev/whydiff/actions/workflows/ci.yml/badge.svg)](https://github.com/rodindev/whydiff/actions/workflows/ci.yml) [![license](https://img.shields.io/npm/l/whydiff)](https://github.com/rodindev/whydiff/blob/main/LICENSE)

whydiff is for Playwright screenshot tests (`toHaveScreenshot`). When one fails, whydiff says which element changed and which CSS rule did it, right in the failed test, and when the run ends, which other tests share the cause. It runs inside your tests, on your machine or in CI, with no model and no service.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rodindev/whydiff/main/docs/images/failed-screenshot-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/rodindev/whydiff/main/docs/images/failed-screenshot-light.png">
  <img alt="A failed Playwright screenshot test of a settings page. Above, the expected, actual and diff images that Playwright writes. Below, the lines whydiff adds to the error message, which say the Help button is 8 px wider, and what npx whydiff explain prints next: 9 buttons on all 3 changed screenshots are 8 px wider because the .ui-button rule in ui-kit.css changed its padding-left and padding-right from 12px to 16px." src="https://raw.githubusercontent.com/rodindev/whydiff/main/docs/images/failed-screenshot-light.png">
</picture>

A failed `toHaveScreenshot` gives you three images and a pixel count. The baseline is only an image, so nothing in it says which element moved or which CSS property changed. After a dependency upgrade, dozens of screenshots fail at once, and you open them one by one to find out that most share one cause.

whydiff keeps a render-tree snapshot next to each baseline PNG: the DOM, the layout boxes, the computed styles and the CSS rules that set them. When a screenshot fails, it compares the snapshots of both sides under the changed pixels to find what changed and the rule that did it, then groups every failed screenshot of the run by cause.

## What it prints

Three screens of a small app, captured before and after an update of its UI kit stylesheet and its chart data, then compared with `npx whydiff diff before after`:

<!-- npx whydiff diff before after in packages/cli/fixtures/readme; packages/cli/src/readme.spec.ts keeps this block current -->

```text
# whydiff: 3 of 3 screenshots changed | 2 causes | 1 unexplained region
compared: before -> after | chromium 153.0.8010.12 480x320

2 causes appear on all 3 changed screenshots, 87% of changed pixels; they account for every changed pixel on 2 of them:
- 9 buttons are 8 px wider, on all 3 changed screenshots, 69% of changed pixels (`.ui-button`, c35ew6y)
- the corners of 3 `<div>` elements are rounder, on 1 of 3 changed screenshots, 18% of changed pixels (`:root`, c29t82f)

1 unexplained region on 1 screenshot holds 13% of changed pixels.

## 9 buttons are 8 px wider, on all 3 changed screenshots, 69% of changed pixels (`.ui-button`, c35ew6y)
- for example, the "Help" button is 8 px wider (was 55, now 63), at `getByRole('button', { name: 'Help' })` in "items" (sy77idc)
- `.ui-button` from `ui-kit.css` (unlayered) changed its declaration of padding-left, padding-right (was 12px, now 16px)
- to restore it: change the rule in `ui-kit.css`, or set padding-left, padding-right back to 12px in your own stylesheet if `ui-kit.css` comes from a dependency
- all occurrences: `npx whydiff explain c35ew6y`

## the corners of 3 `<div>` elements are rounder, on 1 of 3 changed screenshots, 18% of changed pixels (`:root`, c29t82f)
- for example, the "First item" element's corners are rounder, at `locator('div.app-list').locator('div.ui-card').nth(0)` in "items" (sy77idc)
- `:root` from `ui-kit.css` (unlayered) changed its declaration of --ui-radius (was 4px, now 10px)
- --ui-radius is read by border-radius (all corners)
- to restore it: change the rule in `ui-kit.css`, or set --ui-radius back to 4px in your own stylesheet if `ui-kit.css` comes from a dependency
- all occurrences: `npx whydiff explain c29t82f`

## Unexplained regions (1)
Pixels changed, no DOM, style or geometry change found under the region.
Usual reasons: image content, canvas, icon font, text anti-aliasing.
- 1 region on "usage" (sgh10bo), 420 changed pixels: 1 under `<canvas>`; around `locator('main.app-main').locator('canvas.app-chart')`; every region with its candidates: `npx whydiff explain sgh10bo`

Test and file of each screenshot id: `report.json#screenshots` or `npx whydiff explain <id>`
```

Both changes in `ui-kit.css` are named with their rule and values. The chart is drawn on a canvas, which has no DOM to compare, so its changed pixels are listed as unexplained. A Playwright run writes the same report to `whydiff-report/report.md`. The pages, both captures and the Playwright project behind the pictures in this README are in [`packages/cli/fixtures/readme`](https://github.com/rodindev/whydiff/tree/main/packages/cli/fixtures/readme).

## Replaying a real upgrade: ComfyUI_frontend

In September 2025, [ComfyUI_frontend](https://github.com/Comfy-Org/ComfyUI_frontend) moved from Tailwind CSS 3 to 4 in [pull request #5246](https://github.com/Comfy-Org/ComfyUI_frontend/pull/5246). That was before whydiff existed, so nobody there used it. To see what it would have said, we took their Playwright suite, added whydiff, and ran it on the commit before the upgrade (`caee3832`) and again on the merge (`85017dbb`). 128 of 132 screenshots changed, and whydiff traced them to 4 causes. The top one: "1,373 buttons are 2 px taller, on 125 of 128 changed screenshots, 92% of changed pixels"; its rule line says `.comfy-btn` and 4 more now set border-width "(all sides, was 2px, now 3px) in place of the browser's default `button { border-width: 2px }`". Replayed on 2026-10-04 with a pre-release build of whydiff. To reproduce it, raise their `@playwright/test` to 1.53 or later, wrap their fixtures with `withWhydiff`, record the baselines at `caee3832`, then run the suite at `85017dbb` with `@whydiff/playwright/reporter` listed before `html`.

ComfyUI_frontend belongs to its authors and is licensed under GPL-3.0, and none of its code is in this repository. Thanks to its maintainers for a public suite to test against.

## Install

In a project that runs Playwright Test:

```sh
npm i -D @whydiff/playwright whydiff
npx whydiff init
npx whydiff doctor
```

A project whose `.npmrc` sets `min-release-age` cannot install a release of whydiff younger than that many days; npm then stops with `notarget` and a date, without naming the setting.

`init` shows each edit as a diff and asks before it writes:

- `withWhydiff` around `test` and `expect` in the fixtures file your specs import them from, or, when there is none, a new `fixtures.ts` (`fixtures.js` next to a JavaScript config) in the test directory;
- in the specs that call `toHaveScreenshot`, `test` and `expect` taken from that fixtures file instead of `@playwright/test`;
- `@whydiff/playwright/reporter` in `playwright.config`, before `html`;
- a `.gitattributes` line that keeps the `.whydiff.json` snapshots out of diffs.

`doctor` checks the versions, the browser, the reporter's place, which file calls whydiff and how many baseline PNGs have a snapshot, one line each, with the fix after `|`.

A fixtures file that `init` creates:

```ts
import { expect as baseExpect, test as base } from '@playwright/test'
import { withWhydiff } from '@whydiff/playwright'

export const { test, expect } = withWhydiff(base, baseExpect)
```

A spec that still takes `test` and `expect` from `@playwright/test` is not explained; `doctor` names it.

### The first run

whydiff explains a failure only when the baseline PNG has a `.whydiff.json` next to it. Commit those files with the baselines.

- A green suite: the next run writes them. An assertion that passes and has no snapshot yet records one (`use.whydiff.backfill`, on by default), and `npx playwright test --update-snapshots` records one with every baseline it writes.
- A suite that is already red, for example after an upgrade: record the old side first. Check out the commit before the change, add whydiff there the same way, run the suite once so the passing assertions record their snapshots, and bring the `.whydiff.json` files over to your branch. Until then a failure says that only its pixels are described. Or compare two runs instead, see below.

## What a failed test shows

whydiff never changes a test's status: Playwright decides pass or fail, and an error inside whydiff becomes an annotation on the test. A failed screenshot gets:

- Lines in the assertion's error message, which keeps Playwright's text. After the pixel count come up to three lines of what changed, under `whydiff, expected -> actual:`, and, with the reporter, the `npx whydiff explain <id>` command that explains the screenshot from the run's report. The lines reach the terminal, the CI log, the HTML report, UI mode and VS Code.
- One `whydiff` annotation: the first of those lines with the ids of the screenshot's causes, which Playwright's HTML report shows above the errors.
- Attachments: the screenshot's full description, which the HTML report shows inline, and both snapshots.

The settings test of the README's fixture, failed, in Playwright's HTML report:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rodindev/whydiff/main/docs/images/playwright-report-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/rodindev/whydiff/main/docs/images/playwright-report-light.png">
  <img alt="Playwright's HTML report open on the failed settings test. Under Annotations, the whydiff annotation names the element that changed, the Help button, 8 px wider, and the id of its cause. Under Errors, Playwright's message says how many pixels are different, and whydiff's lines follow it, ending in the npx whydiff explain command for this screenshot." src="https://raw.githubusercontent.com/rodindev/whydiff/main/docs/images/playwright-report-light.png">
</picture>

When the run ends, the reporter prints its counts and writes `whydiff-report/` next to the Playwright config:

- `report.md`: the run as text, like the example above, with the commands that open each part;
- `report.json`: the complete data, with a [JSON schema](https://github.com/rodindev/whydiff/blob/main/packages/core/schema/report-v1.schema.json);
- `report.html`: the run page, a static page with the summary, each cause, the screenshots it is on and the unexplained regions;
- `screenshots/<id>.md`: one page per changed screenshot.

The run page of the same run, its summary and first cause:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rodindev/whydiff/main/docs/images/run-page-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/rodindev/whydiff/main/docs/images/run-page-light.png">
  <img alt="whydiff's run page: 3 of 3 screenshots changed, a summary that lists 2 causes and 1 unexplained region, then the first cause, 9 buttons 8 px wider on all 3 screenshots, with the .ui-button rule from ui-kit.css that changed padding-left and padding-right from 12px to 16px, how to restore it, and the command that lists all its occurrences." src="https://raw.githubusercontent.com/rodindev/whydiff/main/docs/images/run-page-light.png">
</picture>

Listed before `html`, the reporter also attaches the run page to every test with a failed screenshot and puts the run's description in place of the test's own. The cause ids in Playwright's HTML report then match `report.json`, and its search `annot:<cause id>` lists every test with that cause. On GitHub Actions, when a screenshot failed, the reporter adds a short summary to the job summary. `whydiff-report/` is not part of `playwright-report/`; upload it as an artifact of its own to keep it after a CI run.

`npx whydiff explain --all` lists every cause of the last report, and `npx whydiff explain <id>` prints one cause, screenshot or unexplained region.

## How it works

1. Capture. Right after Playwright's assertion, whydiff reads the page in the state the screenshot saw through the Chrome DevTools Protocol: every node with its box, computed styles and accessibility role, and the CSS rules and custom properties that won. The baseline side's snapshot is kept as `.whydiff.json` next to the baseline PNG.
2. Match. It finds the changed pixel regions with the same pixelmatch math as Playwright, so it sees the pixels Playwright counted, and pairs the elements of both snapshots.
3. Causes. For each changed region it names the element and the property that changed, the rule that set it, with the old and new values, and what only moved or resized as a result.
4. Clusters. Across the run it groups the screenshots by the rule that changed, so one CSS change that touched 40 screenshots is one cause.

The analysis is plain code: no model, no network, no randomness. The same snapshots and PNGs give the same report, byte for byte. Capturing the same page on another OS, font set or Chromium build can give different snapshots.

## Two runs, and any page

Compare two runs of the suite, for example before and after a dependency upgrade; each run records its screenshots and snapshots into the directory `WHYDIFF_OUT` names:

```sh
WHYDIFF_OUT=before npx playwright test
WHYDIFF_OUT=after npx playwright test
npx whydiff diff before after
```

Compare two states of any page, without a test suite:

```sh
npx whydiff snap http://localhost:3000 --name before
npx whydiff snap http://localhost:3000 --name after
npx whydiff diff before after
```

`snap` needs `@playwright/test` or `playwright-core` in the project. It opens the page in Playwright's Chromium headless shell (`npx playwright install chromium-headless-shell`, or `npx playwright-core install chromium-headless-shell` with only `playwright-core` installed), or in the Chromium that `WHYDIFF_CHROMIUM` or `--executable` names. `npx whydiff report --from test-results` rebuilds the report of a run the reporter did not see, from its failed screenshots alone, since test-results keep nothing of a passed one, and `npx whydiff report --merge` joins the reports of shards. `npx whydiff --help` lists every command and `npx whydiff <command> --help` its options.

## For coding agents

An agent meets whydiff in the failed test's output, which names what changed, the rule and the command to run next. Nothing else needs installing.

- `npx whydiff explain <id> --json` prints one cause, screenshot or region as `report.json` holds it. On a large run `report.json` can be several megabytes; read it through `explain`.
- `npx whydiff schema report` prints the JSON schema of `report.json`.
- whydiff says what changed, not whether the change was intended. Whether to fix the code or update the baseline stays the agent's call.

A paragraph for your `AGENTS.md`:

```md
Screenshot tests run with whydiff. A failed toHaveScreenshot names the element that changed and the CSS rule behind it. Run `npx whydiff explain <id> --json` for the data of a cause, screenshot or region. To undo a change from a dependency's stylesheet, override the rule in our own CSS instead of editing the dependency. Update a baseline only when the change is intended.
```

## Limits

- Chromium only. A failed screenshot in another browser is listed as not explained.
- On `@playwright/test` 1.60.0 and 1.61.0 any override of `toHaveScreenshot` recurses, so `withWhydiff` throws there. `init` says so and offers only the reporter and `.gitattributes` edits; call `whydiffCapture(page, ...args)` after each `await expect.soft(page).toHaveScreenshot(...args)`. That call explains the failure in the annotation and the attachment, but it cannot add lines to the error message, and it does not cover `.not` or `expect.poll`. See [`@whydiff/playwright`](https://github.com/rodindev/whydiff/tree/main/packages/playwright#readme).
- Canvas, image content, icon fonts and text anti-aliasing have no DOM change to find; their pixels are listed as unexplained regions.
- A rule's file is the stylesheet the browser loaded: a bundle's name when the CSS is bundled. Source maps are not read.
- Pseudo-elements other than `::before`, `::after` and `::marker`, `::placeholder` for example, are not captured.
- The snapshot is read right after the screenshot. A script that changes the page in between makes the two disagree.
- A stylesheet that a test serves through `page.route` or `routeFromHAR` reads back empty unless the routed response carries `cache-control: max-age`, so its rules cannot be named. Add that header to routed CSS.
- Known wrong results of the capture: `clip-path`, `clip`, `contain: paint` or `strict`, `content-visibility: auto`, rounded `overflow` corners, `text-overflow` and a nested `svg` do not count as clipping; `filter`, `mask-image` and a near-zero alpha do not count as hidden; boxes are off in a frame under a scaled or rotated ancestor, in a zoomed frame or scroller and on a full-page right-to-left page; `::first-letter` text and collapsed table rows and columns are read wrong. Each is an expected failure in [`adversarial.spec.ts`](https://github.com/rodindev/whydiff/blob/main/packages/capture/src/adversarial.spec.ts).
- The reporter puts its explanations into Playwright's HTML report because Playwright hands every reporter the same results and runs them in config order. That holds from 1.53 on but is not a documented API. `--reporter` on the command line replaces the config's reporters, and UI mode and blob shards see only what the tests attached.

## Compatibility

- Node 22.18.0 or later; ESM and CommonJS projects.
- `@playwright/test` 1.53.0 or later, Chromium projects; 1.60.0 and 1.61.0 through the explicit call above.
- CI runs on Linux and macOS and tests Playwright 1.53.2, 1.59.1, 1.61.1 and the latest release.
- Packages: [`whydiff`](https://www.npmjs.com/package/whydiff), the command line; [`@whydiff/playwright`](https://www.npmjs.com/package/@whydiff/playwright), the fixtures and the reporter; [`@whydiff/capture`](https://www.npmjs.com/package/@whydiff/capture), the snapshot from Chromium; [`@whydiff/core`](https://www.npmjs.com/package/@whydiff/core), the analysis. All four share one version.

## Contributing

Bug reports and pull requests are welcome: see [CONTRIBUTING.md](https://github.com/rodindev/whydiff/blob/main/CONTRIBUTING.md), the [code of conduct](https://github.com/rodindev/whydiff/blob/main/CODE_OF_CONDUCT.md) and, for vulnerabilities, [SECURITY.md](https://github.com/rodindev/whydiff/blob/main/SECURITY.md). Questions go to [Discussions](https://github.com/rodindev/whydiff/discussions).

## License

[MIT](https://github.com/rodindev/whydiff/blob/main/LICENSE)
