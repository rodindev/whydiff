import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

/** One of the JSON schemas @whydiff/core publishes next to its build. */
export function coreSchemaPath(name: 'snapshot' | 'report'): string {
  return join(dirname(require.resolve('@whydiff/core')), '..', 'schema', `${name}-v1.schema.json`)
}
