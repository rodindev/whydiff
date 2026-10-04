# @whydiff/playwright

## 0.1.0

### Minor Changes

- [`faf158c`](https://github.com/rodindev/whydiff/commit/faf158c23cfce70d9365fc8ad4b9a45ae09f5300) - First release. whydiff explains why a screenshot changed: which element, which CSS rule, which tests.

  `withWhydiff(test, expect)` keeps a `.whydiff.json` render-tree snapshot next to each baseline PNG and explains a failed `toHaveScreenshot` in its test: up to three lines in the error message, then where the rest is; a `whydiff` annotation with the first line and every cause id of the screenshot; and the full description as an attachment. On `@playwright/test` 1.60.0 and 1.61.0, where `withWhydiff` throws, `whydiffCapture` does the same after an explicit `toHaveScreenshot`, all but the lines in the error message. The reporter writes `whydiff-report/` (`report.md`, `report.json`, the run page `report.html`, a page per changed screenshot), clusters the causes of every failed screenshot of the run and, listed before `html`, puts the run's explanations into Playwright's HTML report.

  Requires Node 22.18.0 or later and `@playwright/test` 1.53.0 or later, Chromium projects.

### Patch Changes

- Updated dependencies [[`faf158c`](https://github.com/rodindev/whydiff/commit/faf158c23cfce70d9365fc8ad4b9a45ae09f5300)]:
  - @whydiff/capture@0.1.0
  - @whydiff/core@0.1.0
