# @whydiff/core

## 0.2.0

### Minor Changes

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - Every cause id changes once: the cluster rules are now version `k2`, as `tool.rules.cluster` in report.json says, because a CSS rule now names a cause even when a single element changed under it. `whydiff report --merge` refuses to join a report of 0.1 with one of 0.2, which would hold the same cause under two ids.

### Patch Changes

- [#3](https://github.com/rodindev/whydiff/pull/3) [`6eda509`](https://github.com/rodindev/whydiff/commit/6eda509bdfbe2fb73fe3f0594620b3863ab8068e) - Some very long class names, test ids, tag names and CSS keywords no longer slow the analysis down: the patterns that read them, which CodeQL flagged as polynomial, now run in linear time.

- [#3](https://github.com/rodindev/whydiff/pull/3) [`6eda509`](https://github.com/rodindev/whydiff/commit/6eda509bdfbe2fb73fe3f0594620b3863ab8068e) - A CSS Modules class name with many `__`, or a CSS value with a long run of spaces, no longer slows the analysis or the capture down: the patterns that read them took quadratic time and now run in linear time.

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - A report that `whydiff report --from` rebuilds says how many screenshots changed, not of how many, since test-results keep nothing of a passed screenshot: `128 screenshots changed` where it read `128 of 128 screenshots changed`, in report.md, the run page, the count line and the job summary. A live run keeps its total, and report.json keeps its fields; its schema now says that a rebuilt total counts only the screenshots read.

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - The run page ends a cause of several elements with `all occurrences:` and its `explain` command, as report.md does, where it printed `every member:` under every cause. `whydiff explain <cause id>` leaves that line out, since it named the command just run.

- [#5](https://github.com/rodindev/whydiff/pull/5) [`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0) - A cause with a single element now names the CSS rule that changed it and how to restore it, as a cause of many elements already did. Its id is the rule's, so it stays the same however many elements change under the rule, in a shard of the run and on the test's own page.

## 0.1.0

### Minor Changes

- [`faf158c`](https://github.com/rodindev/whydiff/commit/faf158c23cfce70d9365fc8ad4b9a45ae09f5300) - First release. whydiff explains why a screenshot changed: which element, which CSS rule, which tests.

  The analysis, deterministic and without I/O: Playwright's pixelmatch math, element matching, per-element changes, causes and their clusters across the run, and the report as JSON, Markdown and HTML. The snapshot and the report are format v1, each with a JSON schema.
