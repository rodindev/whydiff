/** Milliseconds per assertion, from the built-in's end or the explicit call's start, for its one capture plus the analysis and writes; the test's timeout grows by it while whydiff works, and past it the rest is skipped with an annotation. */
export const CAPTURE_BUDGET_MS = 60000

/** Failing screenshots of each project in a run that get their Markdown in the test; a fuse for runs where almost everything fails, whose rest the reporter explains when the run ends. */
export const MAX_EXPLAINED = 500

/** Lines of what changed that a failed assertion's message carries before it says where the rest are. */
export const MESSAGE_LINES = 3
/** Prefix of every attachment whydiff adds to a test. */
export const ATTACHMENT_PREFIX = 'whydiff/'

/** Directory the reporter writes to, next to the Playwright config, when no `outputDir` is given. */
export const REPORT_DIR = 'whydiff-report'

/** Releases on which any override of `toHaveScreenshot` recurses into the root expect. */
export const EXCLUDED_PLAYWRIGHT: readonly string[] = ['1.60.0', '1.61.0']

/** Regions listed one per line when a failure is described by its pixels alone. */
export const MAX_LISTED_REGIONS = 20
