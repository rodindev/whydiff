---
'@whydiff/playwright': minor
'whydiff': minor
---

Every screenshot id the reporter and `whydiff report --from` write changes once: it is now a hash of the screenshot's project, test file, title path, repeat index and name instead of Playwright's internal test id, so the id a failed test prints is the one in the run's report and in the report `whydiff report --from test-results` rebuilds. `whydiff report --merge` orders the elements of a cause by the project, test file and title of their screenshots, as the run's reporter does.
