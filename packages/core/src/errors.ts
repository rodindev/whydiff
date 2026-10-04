/** Codes of the errors whydiff raises on bad input. */
export type WhydiffErrorCode =
  | 'capture-failed'
  | 'invalid-image'
  | 'invalid-option'
  | 'invalid-report'
  | 'invalid-snapshot'
  | 'unsupported-browser'
  | 'unsupported-playwright'

/** Error raised at an input boundary; the message names the next step. */
export class WhydiffError extends Error {
  readonly code: WhydiffErrorCode

  constructor(code: WhydiffErrorCode, message: string) {
    super(message)
    this.name = 'WhydiffError'
    this.code = code
  }
}
