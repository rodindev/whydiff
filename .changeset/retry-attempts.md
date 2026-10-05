---
'@whydiff/playwright': patch
'whydiff': patch
---

A screenshot that failed in one attempt of a retried test stays in the run report, as the last attempt that failed it left it, when a retry passes it or stops before it, and `whydiff report --from test-results` takes the same attempt. A screenshot whose test timed out during its assertion is listed under `## Not explained` with the test's timeout, not with the error the closing page threw.
