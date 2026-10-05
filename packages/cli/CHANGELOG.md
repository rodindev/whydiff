# whydiff

## 0.2.0

### Minor Changes

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - Every cause id changes once: the cluster rules are now version `k2`, as `tool.rules.cluster` in report.json says, because a CSS rule now names a cause even when a single element changed under it. `whydiff report --merge` refuses to join a report of 0.1 with one of 0.2, which would hold the same cause under two ids.

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - Every screenshot id the reporter and `whydiff report --from` write changes once: it is now a hash of the screenshot's project, test file, title path, repeat index and name instead of Playwright's internal test id, so the id a failed test prints is the one in the run's report and in the report `whydiff report --from test-results` rebuilds. `whydiff report --merge` orders the elements of a cause by the project, test file and title of their screenshots, as the run's reporter does.

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - `whydiff diff` of two runs recorded with `WHYDIFF_OUT` gives a screenshot that failed in the second run the id its test printed and that run's report gives it, so a failed screenshot has one id however it was compared; every other id of a two-run report stays as it was. The second run must be recorded with 0.2, whose manifest keeps the name Playwright gave the images of a failed screenshot. A screenshot that only one of the runs took is named by its title in the warning.

### Patch Changes

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - `whydiff explain <region id>` on the report of a Playwright run prints the region, its size, place and candidates, as the help and the README promise, where it stopped with an error. In place of crops it says where Playwright keeps the run's images, since whydiff crops only the pairs `whydiff diff` reads from disk.

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - `whydiff report --merge` keeps the elements of a cause on one screenshot in the order their shard's report gives them, the run's own order, so the shards of a run merge into the same report.json as the run itself, byte for byte. Before, it ordered them by locator and could name another element as the cause's example.

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - `whydiff report --from` reads a run with `--repeat-each` as the reporter does: each repeat is a test of its own and its retries are attempts of it, where 0.1 merged the repeats of a test and took a retried repeat for another test. Its progress line counts tests, not the directories of their attempts.

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - A report that `whydiff report --from` rebuilds says how many screenshots changed, not of how many, since test-results keep nothing of a passed screenshot: `128 screenshots changed` where it read `128 of 128 screenshots changed`, in report.md, the run page, the count line and the job summary. A live run keeps its total, and report.json keeps its fields; its schema now says that a rebuilt total counts only the screenshots read.

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - A screenshot that failed in one attempt of a retried test stays in the run report, as the last attempt that failed it left it, when a retry passes it or stops before it, and `whydiff report --from test-results` takes the same attempt. A screenshot whose test timed out during its assertion is listed under `## Not explained` with the test's timeout, not with the error the closing page threw.

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - The run page ends a cause of several elements with `all occurrences:` and its `explain` command, as report.md does, where it printed `every member:` under every cause. `whydiff explain <cause id>` leaves that line out, since it named the command just run.

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - A cause with a single element now names the CSS rule that changed it and how to restore it, as a cause of many elements already did. Its id is the rule's, so it stays the same however many elements change under the rule, in a shard of the run and on the test's own page.

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - `whydiff snap` stops with one line that says what to do when `--selector` matches several elements or none before Playwright's timeout, when `--wait-for` waits for an element that never comes, and when `--executable` or `WHYDIFF_CHROMIUM` names a file that does not exist, where it passed on Playwright's own error with its call log. Other errors from Playwright keep their text.
- Updated dependencies [[`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0), [`6eda509`](https://github.com/rodindev/whydiff/commit/6eda509bdfbe2fb73fe3f0594620b3863ab8068e)]:
  - @whydiff/core@0.2.0
  - @whydiff/playwright@0.2.0
  - @whydiff/capture@0.2.0

## 0.1.0

### Minor Changes

- [`faf158c`](https://github.com/rodindev/whydiff/commit/faf158c23cfce70d9365fc8ad4b9a45ae09f5300) - First release. whydiff explains why a screenshot changed: which element, which CSS rule, which tests.

  The command line. `init` and `doctor` set up and check a project; `explain` prints a cause, a screenshot or a region of the last report; `diff` compares two runs or two snaps; `snap` captures any page; `report` rebuilds a run's report from test-results or merges shards; `schema` prints the JSON schemas.

### Patch Changes

- Updated dependencies [[`faf158c`](https://github.com/rodindev/whydiff/commit/faf158c23cfce70d9365fc8ad4b9a45ae09f5300)]:
  - @whydiff/capture@0.1.0
  - @whydiff/core@0.1.0
  - @whydiff/playwright@0.1.0
