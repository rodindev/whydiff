---
'whydiff': patch
---

`whydiff report --from` reads a run with `--repeat-each` as the reporter does: each repeat is a test of its own and its retries are attempts of it, where 0.1 merged the repeats of a test and took a retried repeat for another test. Its progress line counts tests, not the directories of their attempts.
