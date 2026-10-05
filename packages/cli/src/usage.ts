import { DEFAULT_VIEWPORT, REPORT_DIR, SNAPS_DIR } from './constants.js'

const MORE = 'More: https://github.com/rodindev/whydiff#readme'
const VIEWPORT = `${String(DEFAULT_VIEWPORT.width)}x${String(DEFAULT_VIEWPORT.height)}`

/** What whydiff is for, each command in one line, an example per common task and where to read more; printed by `--help` and on a missing command. */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types -- isolatedDeclarations asks for the type of a template with substitutions
export const USAGE: string = `whydiff - explains why a screenshot changed, as text

Usage: npx whydiff <command> [options]

Commands:
  init      add whydiff to a Playwright project: the fixtures and the reporter
  explain   print a cause, a screenshot or a region of the last report
  report    rebuild the report from test-results, or merge the reports of shards
  diff      compare two snaps or two runs and write the report
  snap      capture a page: its PNG and its render-tree snapshot
  doctor    check the versions, the browser and the project setup
  schema    print the JSON schema of the snapshot or of the report

Examples:
  Explain a red screenshot run, in each failed test and in whydiff-report/report.md:
    $ npx whydiff init
    $ npx playwright test

  Compare two runs of the suite, before and after a change:
    $ WHYDIFF_OUT=before npx playwright test
    $ WHYDIFF_OUT=after npx playwright test
    $ npx whydiff diff before after

  List every cause of the last report, then explain one of them:
    $ npx whydiff explain --all
    $ npx whydiff explain c257ja7

stdout carries the result alone; progress and warnings go to stderr.
Exit codes: 0, 1 for diff --exit-code with a changed screenshot, 2 on an error.

Run npx whydiff <command> --help for its options and npx whydiff --version for the version.
${MORE}
`

/** What `--help` prints after each command: its usage, what it does, one line per option and an example. */
export const COMMAND_USAGE: Readonly<
  Record<'init' | 'explain' | 'report' | 'diff' | 'snap' | 'doctor' | 'schema', string>
> = {
  init: `Usage: npx whydiff init [--yes]

Adds whydiff to the Playwright project in this directory: withWhydiff in the
fixtures file the tests import test and expect from (created when there is none),
an import of test and expect from that file in each spec that calls
toHaveScreenshot and takes them from @playwright/test, the reporter in
playwright.config, before html so that Playwright's HTML report shows the run's
explanations (moved there when it is listed after html), and a .gitattributes
line that keeps the .whydiff.json snapshots out of diffs. Each edit is shown as
a diff first. On a @playwright/test release withWhydiff cannot run on, it leaves
the fixtures and the specs alone and says to call whydiffCapture after each
toHaveScreenshot instead.

Options:
  --yes    apply every edit without asking; with no terminal, only --yes applies them

Example:
  $ npx whydiff init

${MORE}
`,
  explain: `Usage: npx whydiff explain <id>... [--all] [--report <file>] [--json]
       npx whydiff explain --all [--report <file>] [--json]

Prints what the report holds about each id: a cause (c...) with its members grouped
by identical changes, a screenshot (s...) in full, an unexplained region (u...) with
its crops written next to the report. --all alone prints every cause.

Options:
  --all              alone, every cause; with ids, every member and every selector
  --report <file>    the report.json to read; default: the newest in ${REPORT_DIR}
  --json             print JSON: the entries as report.json holds them, and the crops written

Examples:
  $ npx whydiff explain --all
  $ npx whydiff explain c257ja7 s4udgzc
  $ npx whydiff explain c257ja7 --all --report ${REPORT_DIR}/report.json

${MORE}
`,
  report: `Usage: npx whydiff report --from <test-results dir> [--out <dir>] [--json]
       npx whydiff report --merge <report.json>... [--out <dir>] [--json]

--from rebuilds the run report from what a Playwright run left in test-results, for a
run the whydiff reporter did not see. test-results keep nothing of a passed screenshot,
so the rebuilt report says how many screenshots changed, not of how many. --merge
joins the reports of shards into one.

Options:
  --from <dir>         the test-results of a run that used withWhydiff or whydiffCapture
  --merge <file>...    the reports to join, report.shard-<i>-of-<n>.json
  --out <dir>          where report.json, report.md and report.html go; default: ${REPORT_DIR}
  --json               print report.json instead of the Markdown

Examples:
  $ npx whydiff report --from test-results
  $ npx whydiff report --merge ${REPORT_DIR}/report.shard-*.json

${MORE}
`,
  diff: `Usage: npx whydiff diff <before> <after> [options]

Compares two sides of one kind and writes report.json, report.md, the run page
report.html and a page per changed screenshot. A side is a snap name, a
.whydiff.json file with its PNG beside it, a directory a run recorded into with
WHYDIFF_OUT, or a Playwright snapshot directory.

Options:
  --out <dir>         where the report goes; default: ${REPORT_DIR}
  --max-causes <n>    the causes report.md shows in full; the rest are counted
  --exit-code         exit 1 when a screenshot changed
  --json              print report.json instead of the Markdown

Examples:
  $ npx whydiff diff before after
  $ npx whydiff diff before after --exit-code --json

${MORE}
`,
  snap: `Usage: npx whydiff snap <url> --name <name> [options]

Opens the page in headless Chromium and writes <name>.png and <name>.whydiff.json
under ${SNAPS_DIR}, where diff finds them by name.

Options:
  --name <name>             names both files: letters, digits, dots, dashes, underscores
  --selector <css>          capture this element instead of the viewport
  --full-page               capture the whole scrollable page
  --viewport <WxH>          the viewport size; default: ${VIEWPORT}
  --wait-for <css|ms>       wait for an element, or for milliseconds, before capturing
  --storage-state <file>    a Playwright storage state to open the page with
  --out <dir>               where both files go; default: ${SNAPS_DIR}
  --executable <path>       the Chromium to run; default: WHYDIFF_CHROMIUM, else Playwright's

Example:
  $ npx whydiff snap http://localhost:3000 --name before

${MORE}
`,
  doctor: `Usage: npx whydiff doctor [--json]

Prints the versions it runs on, then checks the project, one line each: ok, warn or
fail, with the fix after |. Exits 2 when a check fails.

Options:
  --json    the checks as JSON

Example:
  $ npx whydiff doctor

${MORE}
`,
  schema: `Usage: npx whydiff schema snapshot|report

Prints the JSON schema of a .whydiff.json snapshot or of report.json. The report's
schema says what each of its fields means.

Example:
  $ npx whydiff schema report

${MORE}
`,
}
