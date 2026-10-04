import { createRequire } from 'node:module'

const manifest: unknown = createRequire(import.meta.url)('../package.json')

/** Version of this package, as written into every snapshot. */
export const VERSION: string = readVersion(manifest)

function readVersion(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'version' in value) {
    const { version } = value
    if (typeof version === 'string') return version
  }
  throw new Error('package.json of @whydiff/capture has no version')
}
