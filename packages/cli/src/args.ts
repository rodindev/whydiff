import { WhydiffError } from '@whydiff/core'

/** The flags one command accepts: `true` takes a value, `false` is a switch. */
export type FlagSpec = Readonly<Record<string, boolean>>

/** Positionals and flags of one command line, after the command word. */
export interface ParsedArgs {
  readonly positionals: readonly string[]
  readonly flags: ReadonlyMap<string, string | true>
}

/** Splits `[positionals] [--flag value|--flag]`; an unknown flag or a flag without its value is an error. */
export function parseArgs(argv: readonly string[], spec: FlagSpec, command: string): ParsedArgs {
  const positionals: string[] = []
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    if (!arg.startsWith('--') || arg === '--') {
      positionals.push(arg)
      continue
    }
    const name = arg.slice(2)
    const takesValue = spec[name]
    if (takesValue === undefined) {
      throw new WhydiffError(
        'invalid-option',
        `unknown option ${arg} for whydiff ${command}. Run npx whydiff ${command} --help for the options.`
      )
    }
    if (!takesValue) {
      flags.set(name, true)
      continue
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new WhydiffError(
        'invalid-option',
        `${arg} needs a value. Run npx whydiff ${command} --help for the options.`
      )
    }
    flags.set(name, value)
    i++
  }
  return { positionals, flags }
}

/** The value of a flag that takes one, or undefined when it was not given. */
export function flagValue(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name)
  return typeof value === 'string' ? value : undefined
}

/** True when a switch was given. */
export function hasFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.has(name)
}

/** The value of a flag that takes one, or an error naming the command when it was not given. */
export function requireFlag(args: ParsedArgs, name: string, command: string): string {
  const value = flagValue(args, name)
  if (value === undefined) {
    throw new WhydiffError(
      'invalid-option',
      `--${name} is required. Run npx whydiff ${command} --help for the options.`
    )
  }
  return value
}

/** A positive integer flag, or the default when it was not given. */
export function integerFlag(args: ParsedArgs, name: string, fallback: number): number {
  const value = flagValue(args, name)
  if (value === undefined) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) {
    throw new WhydiffError('invalid-option', `--${name} takes a positive integer, not ${value}.`)
  }
  return n
}
