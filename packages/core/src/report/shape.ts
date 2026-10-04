export const ROOT_KEYS = [
  'formatVersion',
  'tool',
  'compared',
  'summary',
  'screenshots',
  'causes',
  'unexplained',
] as const
export const TOOL_KEYS = ['name', 'version', 'rules'] as const
export const COMPARED_KEYS = ['before', 'after', 'browser', 'viewport'] as const
export const SUMMARY_KEYS = ['screenshots', 'causes', 'unexplained', 'massChange', 'lead'] as const
export const LEAD_KEYS = ['causes', 'screenshots', 'settled', 'pixels', 'text'] as const
export const SCREENSHOT_KEYS = [
  'id',
  'title',
  'file',
  'line',
  'project',
  'status',
  'width',
  'height',
  'regions',
  'pixels',
  'massChange',
  'sizeMismatch',
  'causes',
  'unexplained',
] as const
export const CAUSE_KEYS = [
  'id',
  'headline',
  'text',
  'key',
  'kind',
  'level',
  'summary',
  'scope',
  'file',
  'match',
  'ambiguous',
  'screenshots',
  'elements',
  'pixels',
  'effects',
  'example',
  'members',
] as const
export const OBSERVATION_KEYS = ['element', 'facts', 'text'] as const
export const ELEMENT_KEYS = ['role', 'name', 'class', 'tag'] as const
export const FACT_KEYS = ['kind', 'from', 'to'] as const
export const CHANGE_KEYS = ['prop', 'from', 'to', 'delta'] as const
export const SUMMARY_SHAPE_KEYS = [
  'kind',
  'changes',
  'detail',
  'from',
  'to',
  'selector',
  'sheet',
  'layer',
  'important',
  'sets',
  'changed',
  'unsets',
  'values',
  'mixed',
  'layerFrom',
  'layerTo',
  'over',
  'defaults',
  'vars',
  'via',
] as const
export const RULE_SUMMARY_KEYS = [
  'kind',
  'selector',
  'sheet',
  'layer',
  'important',
  'sets',
  'changed',
  'unsets',
  'values',
  'mixed',
  'layerFrom',
  'layerTo',
  'over',
  'defaults',
  'vars',
  'via',
] as const
export const RULE_REF_KEYS = ['selector', 'sheet', 'layer', 'important', 'userAgent'] as const
export const DEFAULT_KEYS = ['prop', 'value'] as const
export const MIXED_KEYS = ['prop', 'sets', 'changed', 'unsets'] as const
export const VAR_KEYS = ['name', 'from', 'to', 'readBy', 'missing'] as const
export const VIA_KEYS = ['name', 'rule', 'readBy'] as const
export const MISSING_KINDS = ['fallback', 'invalid'] as const
export const CLUSTER_LEVELS = [0, 1, 2, 3] as const
export const EFFECT_KEYS = ['kind', 'nodes', 'vector', 'vectorNodes'] as const
export const EXAMPLE_KEYS = ['screenshot', 'locator', 'src'] as const
export const MEMBER_KEYS = [
  'screenshot',
  'locator',
  'elements',
  'effects',
  'changes',
  'observation',
  'box',
] as const
export const MEMBER_BOX_KEYS = ['before', 'after'] as const
export const MEMBER_CHANGE_KEYS = ['prop', 'from', 'to'] as const
export const UNEXPLAINED_KEYS = [
  'id',
  'screenshot',
  'region',
  'pixels',
  'candidates',
  'note',
] as const
export const SCREENSHOT_STATUSES = ['changed', 'identical'] as const
export const SCOPES = ['global', 'local'] as const
export const MATCH_WORDS = ['exact', 'likely', 'ambiguous'] as const
export const EFFECT_KINDS = ['shifted', 'resized', 'reflowed', 'painted', 'inherited'] as const
export const STYLE_FAMILIES = ['style', 'container', 'paint-order'] as const
export const CONTENT_DETAILS = ['text', 'wrap', 'font-metrics'] as const
export const PLAIN_KINDS = ['added', 'removed', 'scrolled', 'resized'] as const
export const RULE_ONLY_KEYS = [
  'selector',
  'sheet',
  'layer',
  'important',
  'sets',
  'changed',
  'unsets',
  'values',
  'mixed',
  'layerFrom',
  'layerTo',
  'over',
  'defaults',
  'vars',
  'via',
] as const
