---
'@whydiff/playwright': minor
'whydiff': minor
---

Every screenshot id changes once: it is now a hash of the screenshot's project, test file, title path, repeat index and name instead of Playwright's internal test id, so the id a failed test prints is the one in the run's report and in the report `whydiff report --from test-results` rebuilds. `whydiff report --merge` orders the elements of a cause as the run's reporter does, so merged shards give the same report.json as one run.
