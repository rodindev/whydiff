import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { SKIPPED_DIRS, WALK_MAX_DEPTH } from '../constants.js'

/** Every file under `dir` in sorted order, skipping build and output directories and stopping at the depth limit. */
export async function walkFiles(dir: string, depth = 0): Promise<string[]> {
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  )
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (depth >= WALK_MAX_DEPTH || SKIPPED_DIRS.includes(entry.name)) continue
      files.push(...(await walkFiles(path, depth + 1)))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }
  return files
}
