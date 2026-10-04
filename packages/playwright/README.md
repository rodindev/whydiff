# @whydiff/playwright

Explains failed `toHaveScreenshot` assertions as text, for Playwright: the element, the CSS rule, every test with the same cause.

Part of [whydiff](https://github.com/rodindev/whydiff#readme). Its README shows an example report and covers the first run, how it works and the limits.

## Setup

```sh
npm i -D @whydiff/playwright whydiff
npx whydiff init
```

`init` wraps `test` and `expect` with `withWhydiff` in the fixtures file your specs import them from, or creates one, and lists the reporter in `playwright.config` before `html`. `npx whydiff doctor` checks the result.

## Two ways in

`withWhydiff(test, expect)` overrides `toHaveScreenshot` so every assertion is explained in place. Use it wherever your `@playwright/test` release allows it: every release but 1.60.0 and 1.61.0. `whydiffCapture(receiver, ...args)`, placed right after `await expect.soft(receiver).toHaveScreenshot(...args)`, does the same work from what the built-in attached, on every release. Use it where the image is pinned to a release the override refuses. Use one or the other, not both. The explicit call does not cover `.not` assertions or `expect.poll`, and it cannot add to the assertion's error message, which the built-in recorded before the call ran.

## In the test

A failing screenshot is explained in its test:

- one `whydiff` annotation holds the first line of what changed with the ids of the screenshot's causes. Playwright's HTML report shows it above the errors, and its search finds it with `annot:<id>`;
- the Markdown description is attached as text, which the report shows inline;
- with `withWhydiff`, the first three lines follow Playwright's pixel count in the assertion's message, so the terminal, the CI log, UI mode, VS Code and the report's Copy prompt carry them.

The message names no cause ids, since a test sees one screenshot and the run may group its change differently. When the reporter runs, its last line is the `npx whydiff explain <screenshot id>` command that answers from the run's report.

With the reporter in the configuration that runs the tests, `use.whydiff.maxExplained` (default 500) is a fuse for each project, each screenshot counted once however often a retry or an `expect.toPass` loop repeats it. Past it a screenshot attaches its snapshots and, in place of the description, says where the reporter writes it when the run ends (`whydiff-report/screenshots/<id>.md`), why, and that nothing failed in whydiff. With `use.whydiff.attach: false` the reporter has nothing to read, so every description stays in its test. The reporter hands the workers a fresh temporary directory to count in when the run begins and removes it when the run ends; a worker started without it, by a run with no whydiff reporter, explains every failure in its test.

## Errors and time

whydiff never changes a test's status, and a whydiff error never fails a test: it becomes a `whydiff` annotation on the test, and the first one of each worker is also printed as a warning. An annotation about a failed screenshot starts with the name of its attachments, `card: not explained: ...`; one that produced no actual image, a locator that never appeared for instance, says so with the assertion's error.

Each assertion gets `use.whydiff.budgetMs` (default 60000) for its one capture, the analysis and the writes. The timeout grows by the budget while whydiff works and keeps only what whydiff used, so whydiff's time is not taken from the test's. A `test.step` or `expect.toPass` with its own timeout keeps its deadline, and whydiff's time inside it counts against that. Past the budget the rest is skipped with the same annotation.

## Reporter

`@whydiff/playwright/reporter` clusters the causes of every failed screenshot of the run into `whydiff-report/` next to the Playwright config: `report.md`, `report.json`, the run page `report.html` and a page per changed screenshot under `screenshots/`. Every failed screenshot assertion it cannot explain is listed under `## Not explained`: over the budget, in another browser, with a capture error, with files it cannot read, or with no actual image (a locator that never appeared, a missing baseline under `--update-snapshots=none`). The reason is the test's `whydiff` annotation about that screenshot, else the assertion's own error, and the summary it prints counts them.

List the reporter before `html`, as `npx whydiff init` does and `npx whydiff doctor` checks; listed after it, the reporter says so on the console and in the job summary. When the run ends it puts the run's page of each failed screenshot in place of what the test attached, and that page's first line in place of the test's annotation, before Playwright's HTML reporter reads them. The cause ids then match `report.json`, and `annot:<id>` finds every test of a cause, those past the fuse included. The error message keeps what the test wrote. This relies on Playwright handing every reporter the same results and awaiting their `onEnd` in config order, the same from 1.53 on but not a documented API. `--reporter` on the command line replaces the config's reporters, and UI mode and blob shards see only what the tests attached. When `GITHUB_STEP_SUMMARY` is set and a screenshot failed, the reporter appends a short summary there: its counts and the run summary `report.md` opens with.

A sharded run writes `report.shard-<i>-of-<n>.json`, with its `.md`, `.html` and `screenshots.shard-<i>-of-<n>/`, per shard when the reporter runs on the shards; `whydiff report --merge` joins the `.json` files, `## Not explained` included. With only `blob` on the shards and the whydiff reporter in `merge-reports`, the report is the same, but no reporter runs while the tests do, so there is no cap and every failure is explained in its test.

## License

MIT
