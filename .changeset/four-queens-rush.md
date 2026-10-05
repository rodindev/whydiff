---
'@whydiff/core': patch
---

Some very long class names, test ids, tag names and CSS keywords no longer slow the analysis down: the patterns that read them, which CodeQL flagged as polynomial, now run in linear time.
