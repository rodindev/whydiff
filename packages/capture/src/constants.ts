/** Longest `text` and `name` kept per node. */
export const TEXT_LIMIT = 80
/** Geometry is quantized to this fraction of a CSS px; a power of two, so it survives JSON round trips. */
export const GEOMETRY_UNIT = 64
/** Hex digits kept from the SHA-256 of a sheet text or an image URL. */
export const HASH_LENGTH = 16
/** Attribute that marks the capture root while the page is frozen. */
export const ROOT_ATTRIBUTE = 'data-whydiff-root'
/** Attribute that marks the elements of the mask locators while the page is frozen. */
export const MASK_ATTRIBUTE = 'data-whydiff-mask'
/** Attribute a test harness puts on the style elements it injects. */
export const HARNESS_ATTRIBUTE = 'data-whydiff-harness'
/** Attribute on the style element the freeze injects. */
export const FREEZE_ATTRIBUTE = 'data-whydiff-freeze'
/** Font properties whose distinct tuples get one platform-font sample each. */
export const FONT_SAMPLE_PROPS: readonly string[] = ['font-family', 'font-weight', 'font-style']
/** A frame that does not answer a page script within this time is left as it is. */
export const FRAME_SCRIPT_TIMEOUT_MS = 2000
/** Playwright's default `threshold` for screenshot comparison. */
export const DEFAULT_THRESHOLD = 0.2
/** Attribution groups per capture above which winning rules are not recorded. */
export const RULE_GROUP_LIMIT = 2000
/** Custom property chains are followed this many names deep from the longhand that reads them. */
export const VAR_DEPTH_LIMIT = 16
