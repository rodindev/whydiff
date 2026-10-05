---
'@whydiff/core': patch
'@whydiff/capture': patch
---

A CSS Modules class name with many `__`, or a CSS value with a long run of spaces, no longer slows the analysis or the capture down: the patterns that read them took quadratic time and now run in linear time.
