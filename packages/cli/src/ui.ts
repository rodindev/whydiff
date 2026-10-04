import type { Writable } from 'node:stream'
import { confirm, isCancel, log, note, select, spinner } from '@clack/prompts'

/** Progress, warnings and prompts; everything here goes to stderr, never to stdout. */
export interface Ui {
  /** True when a prompt may be shown: terminals on both ends, no `--json`, no `--yes`, not CI. */
  readonly interactive: boolean
  /** Starts a progress line; the returned function ends it with its result. */
  start(message: string): (result: string) => void
  info(message: string): void
  warn(message: string): void
  /** The one line of a failed command; ends a running progress line first. */
  error(message: string): void
  /** A titled block of lines. */
  note(title: string, text: string): void
  /** A yes/no question; false when the user cancels. Interactive only. */
  confirm(message: string): Promise<boolean>
  /** One choice out of several; null when the user cancels. Interactive only. */
  choose(
    message: string,
    options: readonly { readonly value: string; readonly label: string }[]
  ): Promise<string | null>
}

/** The process streams and environment the UI decides its mode from. */
export interface UiStreams {
  readonly stdin: NodeJS.ReadStream
  readonly stdout: { readonly isTTY?: boolean }
  readonly stderr: Writable & { readonly isTTY?: boolean }
  readonly env: Readonly<Record<string, string | undefined>>
}

/** Switches that rule prompts out whatever the streams are. */
export interface UiOptions {
  readonly json: boolean
  readonly yes: boolean
}

/** A clack UI on a terminal, plain lines on stderr everywhere else. */
export function createUi(streams: UiStreams, options: UiOptions): Ui {
  const { stdin, stdout, stderr, env } = streams
  const ci = env.CI !== undefined && env.CI !== ''
  const interactive =
    stdin.isTTY &&
    stdout.isTTY === true &&
    stderr.isTTY === true &&
    !options.json &&
    !options.yes &&
    !ci
  return interactive ? clackUi(stdin, stderr) : plainUi(stderr)
}

function plainUi(stderr: Writable): Ui {
  const line = (text: string): void => {
    stderr.write(`${text}\n`)
  }
  return {
    interactive: false,
    start(message) {
      line(message)
      return line
    },
    info: line,
    warn: (message) => {
      line(`warning: ${message}`)
    },
    error: line,
    note: (title, text) => {
      line(`${title}:`)
      for (const row of text.split('\n')) line(`  ${row}`)
    },
    confirm: () => Promise.reject(new Error('confirm needs a terminal')),
    choose: () => Promise.reject(new Error('choose needs a terminal')),
  }
}

function clackUi(input: NodeJS.ReadStream, output: Writable): Ui {
  let running: ReturnType<typeof spinner> | null = null
  return {
    interactive: true,
    start(message) {
      const progress = spinner({ output })
      progress.start(message)
      running = progress
      return (result) => {
        running = null
        progress.stop(result)
      }
    },
    info: (message) => {
      log.info(message, { output })
    },
    warn: (message) => {
      log.warn(message, { output })
    },
    error: (message) => {
      if (running === null) log.error(message, { output })
      else running.error(message)
      running = null
    },
    note: (title, text) => {
      note(text, title, { output })
    },
    async confirm(message) {
      const answer = await confirm({ message, input, output })
      return answer === true
    },
    async choose(message, options) {
      const answer = await select<string>({
        message,
        options: options.map(({ value, label }) => ({ value, label })),
        input,
        output,
      })
      return isCancel(answer) ? null : answer
    },
  }
}
