#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import type { Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { WhydiffError } from '@whydiff/core'

import { hasFlag, parseArgs, type FlagSpec, type ParsedArgs } from './args.js'
import { DIFF_FLAGS, diff } from './commands/diff.js'
import { DOCTOR_FLAGS, doctor } from './commands/doctor.js'
import { EXPLAIN_FLAGS, explain } from './commands/explain.js'
import { INIT_FLAGS, init } from './commands/init.js'
import { REPORT_FLAGS, report } from './commands/report.js'
import { SCHEMA_FLAGS, schema } from './commands/schema.js'
import { SNAP_FLAGS, snap } from './commands/snap.js'
import { EXIT_ERROR } from './constants.js'
import type { Context } from './context.js'
import { createUi, type Ui, type UiStreams } from './ui.js'
import { COMMAND_USAGE, USAGE } from './usage.js'
import { VERSION } from './version.js'

interface Command {
  readonly flags: FlagSpec
  readonly run: (args: ParsedArgs, ctx: Context) => Promise<number>
  readonly usage: string
}

const COMMANDS: Readonly<Record<string, Command>> = {
  snap: { flags: SNAP_FLAGS, run: snap, usage: COMMAND_USAGE.snap },
  diff: { flags: DIFF_FLAGS, run: diff, usage: COMMAND_USAGE.diff },
  report: { flags: REPORT_FLAGS, run: report, usage: COMMAND_USAGE.report },
  explain: { flags: EXPLAIN_FLAGS, run: explain, usage: COMMAND_USAGE.explain },
  init: { flags: INIT_FLAGS, run: init, usage: COMMAND_USAGE.init },
  doctor: { flags: DOCTOR_FLAGS, run: doctor, usage: COMMAND_USAGE.doctor },
  schema: { flags: SCHEMA_FLAGS, run: schema, usage: COMMAND_USAGE.schema },
}

/** The process the CLI runs in: its directory, environment and streams. */
export interface Process extends UiStreams {
  readonly cwd: string
  readonly stdout: Writable & { readonly isTTY?: boolean }
}

/** Parses the command line, runs the command and returns the exit code; errors become one line on stderr. */
export async function run(argv: readonly string[], process: Process): Promise<number> {
  const [word, ...rest] = argv
  const out = (text: string): void => {
    process.stdout.write(text)
  }
  if (word === undefined) {
    process.stderr.write(USAGE)
    return EXIT_ERROR
  }
  if (word === '--help' || word === '-h' || word === 'help') {
    out(USAGE)
    return 0
  }
  if (word === '--version' || word === '-v') {
    out(`${VERSION}\n`)
    return 0
  }
  let ui: Ui | null = null
  try {
    const command = Object.hasOwn(COMMANDS, word) ? COMMANDS[word] : undefined
    if (command === undefined) {
      throw new WhydiffError(
        'invalid-option',
        `unknown command ${word}. Run npx whydiff --help for the commands.`
      )
    }
    const args = parseArgs(rest, command.flags, word)
    if (hasFlag(args, 'help') || args.positionals.includes('-h')) {
      out(command.usage)
      return 0
    }
    ui = createUi(process, { json: hasFlag(args, 'json'), yes: hasFlag(args, 'yes') })
    return await command.run(args, { cwd: process.cwd, env: process.env, ui, out })
  } catch (error) {
    const line = `whydiff: ${errorLine(error)}`
    if (ui === null) process.stderr.write(`${line}\n`)
    else ui.error(line)
    return EXIT_ERROR
  }
}

function errorLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.split('\n').join(' ')
}

function isMain(): boolean {
  try {
    return (
      process.argv[1] !== undefined &&
      import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
    )
  } catch {
    return false
  }
}

if (isMain()) {
  process.exitCode = await run(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  })
}
