---
'@whydiff/core': minor
'@whydiff/playwright': minor
'whydiff': minor
---

Every cause id changes once: the cluster rules are now version `k2`, as `tool.rules.cluster` in report.json says, because a CSS rule now names a cause even when a single element changed under it. `whydiff report --merge` refuses to join a report of 0.1 with one of 0.2, which would hold the same cause under two ids.
