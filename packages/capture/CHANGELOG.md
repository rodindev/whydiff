# @whydiff/capture

## 0.2.0

### Patch Changes

- [#3](https://github.com/rodindev/whydiff/pull/3) [`6eda509`](https://github.com/rodindev/whydiff/commit/6eda509bdfbe2fb73fe3f0594620b3863ab8068e) - A CSS Modules class name with many `__`, or a CSS value with a long run of spaces, no longer slows the analysis or the capture down: the patterns that read them took quadratic time and now run in linear time.
- Updated dependencies [[`62c6367`](https://github.com/rodindev/whydiff/commit/62c6367c25710781039598065577ad60bafb79f0), [`6eda509`](https://github.com/rodindev/whydiff/commit/6eda509bdfbe2fb73fe3f0594620b3863ab8068e)]:
  - @whydiff/core@0.2.0

## 0.1.0

### Minor Changes

- [`faf158c`](https://github.com/rodindev/whydiff/commit/faf158c23cfce70d9365fc8ad4b9a45ae09f5300) - First release. whydiff explains why a screenshot changed: which element, which CSS rule, which tests.

  The snapshot, read from Chromium through the Chrome DevTools Protocol in the state the screenshot saw: every visible element's box, computed styles and accessibility role, the CSS rule that won each recorded property with its cascade layer, and the custom properties the winning declarations read.

### Patch Changes

- Updated dependencies [[`faf158c`](https://github.com/rodindev/whydiff/commit/faf158c23cfce70d9365fc8ad4b9a45ae09f5300)]:
  - @whydiff/core@0.1.0
