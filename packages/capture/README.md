# @whydiff/capture

Captures a whydiff render-tree snapshot from Chromium, for Playwright: DOM, layout, computed styles, roles, winning CSS rules.

Part of [whydiff](https://github.com/rodindev/whydiff#readme). In a Playwright test, [`@whydiff/playwright`](https://www.npmjs.com/package/@whydiff/playwright) calls it next to every screenshot assertion, and `whydiff snap` calls it for any page; use it directly to snapshot a page from your own Playwright code.

`captureSnapshot(page, options)` takes the options the screenshot was taken with and returns the snapshot that [`@whydiff/core`](https://www.npmjs.com/package/@whydiff/core) compares. Chromium only: it reads the page through the Chrome DevTools Protocol. `playwright-core` is an optional peer for its types; the package never imports it at runtime.

## License

MIT
