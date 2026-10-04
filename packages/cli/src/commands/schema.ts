import { readFile } from 'node:fs/promises'
import { WhydiffError } from '@whydiff/core'

import type { FlagSpec, ParsedArgs } from '../args.js'
import type { Context } from '../context.js'
import { coreSchemaPath } from '../paths.js'

/** Flags of `schema`. */
export const SCHEMA_FLAGS: FlagSpec = { help: false }

/** Prints the JSON schema of the snapshot or the report format. */
export async function schema(args: ParsedArgs, ctx: Context): Promise<number> {
  const [name] = args.positionals
  if ((name !== 'snapshot' && name !== 'report') || args.positionals.length > 1) {
    throw new WhydiffError(
      'invalid-option',
      'schema takes snapshot or report: npx whydiff schema report.'
    )
  }
  ctx.out(await readFile(coreSchemaPath(name), 'utf8'))
  return 0
}
