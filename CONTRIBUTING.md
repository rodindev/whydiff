# Contributing to whydiff

Bug reports, ideas and pull requests are welcome. Before a change to `report.json`, the snapshot format, a CLI flag or an output line, open an issue so the shape is agreed before the code. Questions go to [Discussions](https://github.com/rodindev/whydiff/discussions).

The rules every change follows, for people and coding agents alike, are in [AGENTS.md](AGENTS.md). This file is the practical part.

## Setup

You need Node 24 (`.node-version`; the packages support 22.18.0 and later) and pnpm 11 (`npm i -g pnpm@11`).

```sh
git clone https://github.com/rodindev/whydiff.git
cd whydiff
pnpm install
pnpm browsers
pnpm check
```

- `pnpm install` also installs the git hook, which runs ESLint and Prettier on the staged files.
- `pnpm browsers` downloads the Chromium headless shell that the browser specs drive, once per machine. Where Playwright cannot download browsers, set `WHYDIFF_CHROMIUM` to a Chromium binary instead.
- `pnpm check` is the gate CI runs: lint, format check, typecheck, build and tests. A pull request is ready when it passes.

`pnpm test:run <path>` runs one spec, and `pnpm test` watches. The core's specs need no browser.

## Golden files

Reports, explanations and pages are compared byte for byte with files under `packages/*/fixtures/`, through Vitest's `toMatchFileSnapshot`. `pnpm test:run -u <path>` rewrites the ones its specs check. Read every rewritten line as a change of behaviour, and say so in the pull request.

The README's example is one of them: `packages/cli/src/readme.spec.ts` holds it equal to what `whydiff diff` prints for `packages/cli/fixtures/readme`. After a change to the capture, `pnpm build && node scripts/readme-example.ts` captures that fixture again. The README's pictures are not checked by a spec: after a change to what a failed test, `explain`, the run page or Playwright's HTML report shows, `pnpm build && node scripts/readme-figure.ts` rebuilds all of them, light and dark, in `docs/images/` from one Playwright run of the same fixture.

Fixtures stay small and neutral: `ui-` classes, `app.css`, generic labels, nothing from a real product.

## Pull requests

- One change per pull request. A logic change comes with a test that fails without it; a bug fix starts with that test.
- The title becomes the commit on `main`: a lowercase conventional commit of at most 72 characters, such as `fix(capture): clip from the containing block`. Scopes: `core`, `capture`, `playwright`, `cli`, `report`, `docs`, `deps`, `ci`, `release`, and `config` for Renovate's config migrations.
- A change users will notice adds a changeset: `pnpm changeset`.
- The description is two or three short paragraphs of plain prose: what changed, why, and how you checked it.

## Coding agents

whydiff is developed with coding agents, and `AGENTS.md` is written for them as much as for people. A pull request written with an agent is welcome on the same terms as any other: you have read the diff, `pnpm check` passes, and you can answer questions about it.
