---
'whydiff': patch
---

`whydiff report --from` keeps each repeat of `--repeat-each` apart and folds a test's retries into it, where it took a retried repeat for a test of its own, and its progress line counts tests, not the directories of their attempts.
