import { Writable } from 'node:stream'

import type { Process } from './main.js'

/** A process whose stdout and stderr are collected as text; never a terminal. */
export interface FakeProcess extends Process {
  readonly text: { stdout: string; stderr: string }
}

/** A process in `cwd` with the given environment whose output the test reads back. */
export function fakeProcess(
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = {}
): FakeProcess {
  const text = { stdout: '', stderr: '' }
  const sink = (key: 'stdout' | 'stderr'): Writable =>
    new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        text[key] += chunk.toString()
        callback()
      },
    })
  return { cwd, env, stdin: process.stdin, stdout: sink('stdout'), stderr: sink('stderr'), text }
}
