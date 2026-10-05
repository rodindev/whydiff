---
'whydiff': patch
---

`whydiff snap` stops with one line that says what to do when `--selector` matches several elements or none before Playwright's timeout, when `--wait-for` waits for an element that never comes, and when `--executable` or `WHYDIFF_CHROMIUM` names a file that does not exist, where it passed on Playwright's own error with its call log. Other errors from Playwright keep their text.
