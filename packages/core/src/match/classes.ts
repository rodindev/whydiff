/** Bumped whenever a rule below changes, so cluster keys built on classes never mix rule generations. */
export const CLASS_RULES_VERSION = 'c1'

const EMOTION = /^css-[a-z0-9]+(-(.+))?$/
const STYLED_COMPONENTS = /^sc-[a-zA-Z0-9]+$/
const CSS_MODULES = /^([A-Za-z][\w-]*)__[A-Za-z0-9_-]{5,}$/
const SCOPED = /^data-v-[a-f0-9]+$/

/** Class names with build hashes removed, sorted and deduplicated; the input order never matters. */
export function normalizeClasses(classes: readonly string[]): string[] {
  const kept = new Set<string>()
  for (const name of classes) {
    const normalized = normalizeClass(name)
    if (normalized !== null) kept.add(normalized)
  }
  return [...kept].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

function normalizeClass(name: string): string | null {
  const emotion = EMOTION.exec(name)
  if (emotion !== null) return emotion[2] ?? null
  if (STYLED_COMPONENTS.test(name) || SCOPED.test(name)) return null
  const modules = CSS_MODULES.exec(name)
  if (modules !== null) return modules[1] ?? null
  return name
}
