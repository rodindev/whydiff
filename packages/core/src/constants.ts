/** Side of the grid cell, in pixels, that groups differing pixels into regions. */
export const REGION_GRID_CELL = 8

/** Above this many regions in one image the change counts as a mass change. */
export const MAX_REGIONS = 200

/** Above this share of differing pixels the change counts as a mass change. */
export const MASS_DIFF_RATIO = 0.3

/** Shortest and longest last segment of a sheet's file name that reads as a bundler's content hash; 64 is a SHA-256 hex digest (Sprockets, Hugo). */
export const SHEET_HASH_LENGTH = { min: 6, max: 64 } as const

/** Length of Rollup's default `[name]-[hash]` hash, whose alphabet includes `-`, so it can span segments. */
export const ROLLUP_HASH_LENGTH = 8

/** Segments after a content hash that a sheet's name is read past: Create React App's `.chunk.css`, a minified `.min.css`. */
export const SHEET_HASH_SUFFIXES: readonly string[] = ['chunk', 'min']

/** Longest `text` and `name` a snapshot carries per node; similarity never looks further. */
export const TEXT_LIMIT = 80

/** Own text shorter than this never anchors a node by itself. */
export const TEXT_ANCHOR_MIN_LEN = 3

/** A single-child chain this deep may be skipped to pair a wrapper's descendant. */
export const WRAPPER_MAX_DEPTH = 2

/** A wrapper whose box equals its only box-bearing child's within this many px is skippable. */
export const WRAPPER_BOX_TOL = 0.5

/** Child lists whose product exceeds this many LCS cells are aligned positionally instead. */
export const LCS_MAX_CELLS = 4_000_000

/** Matched descendants a free sibling needs, all inside one free sibling across, before pass 2 follows them. */
export const DESCENDANT_VOTES_MIN = 1

/** Halo around a diff region, in CSS px, inside which pass-3 candidates are taken. */
export const REGION_MARGIN = 200

/** Pass-3 score (per million) under which two nodes are not paired; a calibration constant. */
export const MATCH_THRESHOLD_Q = 550_000

/** Pass-3 score gap (per million) under which a competing candidate makes a pair ambiguous. */
export const AMBIGUITY_MARGIN_Q = 50_000

/** Pass-3 feature weights per mille: stable features count three times as much as weak ones. */
export const MATCH_WEIGHTS = {
  tag: 1500,
  role: 1500,
  nameText: 1500,
  classJaccard: 500,
  iou: 500,
  sizeRatio: 500,
  shape: 500,
  ancestors: 500,
  siblingIndex: 500,
  frame: 500,
} as const

/** Geometry within this many CSS px counts as unchanged; one layout unit. */
export const GEOM_EQ_TOL: number = 1 / 64

/** Size changes below this many CSS px are not reported as content changes. */
export const GEOM_REPORT_TOL = 0.5

/** A displacement or size delta explains another when they agree within this many CSS px. */
export const VEC_TOL = 0.5

/** Decimals a normalized computed number keeps. */
export const VALUE_DECIMALS = 4

/** Line-height to font-size ratios closer than this count as the same ratio. */
export const LINE_HEIGHT_RATIO_TOL = 0.01

/** Recorded longhands whose computed lengths a declaration in em scales with the element's font-size, printed in px; border and outline widths snap to device pixels and a transform reads as a matrix, so they are left out. */
export const FONT_SCALED_PROPS: readonly string[] = [
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'flex-basis',
  'row-gap',
  'column-gap',
  'letter-spacing',
  'text-shadow',
  'background-image',
  'box-shadow',
  'filter',
  'backdrop-filter',
  'clip-path',
  'mask-image',
]

/** Share by which a length may miss its old value times the font-size ratio and still follow the font; Chromium prints six significant digits. */
export const FONT_SCALE_TOL = 0.001

/** Whitelisted properties whose computed value inherits, per the mdn/data `inherited` flag. */
export const INHERITED_PROPS: readonly string[] = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'white-space',
  'text-shadow',
  'color',
  'visibility',
  'direction',
]

/** Relative difference under which two components of a transform matrix count as equal: Chromium prints six significant digits, and a composed matrix carries that rounding through each product. */
export const TRANSFORM_TOL = 1e-4

/** Properties that are not inherited but paint through every descendant. */
export const PAINTING_PROPS: readonly string[] = [
  'opacity',
  'transform',
  'translate',
  'rotate',
  'scale',
  'text-decoration-line',
  'background-color',
  'visibility',
  'filter',
  'mask-image',
  'clip-path',
  'mix-blend-mode',
]

/** Candidates listed for a region or a shift group that no rule explained. */
export const MAX_CANDIDATES = 3

/** Own changes on a parent that move or resize every child: the container rule blames the parent. */
export const CONTAINER_PROPS: readonly string[] = [
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'row-gap',
  'column-gap',
  'justify-content',
  'align-items',
  'flex-direction',
  'flex-wrap',
  'grid-template-columns',
  'grid-template-rows',
  'text-align',
  'direction',
  'display',
]

/** Own changes that reorder painting without moving anything. */
export const PAINT_ORDER_PROPS: readonly string[] = [
  'contain',
  'z-index',
  'position',
  'transform',
  'translate',
  'rotate',
  'scale',
  'opacity',
  'display',
]

/** `justify-content` values under which a flex row still lays out in flow order. */
export const FLOW_START_JUSTIFY: readonly string[] = ['normal', 'flex-start', 'start']

/** Bumped whenever a cluster key rule or the component chain changes; part of every key. */
export const CLUSTER_RULES_VERSION = 'k1'

/** Causes needed under one key of levels 1 to 3 before it becomes a cluster at that level; a rule at level 0 needs one. */
export const CLUSTER_MIN_MEMBERS = 2

/** Length deltas in cluster keys are rounded to this many CSS px. */
export const CLUSTER_LENGTH_STEP = 0.5

/** Classes of one namespace, none extending another, that one element carries before the namespace reads as utilities; used when a snapshot recorded no rules. */
export const UTILITY_PREFIX_MIN_NAMES = 2

/** Captured longhands a class's own single-class rule sets at most and still reads as a utility: one box shorthand (margin, padding, border width, radius) expands to four. */
export const UTILITY_MAX_LONGHANDS = 4

/** Diff regions under this many PNG pixels of area are reported as anti-aliasing. */
export const TINY_REGION_AREA = 4

/** Side in CSS px of the square inside the bottom border corner where Chromium paints a resizer; its headless overlay-scrollbar size. */
export const RESIZER_CORNER = 15

/** Text and spacing properties: changed alone on an element whose box stayed put, they cannot paint its resizer. */
export const TEXT_SPACING_PROPS: readonly string[] = [
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'text-decoration-line',
  'text-overflow',
  'white-space',
  'direction',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'box-sizing',
]

/** Causes rendered in full before the Markdown truncates to a count and a command. */
export const REPORT_MAX_CLUSTERS = 20

/** Share of a cause's members a fact must hold for before the cause's headline states it about the run. */
export const HEADLINE_MIN_SHARE = 0.5

/** Kinds of element a headline names one by one ("buttons, tabs and links"); more read as "elements". */
export const HEADLINE_NOUNS = 3

/** Properties a headline names one by one when no fact holds for enough members ("padding and margin changed on"); more read as "and N more properties". */
export const HEADLINE_PROPS = 3

/** Captured longhands that repaint an element without moving or resizing a box, so a cause made of them alone never explains a size or a move. */
export const PAINT_ONLY_PROPS: readonly string[] = [
  'color',
  'background-color',
  'background-image',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'outline-style',
  'outline-width',
  'outline-offset',
  'box-shadow',
  'text-shadow',
  'filter',
  'backdrop-filter',
  'opacity',
  'visibility',
  'mix-blend-mode',
  'clip-path',
  'mask-image',
  'text-decoration-line',
]

/** Causes the run summary at the top of a report lists at most: the most impactful, up to the last that adds a screenshot they appear on or one they settle. */
export const RUN_SUMMARY_CAUSES = 5

/** Distinct old values a restore line names before it says "the old values"; more no longer fit one clause. */
export const RESTORE_MAX_VALUES = 2

/** Longest own text used in a getByText locator suggestion. */
export const LOCATOR_TEXT_LIMIT = 40

/** What an observation can say about an element, in the order its line says it: what a person notices first, a move last. */
export const OBSERVATION_FACTS = [
  'appears',
  'gone',
  'visible',
  'invisible',
  'width',
  'height',
  'text',
  'font-size',
  'font-weight',
  'letter-spacing',
  'line-height',
  'font',
  'color',
  'uppercase',
  'background',
  'border',
  'corners',
  'shadow',
  'padding',
  'x',
  'y',
] as const

/** Facts one observation line says at most; the cause's own lines carry the rest. */
export const OBSERVATION_MAX_FACTS = 3

/** Size, position and inner spacing changes under this many CSS px are not observed; above GEOM_REPORT_TOL. */
export const OBSERVATION_MIN_PX = 1

/** Longest own text that names an element in an observation, or is quoted when it changed. */
export const OBSERVATION_TEXT_LIMIT = 40

/** Shortest own text that names an element without a role; one or two characters (`S`, `34`) name nothing a person can find. */
export const OBSERVATION_NAME_MIN = 3

/** Nouns of the roles an observation names an element by; an element with any other role is named by its text or tag. */
export const ROLE_NOUNS: ReadonlyMap<string, string> = new Map([
  ['button', 'button'],
  ['link', 'link'],
  ['textbox', 'text field'],
  ['searchbox', 'text field'],
  ['checkbox', 'checkbox'],
  ['radio', 'radio button'],
  ['combobox', 'select'],
  ['listbox', 'select'],
  ['heading', 'heading'],
  ['img', 'image'],
  ['listitem', 'list item'],
  ['tab', 'tab'],
  ['menuitem', 'menu item'],
  ['dialog', 'dialog'],
])

/** Roles HTML gives these tags, for elements whose snapshot carries no role (the accessibility tree is skipped on large pages). */
export const IMPLICIT_ROLES: ReadonlyMap<string, string> = new Map([
  ['button', 'button'],
  ['a', 'link'],
  ['textarea', 'textbox'],
  ['select', 'combobox'],
  ['h1', 'heading'],
  ['h2', 'heading'],
  ['h3', 'heading'],
  ['h4', 'heading'],
  ['h5', 'heading'],
  ['h6', 'heading'],
  ['img', 'img'],
  ['li', 'listitem'],
])

/** Tags whose element an observation calls text when it names it by its own words; any other is an element. */
export const TEXT_TAGS: ReadonlySet<string> = new Set([
  'span',
  'p',
  'label',
  'strong',
  'em',
  'b',
  'i',
  'small',
  'td',
  'th',
  'dt',
  'dd',
])
