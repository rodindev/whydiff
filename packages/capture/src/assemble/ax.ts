import { TEXT_LIMIT } from '../constants.js'
import type { AxNode } from '../raw.js'

/** Chromium accessibility roles that `getByRole` knows under another name. */
const ROLE_MAP: ReadonlyMap<string, string> = new Map([['image', 'img']])

/** Roles that carry no information for a locator. */
const SILENT_ROLES: ReadonlySet<string> = new Set(['generic', 'none', 'presentation'])

const ARIA_ROLE = /^[a-z]+$/

export interface AxEntry {
  readonly role: string | null
  readonly name: string | null
}

/** Role and accessible name per backend node id, with Chromium's internal roles filtered out. */
export function axByBackendNode(nodes: readonly AxNode[]): ReadonlyMap<number, AxEntry> {
  const entries = new Map<number, AxEntry>()
  for (const node of nodes) {
    if (node.ignored || node.backendDOMNodeId === undefined) continue
    const role = normalizeRole(node.role?.value)
    const name = typeof node.name?.value === 'string' ? node.name.value.trim() : ''
    if (role === null && name === '') continue
    entries.set(node.backendDOMNodeId, {
      role,
      name: name === '' ? null : name.slice(0, TEXT_LIMIT),
    })
  }
  return entries
}

export function normalizeRole(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const role = ROLE_MAP.get(value) ?? value
  return ARIA_ROLE.test(role) && !SILENT_ROLES.has(role) ? role : null
}
