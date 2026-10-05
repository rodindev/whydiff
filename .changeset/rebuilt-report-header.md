---
'@whydiff/core': patch
'@whydiff/playwright': patch
'whydiff': patch
---

A report that `whydiff report --from` rebuilds says how many screenshots changed, not of how many, since test-results keep nothing of a passed screenshot: `128 screenshots changed` where it read `128 of 128 screenshots changed`, in report.md, the run page, the count line and the job summary. A live run keeps its total, and report.json keeps its fields; its schema now says that a rebuilt total counts only the screenshots read.
