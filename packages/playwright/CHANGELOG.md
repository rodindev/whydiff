# @whydiff/playwright

## 0.2.0

### Minor Changes

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - Every cause id changes once: the cluster rules are now version `k2`, as `tool.rules.cluster` in report.json says, because a CSS rule now names a cause even when a single element changed under it. `whydiff report --merge` refuses to join a report of 0.1 with one of 0.2, which would hold the same cause under two ids.

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - Every screenshot id the reporter and `whydiff report --from` write changes once: it is now a hash of the screenshot's project, test file, title path, repeat index and name instead of Playwright's internal test id, so the id a failed test prints is the one in the run's report and in the report `whydiff report --from test-results` rebuilds. `whydiff report --merge` orders the elements of a cause by the project, test file and title of their screenshots, as the run's reporter does.

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - `whydiff diff` of two runs recorded with `WHYDIFF_OUT` gives a screenshot that failed in the second run the id its test printed and that run's report gives it, so a failed screenshot has one id however it was compared; every other id of a two-run report stays as it was. The second run must be recorded with 0.2, whose manifest keeps the name Playwright gave the images of a failed screenshot. A screenshot that only one of the runs took is named by its title in the warning.

### Patch Changes

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - A report that `whydiff report --from` rebuilds says how many screenshots changed, not of how many, since test-results keep nothing of a passed screenshot: `128 screenshots changed` where it read `128 of 128 screenshots changed`, in report.md, the run page, the count line and the job summary. A live run keeps its total, and report.json keeps its fields; its schema now says that a rebuilt total counts only the screenshots read.

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - A screenshot that failed in one attempt of a retried test stays in the run report, as the last attempt that failed it left it, when a retry passes it or stops before it, and `whydiff report --from test-results` takes the same attempt. A screenshot whose test timed out during its assertion is listed under `## Not explained` with the test's timeout, not with the error the closing page threw.

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - A cause with a single element now names the CSS rule that changed it and how to restore it, as a cause of many elements already did. Its id is the rule's, so it stays the same however many elements change under the rule, in a shard of the run and on the test's own page.
- Updated dependencies [[`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0), [`6eda509`](https://github.com/rodindev/whydiff/commit/6eda509bdfbe2fb73fe3f0594620b3863ab8068e)]:
  - @whydiff/core@0.2.0
  - @whydiff/capture@0.2.0

## 0.1.0

### Minor Changes

- [`faf158c`](https://github.com/rodindev/whydiff/commit/faf158c23cfce70d9365fc8ad4b9a45ae09f5300) - First release. whydiff explains why a screenshot changed: which element, which CSS rule, which tests.

  `withWhydiff(test, expect)` keeps a `.whydiff.json` render-tree snapshot next to each baseline PNG and explains a failed `toHaveScreenshot` in its test: up to three lines in the error message, then where the rest is; a `whydiff` annotation with the first line and every cause id of the screenshot; and the full description as an attachment. On `@playwright/test` 1.60.0 and 1.61.0, where `withWhydiff` throws, `whydiffCapture` does the same after an explicit `toHaveScreenshot`, all but the lines in the error message. The reporter writes `whydiff-report/` (`report.md`, `report.json`, the run page `report.html`, a page per changed screenshot), clusters the causes of every failed screenshot of the run and, listed before `html`, puts the run's explanations into Playwright's HTML report.

  Requires Node 22.18.0 or later and `@playwright/test` 1.53.0 or later, Chromium projects.

### Patch Changes

- Updated dependencies [[`faf158c`](https://github.com/rodindev/whydiff/commit/faf158c23cfce70d9365fc8ad4b9a45ae09f5300)]:
  - @whydiff/capture@0.1.0
  - @whydiff/core@0.1.0
