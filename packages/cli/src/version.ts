import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** Version of this package, as written into every report it builds. */
export const VERSION: string = versionOf(require('../package.json'))

function versionOf(manifest: unknown): string {
  if (typeof manifest === 'object' && manifest !== null && 'version' in manifest) {
    const { version } = manifest
    if (typeof version === 'string') return version
  }
  throw new Error('package.json of whydiff has no version')
}
