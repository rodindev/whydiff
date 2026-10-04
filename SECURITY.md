# Security policy

## Supported versions

whydiff is at 0.x. Fixes go into the latest release only.

## Reporting a vulnerability

Report it privately through GitHub: [report a vulnerability](https://github.com/rodindev/whydiff/security/advisories/new). Please do not open a public issue.

The maintainer aims to answer within a week. Once a fix is released, the advisory is published and credits you, unless you prefer not to be named.

## Scope

whydiff runs on your machine or in CI with the rights of your test run. It reads the pages your tests open, opens in Chromium the pages you give `whydiff snap`, reads files in your project and writes snapshots and reports next to them. It has no telemetry and makes no network requests of its own.

Worth reporting: a crafted page, snapshot or report that makes whydiff write outside its output directories or run code, and anything that exposes data beyond the files whydiff writes. A page that misleads the report, a wrong cause for example, is a bug; open an issue for it.
