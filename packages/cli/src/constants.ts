/** Groups of identical changes `explain` prints per cause before it names `--all` for the rest. */
export const EXPLAIN_MAX_GROUPS = 10

/** Members `explain` lists per group of identical changes before it counts the rest. */
export const EXPLAIN_MAX_LOCATORS = 3

/** Members `explain` lists for a cause without style changes (added, removed, content, scrolled, resized) before it counts the rest. */
export const EXPLAIN_MAX_MEMBERS = 10

/** PNG pixels added on every side of an unexplained region in its crops. */
export const CROP_MARGIN = 16

/** Viewport `snap` opens when `--viewport` is not given; Playwright's own default. */
export const DEFAULT_VIEWPORT: { readonly width: number; readonly height: number } = {
  width: 1280,
  height: 720,
}

/** Where `snap` writes and where `diff` looks a snap name up, relative to the current directory. */
export const SNAPS_DIR = '.whydiff/snaps'

/** Where `diff` and `report` write and where `explain` reads, when `--out` or `--report` is not given. */
export const REPORT_DIR = 'whydiff-report'

/** Exit code of `diff --exit-code` when a screenshot changed. */
export const EXIT_CHANGED = 1

/** Exit code of every error and of `doctor` with a failed check. */
export const EXIT_ERROR = 2

/** Directory names a project walk never enters. */
export const SKIPPED_DIRS: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'test-results',
  'playwright-report',
  'blob-report',
  'whydiff-report',
  'whydiff-results',
  '.whydiff',
]

/** Directory levels under the project root a walk descends into. */
export const WALK_MAX_DEPTH = 8

/** Lowest `@playwright/test` the matcher supports; `doctor` fails below it. */
export const MIN_PLAYWRIGHT = '1.53.0'

/** Lowest Node the packages support, the floor of `engines`; `doctor` warns below it. */
export const MIN_NODE = '22.18.0'
