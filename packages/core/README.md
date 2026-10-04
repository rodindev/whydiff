# @whydiff/core

Matches two render-tree snapshots, finds the cause of each changed pixel region and groups causes by CSS rule. No browser, no model, no I/O.

Part of [whydiff](https://github.com/rodindev/whydiff#readme). Most projects install `@whydiff/playwright` and `whydiff`, which bring this package with them; use it directly to analyse snapshots in your own tooling. The `diff` command of the CLI is a complete example: [`packages/cli/src/commands/diff.ts`](https://github.com/rodindev/whydiff/blob/main/packages/cli/src/commands/diff.ts).

The package has no dependencies and does no I/O. It takes parsed snapshots and decoded PNGs and returns the report, the same bytes for the same input.

## API

The pipeline, stage by stage:

1. `diffMask`, `diffRegions`: the pixels Playwright counts as different, by its pixelmatch math, and the regions they form.
2. `matchSnapshots`: pairs the elements of the two snapshots.
3. `computeDeltas`: what changed on each pair.
4. `explainChanges`: the cause of each changed region.
5. `clusterCauses`: the causes of every screenshot of a run, grouped by the rule or the change they share.
6. `buildReport`: the report, which `renderReport`, `renderScreenshot` and `renderRunPage` print as Markdown and HTML.

`analyzeScreen` runs stages 1 to 4 for one pair of screenshots. `parseSnapshot`, `serializeSnapshot`, `parseReport`, `validateReport` and `serializeReport` read and write the formats; `SNAPSHOT_FORMAT_VERSION`, `REPORT_FORMAT_VERSION` and the types (`SnapshotV1`, `ReportV1` and their parts) describe them, and `locatorFor` turns a snapshot node into a Playwright locator. Bad input throws `WhydiffError`. The other exports are the pieces of text the CLI and the Playwright reporter build their output from.

Both formats have a JSON schema, also reachable by package path:

- `@whydiff/core/schema/snapshot-v1.schema.json`, the `.whydiff.json` snapshot;
- `@whydiff/core/schema/report-v1.schema.json`, `report.json`.

## License

MIT
