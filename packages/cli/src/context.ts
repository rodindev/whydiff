import type { Ui } from './ui.js'

/** What every command runs with: the directory, the environment, the result stream and the UI. */
export interface Context {
  readonly cwd: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly ui: Ui
  /** Writes to stdout: the result and nothing else. */
  readonly out: (text: string) => void
}
