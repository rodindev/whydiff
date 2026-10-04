# @whydiff/capture

## 0.1.0

### Minor Changes

- [`faf158c`](https://github.com/rodindev/whydiff/commit/faf158c23cfce70d9365fc8ad4b9a45ae09f5300) - First release. whydiff explains why a screenshot changed: which element, which CSS rule, which tests.

  The snapshot, read from Chromium through the Chrome DevTools Protocol in the state the screenshot saw: every visible element's box, computed styles and accessibility role, the CSS rule that won each recorded property with its cascade layer, and the custom properties the winning declarations read.

### Patch Changes

- Updated dependencies [[`faf158c`](https://github.com/rodindev/whydiff/commit/faf158c23cfce70d9365fc8ad4b9a45ae09f5300)]:
  - @whydiff/core@0.1.0
