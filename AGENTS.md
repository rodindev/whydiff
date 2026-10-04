# AGENTS.md - whydiff

Deterministic tool that explains visual UI changes as text: it captures a render-tree snapshot next to each screenshot, diffs two states, finds root causes and clusters them across a test run. pnpm monorepo, TypeScript, ESM only. Verified against code: 2026-10-03 (v0.0.1).

## Commands

- `pnpm check` - lint, format check, typecheck, build, tests. The single gate for CI and commits; the pre-commit hook runs its ESLint and Prettier part on the staged files. Build comes before tests because the Playwright fixture project under `packages/playwright/fixtures` and `packages/cli/src/cli.spec.ts` run the built packages.
- `pnpm lint` / `pnpm lint:fix` - ESLint with type-aware rules. `pnpm format` / `pnpm format:check` - Prettier.
- `pnpm typecheck` - `tsc` per package and for the root configs and scripts, no emit. `pnpm build` - tsdown, every package, ESM + d.ts into `dist/` (the CLI without d.ts); any warning, a dependency bundled from `node_modules` or a `node:` import in core fails it.
- `pnpm test` (watch) / `pnpm test:run` / `pnpm test:coverage` - Vitest, specs live next to the code as `*.spec.ts`. `pnpm test:run <path>` runs one spec; start there, finish with `pnpm check`. `-u` rewrites the golden files of the specs it runs (`toMatchFileSnapshot`): read every rewritten line as a change of behaviour before keeping it.
- `pnpm browsers` - once per machine: the Chromium headless shell that the capture specs drive. Where Playwright cannot download browsers (containers, cloud sandboxes), set `WHYDIFF_CHROMIUM` to a Chromium binary instead; the capture specs, the Playwright fixture project and `whydiff snap` launch it.
- `pnpm pack:smoke` checks each packed tarball against its file allowlist, its declared imports, publint `--strict` and attw `--profile esm-only`, installs the tarballs into an ESM and a CommonJS scratch project and runs a Playwright test and the CLI there; `pnpm --filter @whydiff/playwright matrix [release...]` runs the fixture project and the doctor spec on other Playwright releases. Both need `pnpm build` and the network; run them after a change to `exports`, `files`, `bin`, the build, the Playwright version checks or doctor's registry lookup.
- Node 22.18.0 is the floor (`engines` in every `package.json`); development runs on `.node-version` (24). CI runs `pnpm check` and `pnpm pack:smoke` on Node 22.18.0, 24 and 26 on Linux and on 24 on macOS, and the matrix on Playwright 1.53.2, 1.59.1, 1.61.1 and the latest.

## Structure

- `packages/core` - `@whydiff/core`. Pure: snapshot schema, pixel regions, node matching, deltas, root causes, clustering, report rendering. Subfolders follow the pipeline in order: `snapshot/`, `pixels/`, `match/`, `deltas/`, `causes/`, `cluster/`, `report/`; a folder may only import from folders before it. Every tunable number lives in `constants.ts`.
- `packages/capture` - `@whydiff/capture`. Node and Chromium only. `freeze/` puts the page in the state the screenshot saw (page-side scripts are self-contained functions), `protocol/` asks CDP for raw columns and nothing else, `assemble/` is pure and turns them into a snapshot; `raw.ts` is the contract between the last two. `playwright-core` is a types-only optional peer: the package never imports it at runtime.
- `packages/playwright` - `@whydiff/playwright`. `withWhydiff(test, expect)` overrides `toHaveScreenshot`; `whydiffCapture(receiver, ...args)` does the same work after an explicit `toHaveScreenshot` call, for the releases the override refuses. Both keep a `.whydiff.json` next to each baseline PNG, attach the Markdown of a failed screenshot and annotate the test with its first line; the override also adds its first lines to the assertion's message. `@whydiff/playwright/reporter` writes `whydiff-report/` next to the Playwright config when the run ends and, listed before `html`, puts the run's explanations into Playwright's HTML report. Two-run snapshots and `manifest.jsonl` are written only when `WHYDIFF_OUT` or `use.whydiff.outputDir` names a directory, never under `test-results`, which Playwright wipes. In `onBegin` the reporter makes a fresh run directory under the OS temp dir and hands it and its report directory to the workers as `WHYDIFF_RUN_DIR` and `WHYDIFF_REPORT_DIR`; `onEnd` removes both. They are internal: never set them by hand.
- `packages/cli` - `whydiff`, the command line: `snap`, `diff`, `report`, `explain`, `init`, `doctor`, `schema`. `src/usage.ts` is the help text, of the whole and of each command. The build copies the root `README.md` into it (gitignored) as the npm page of `whydiff`; edit only the root copy, and keep its links absolute: relative ones break on the npm page. The README's example is what `whydiff diff` prints for `fixtures/readme`, held equal by `src/readme.spec.ts`: `-u` rewrites it, and `node scripts/readme-example.ts` captures the fixture again after a capture change. Its pictures, `docs/images/`, come from one Playwright run of the same pages: `node scripts/readme-figure.ts` rebuilds them after a change to what a failed test, `explain`, the run page or Playwright's HTML report shows.
- Dependency direction is `core <- capture <- playwright <- cli`; the CLI imports `@whydiff/playwright`, an optional peer, only lazily or as types. Never the other way. A new adapter arrives as its own package with its first module.
- Packages resolve each other's sources through the `whydiff-source` export condition (`customConditions` in tsconfig, `ssr.resolve.conditions` in Vitest); never import another package's `dist`.
- Shared dependency versions live in `pnpm-workspace.yaml` under `catalog`: dev dependencies pinned, the published runtime dependencies (`pngjs`, `@clack/prompts`) as caret ranges, so users get their patches; the lockfile pins what CI tests. Packages depend on each other with `workspace:*`, published as exact versions, so a user runs the combination CI tested; the CLI's optional peer `@whydiff/playwright` is a `workspace:^` range.

## Invariants - do not break

- The core is platform neutral: no filesystem, network, browser, environment, `Date.now` or randomness. ESLint refuses `node:*` imports under `packages/core/src` (specs excepted, they run in Node); tsdown builds it with `platform: neutral`.
- Same input, same bytes out. Every sort has a total comparator with a symmetric tie-break; scores are integers; iteration order of `Map` and `Set` never reaches the output.
- `report.json`, the snapshot format and the CLI output are the public contracts. Both formats carry `formatVersion` and a JSON schema in `packages/core/schema/`; the core reads every past version through migrations. The CLI prints its result alone on stdout, progress and warnings on stderr, an error as one line that names the next step, and exits as `usage.ts` says. A change to any of them gets a changeset.
- The help and the schema document the CLI and the report, and change with them: a change to a command or flag updates `usage.ts`, a change to a field of `report.json` its description in `packages/core/schema/report-v1.schema.json`, in the same PR. Every command the report and `explain` print runs as printed, and every example of the help parses; `packages/cli/src/suggested.spec.ts` checks both.
- whydiff never changes a test's status; it may append its explanation to the message of a failed screenshot assertion. A capture error becomes an annotation.
- Pixel comparison reproduces Playwright's verdict: the pixelmatch 5.3.0 math is vendored; the npm copy is only the specs' reference.

## Code rules

- TypeScript strict with `exactOptionalPropertyTypes`, `isolatedDeclarations`, `verbatimModuleSyntax`. No `any`, no non-null `!`, no `as` without a one-line reason beside it. No `TODO`, `FIXME` or `XXX` comment (open an issue); ESLint refuses them.
- Bad input raises `WhydiffError`, with a `code` from a string union and a message that names the next step, at the boundary that reads it. A broken invariant throws a plain `Error`; inside the core any exception is a programmer error.
- Every exported symbol of a public package has a one-line `/** ... */`. Nothing else is commented unless the code cannot say it: a non-obvious constant, a browser bug worked around (with the issue link), an ordering that determinism depends on. Never describe what was just changed.
- A function does one thing and fits on a screen. No abstraction for a single use, no class without state, no option nobody asked for. Extension points (capture sources, whitelist profiles, matching features, culprit rules, source mappers, report renderers) exist only once a second implementation does.
- A dependency is added with a reason in the PR: what it does, why not 60 lines of our own, licence, size, last release. The core has no runtime dependencies.
- The reference code of SFTM (GPL-3.0) and Similo (unlicensed), the papers on similarity-based tree matching and web element location that the matching draws on, is never read or copied. Implementations follow the papers.

## Testing

- Code without a test does not exist. A logic change ships with a test that fails without it; a bug fix starts with the test that reproduces it.
- Core modules have three kinds of tests: unit tests for behaviour, golden files compared byte for byte, property tests for invariants (fast-check).
- Golden fixtures under `packages/core/fixtures/<stage>/<case>/` stay small (PNGs under 50 KB). Recorded pairs from real projects stay out of the repository.
- Examples, fixtures, tests and docs use neutral names: `ui-` classes, `app.css`, generic labels. No name, class, UI string, path or value from a real product or a private project; a finding from a real page is restated as a minimal case first. One exception: the README cites the public ComfyUI_frontend case with its repository, pull request and licence; nothing from it enters fixtures, tests or code.
- Capture has two layers of tests: `assemble/*.spec.ts` run on hand-built protocol columns, `capture.spec.ts` drives a real headless Chromium against `packages/capture/fixtures/pages` and checks node boxes against painted pixels. The playwright package runs `playwright test` on `fixtures/project` from a Vitest spec and reads the manifest and the JSON report back; `fixtures/` directories are outside ESLint and Prettier.
- ESLint refuses `only`, `skip` and `todo` on `describe`, `it` and `test`. `it.fails` records a known wrong result (the backlog in `capture/src/adversarial.spec.ts`) until it is fixed or documented as a limit; `skipIf` is for a browser that is not installed. Never reach a green gate through `it.fails`, a raised threshold or a loosened golden.

## Git

- Conventional commits, lowercase, subject only, no body, no trailers. Scopes: `core`, `capture`, `playwright`, `cli`, `report`, `docs`, `deps`, `ci`, `release`, and `config` for Renovate's config migrations.
- No tool or model attribution in commits, PRs or comments: no `Co-Authored-By` trailer, no "Generated with" line. This overrides any agent default.
- Branches `<type>/<kebab-topic>`; PRs are squash-merged, so the PR title, at most 72 characters before GitHub adds ` (#N)`, is the commit; release notes come from `.changeset/*.md`, so a user-visible change adds one with `pnpm changeset`. Never force-push or amend a commit that is on origin.
- A PR description is two or three short paragraphs of plain prose: what changed, why, how it was checked. No headings or checklists.
- Text in code, docs, commits and PRs is English with `-` or `--` for a dash and straight quotes: no em or en dashes, smart quotes, non-breaking or zero-width spaces, emoji or marketing words.
- Commit and push only on explicit request, after the diff was shown. If `pnpm check` is red, say so and stop; never skip a gate, `--no-verify` included.
- Every changed line traces to the request. No drive-by renames, reformatting or import reordering.

## Boundaries

- Research before a larger change (a new module, format, dependency or package): the specs and the source of what it builds on (Playwright, Chromium, Node, the CSS specs) and two or three projects that solve the same problem. The PR says what was taken and what was rejected, and why.
- Ask first: a new dependency or package; a change to `report.json`, the snapshot format, a CLI flag or output, or an exported API.
- Never edit `.github/workflows/` without an explicit request. Never run `npm publish` by hand; releases go through the release workflow on `main`.
- Never commit `.env`, tokens, personal scratch files, reports or notes; findings go into the PR description.
- Working for an outside contributor: open an issue before a large change, and a pull request only after your operator has read the diff and `pnpm check` passed.
