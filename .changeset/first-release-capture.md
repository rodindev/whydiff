---
'@whydiff/capture': minor
---

First release. whydiff explains why a screenshot changed: which element, which CSS rule, which tests.

The snapshot, read from Chromium through the Chrome DevTools Protocol in the state the screenshot saw: every visible element's box, computed styles and accessibility role, the CSS rule that won each recorded property with its cascade layer, and the custom properties the winning declarations read.
