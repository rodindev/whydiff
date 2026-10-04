import { createHash } from 'node:crypto'

import { HASH_LENGTH } from './constants.js'

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, HASH_LENGTH)
}
