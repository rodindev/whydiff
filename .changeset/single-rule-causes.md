---
'@whydiff/core': patch
'@whydiff/playwright': patch
'whydiff': patch
---

A cause with a single element now names the CSS rule that changed it and how to restore it, as a cause of many elements already did. Its id is the rule's, so it stays the same however many elements change under the rule, in a shard of the run and on the test's own page.
