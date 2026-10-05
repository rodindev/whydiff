---
'@whydiff/playwright': minor
'whydiff': minor
---

`whydiff diff` of two runs recorded with `WHYDIFF_OUT` gives a screenshot that failed in the second run the id its test printed and that run's report gives it, so a failed screenshot has one id however it was compared; every other id of a two-run report stays as it was. The second run must be recorded with 0.2, whose manifest keeps the name Playwright gave the images of a failed screenshot. A screenshot that only one of the runs took is named by its title in the warning.
