import type { CaptureSource, FrameStatus, NodeFlag, ScreenshotScale } from './types.js'

export const ROOT_KEYS = [
  'formatVersion',
  'tool',
  'page',
  'image',
  'viewport',
  'content',
  'compare',
  'frames',
  'masks',
  'sheets',
  'props',
  'styles',
  'rules',
  'attributions',
  'declarations',
  'uses',
  'nodes',
] as const

export const TOOL_KEYS = ['name', 'version', 'source', 'browser', 'capturedAfterMs'] as const
export const PAGE_KEYS = ['url', 'title'] as const
export const IMAGE_KEYS = [
  'width',
  'height',
  'k',
  'layoutFactor',
  'origin',
  'fullPage',
  'root',
] as const
export const VIEWPORT_KEYS = ['width', 'height', 'scrollX', 'scrollY'] as const
export const CONTENT_KEYS = ['width', 'height'] as const
export const COMPARE_KEYS = [
  'threshold',
  'maxDiffPixels',
  'maxDiffPixelRatio',
  'animations',
  'caret',
  'scale',
] as const
export const FRAME_KEYS = ['url', 'owner', 'offset', 'scroll', 'status'] as const
export const SHEET_KEYS = ['href', 'inline', 'hash', 'harness'] as const
export const RULE_KEYS = ['sheet', 'inline', 'userAgent', 'selector', 'layer', 'important'] as const
export const DECLARATION_KEYS = ['prop', 'rule', 'value', 'initial', 'inherited', 'reads'] as const
export const NODE_KEYS = [
  'i',
  'p',
  'f',
  'tag',
  'role',
  'name',
  'id',
  'testId',
  'cls',
  'text',
  'value',
  'checked',
  'box',
  'lineBoxes',
  'scroll',
  'img',
  's',
  'a',
  'layer',
  'stacking',
  'font',
  'src',
  'flags',
] as const

export const CAPTURE_SOURCES: readonly CaptureSource[] = ['cdp']
export const SCREENSHOT_SCALES: readonly ScreenshotScale[] = ['css', 'device']
export const FRAME_STATUSES: readonly FrameStatus[] = ['captured', 'skipped', 'approximate']
export const NODE_FLAGS: readonly NodeFlag[] = [
  'pseudo:before',
  'pseudo:after',
  'pseudo:marker',
  'shadow:open',
  'shadow:closed',
  'clipped',
  'hidden',
]
