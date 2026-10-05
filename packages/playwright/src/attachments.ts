import { stripVTControlCharacters } from 'node:util'
import { screenKey } from '@whydiff/core'

import { ATTACHMENT_PREFIX } from './constants.js'
import { pairIdentity, type PairIdentity, type TestIdentity } from './pair.js'

export type { TestIdentity }

/** The files whydiff attaches for one explained screenshot. */
export type WhydiffKind = 'markdown' | 'snapshot-actual' | 'snapshot-expected'

/** The images the built-in attaches for one failed screenshot. */
export type ImageKind = 'expected' | 'actual' | 'diff'

export const CONTENT_TYPES: Readonly<Record<WhydiffKind, string>> = {
  markdown: 'text/markdown',
  'snapshot-actual': 'application/json',
  'snapshot-expected': 'application/json',
}

/** An attachment as a test and the reporter both see it: its name and content type. */
export interface AttachmentLike {
  readonly name: string
  readonly contentType: string
}

/** Everything one attempt attached for one screenshot, found by name and content type. */
export interface PairFiles<A> {
  readonly name: string
  readonly whydiff: Partial<Record<WhydiffKind, A>>
  readonly images: Partial<Record<ImageKind, A>>
}

/** An attachment as the reporter receives it, with its file path or its body. */
export interface ReportedAttachment extends AttachmentLike {
  readonly path?: string
  readonly body?: Buffer
}

export interface AnnotationLike {
  readonly type: string
  readonly description?: string
}

export interface StepLike {
  readonly category: string
  readonly title: string
  readonly error?: { readonly message?: string }
  readonly duration: number
  readonly attachments: readonly AttachmentLike[]
  readonly steps: readonly StepLike[]
}

/** The test's timeout as one attempt recorded it. */
export interface Timeout {
  readonly message: string
  /** The errors recorded after the timeout's, those of the assertions it cut among them. */
  readonly after: readonly string[]
}

/** One screenshot of the run before analysis; `files` is null for a passed one, listed by title only, and for a failed one whydiff attached nothing to, which carries `notExplained`. */
export interface Listed {
  readonly identity: PairIdentity
  readonly ordinal: number
  readonly files: PairFiles<ReportedAttachment> | null
  /** Why a failed screenshot has no whydiff attachments; null for every other. */
  readonly notExplained: string | null
}

const WHYDIFF_KINDS: readonly WhydiffKind[] = ['markdown', 'snapshot-actual', 'snapshot-expected']
const IMAGE_KINDS: readonly ImageKind[] = ['expected', 'actual', 'diff']
const IMAGE = /^(.+)-(expected|actual|diff)\.png$/
const OTHER_BROWSER = ' screenshots are not explained: '
// A matcher header ends with ` failed` or a colon on recent releases and is the bare call on older ones, 1.53 among them.
const HEADER = /(?: failed|:)$|^expect\(.*\)$/
// How Playwright words the test's own timeout, in the test body, a hook or a fixture setup alike.
const TEST_TIMEOUT = /^Test timeout of \d+ms exceeded/
const NO_REASON =
  'no whydiff annotation names it: whydiff was switched off or attaches nothing, no whydiffCapture followed the assertion, or the test ended first'

/** `whydiff/<name>/<kind>`, where `<name>` is the built-in's attachment name without `-actual.png`. */
export function attachmentName(name: string, kind: WhydiffKind): string {
  return `${ATTACHMENT_PREFIX}${name}/${kind}`
}

export function readWhydiffAttachment(
  attachment: AttachmentLike
): { name: string; kind: WhydiffKind } | null {
  if (!attachment.name.startsWith(ATTACHMENT_PREFIX)) return null
  const rest = attachment.name.slice(ATTACHMENT_PREFIX.length)
  const slash = rest.lastIndexOf('/')
  const kind = WHYDIFF_KINDS.find((k) => k === rest.slice(slash + 1))
  if (slash <= 0 || kind === undefined || attachment.contentType !== CONTENT_TYPES[kind]) {
    return null
  }
  return { name: rest.slice(0, slash), kind }
}

/** Paths of the PNGs the built-in attached for one screenshot, by kind. */
export interface AttachedImages {
  readonly name: string
  readonly actual?: string
  readonly expected?: string
}

export function readImageAttachment(
  attachment: AttachmentLike
): { name: string; kind: ImageKind } | null {
  if (attachment.contentType !== 'image/png') return null
  const match = IMAGE.exec(attachment.name)
  const kind = IMAGE_KINDS.find((k) => k === match?.[2])
  const name = match?.[1]
  return kind === undefined || name === undefined ? null : { name, kind }
}

/** The images of the first screenshot the built-in attached from index `from` on; null when it attached none. */
export function attachedImages(
  attachments: readonly ReportedAttachment[],
  from: number
): AttachedImages | null {
  const images = attachments.slice(from).flatMap((attachment) => {
    const image = readImageAttachment(attachment)
    return image === null || attachment.path === undefined
      ? []
      : [{ ...image, path: attachment.path }]
  })
  const [first] = images
  if (first === undefined) return null
  const found: { -readonly [K in keyof AttachedImages]: AttachedImages[K] } = { name: first.name }
  for (const image of images) {
    if (image.name !== first.name || image.kind === 'diff') continue
    found[image.kind] ??= image.path
  }
  return found
}

/** Groups one attempt's attachments by screenshot; only names whydiff attached to form a pair, in attachment order. */
export function collectPairs<A extends AttachmentLike>(attachments: readonly A[]): PairFiles<A>[] {
  const pairs: { name: string; whydiff: Partial<Record<WhydiffKind, A>> }[] = []
  const images = new Map<string, Partial<Record<ImageKind, A>>>()
  for (const attachment of attachments) {
    const own = readWhydiffAttachment(attachment)
    if (own !== null) {
      let pair = pairs.find((p) => p.name === own.name)
      if (pair === undefined) {
        pair = { name: own.name, whydiff: {} }
        pairs.push(pair)
      }
      pair.whydiff[own.kind] = attachment
      continue
    }
    const image = readImageAttachment(attachment)
    if (image === null) continue
    const found = images.get(image.name) ?? {}
    found[image.kind] = attachment
    images.set(image.name, found)
  }
  return pairs.map((pair) => ({ ...pair, images: images.get(pair.name) ?? {} }))
}

/** The screenshots of one attempt: pairs whydiff attached to, failed ones without a pair, then one title-only entry per passed assertion. `timeout` is the attempt's, as `timeoutOf` reads it: the reason of every assertion it cut. */
export function listScreenshots(
  test: TestIdentity,
  attachments: readonly ReportedAttachment[],
  steps: readonly StepLike[],
  annotations: readonly AnnotationLike[],
  timeout: Timeout | null = null
): Listed[] {
  const pairs = collectPairs(attachments)
  const shots = screenshotSteps(steps)
  const failed = failedScreenshots(shots, attachments, timeout).filter(
    ({ name }) => name === null || !pairs.some((p) => p.name === name)
  )
  const passed = shots.filter(
    (step) => step.error === undefined && cutBy(step, timeout) === null
  ).length
  const listed: Listed[] = pairs.map((files, ordinal) => ({
    identity: pairIdentity(test, files.name),
    ordinal,
    files,
    notExplained: null,
  }))
  for (const { name, error, cut } of failed) {
    const ordinal = listed.length
    listed.push({
      identity: name === null ? titleIdentity(test, ordinal) : pairIdentity(test, name),
      ordinal,
      files: null,
      notExplained:
        (cut ? null : notExplainedReason(name, annotations)) ??
        (error === null ? NO_REASON : errorLine(error)),
    })
  }
  for (let n = 0; n < passed; n++) {
    const ordinal = listed.length
    listed.push({
      identity: titleIdentity(test, ordinal),
      ordinal,
      files: null,
      notExplained: null,
    })
  }
  return listed
}

/** The screenshots of a test across its attempts, oldest first: each failed one as the last attempt that failed it lists it, then title-only entries for the passed ones, as many as the attempt that reached the most screenshots has beyond the failed ones. */
export function acrossAttempts(
  test: TestIdentity,
  attempts: readonly (readonly Listed[])[]
): Listed[] {
  let failed: Listed[] = []
  for (const listed of attempts) {
    const own = listed.filter((entry) => entry.files !== null || entry.notExplained !== null)
    failed = [
      ...failed.filter((entry) => !own.some((o) => o.identity.screen === entry.identity.screen)),
      ...own,
    ]
  }
  const reached = Math.max(0, ...attempts.map((listed) => listed.length))
  const first = Math.max(failed.length, ...failed.map((entry) => entry.ordinal + 1))
  const passed = Array.from({ length: Math.max(0, reached - failed.length) }, (_, n) => ({
    identity: titleIdentity(test, first + n),
    ordinal: first + n,
    files: null,
    notExplained: null,
  }))
  return [...failed, ...passed]
}

/** Why whydiff attached nothing to a failed screenshot, as its test's annotations say: the one about another browser, else the first line of the one that starts with the screenshot's attachment name; null when none does. */
export function notExplainedReason(
  name: string | null,
  annotations: readonly AnnotationLike[]
): string | null {
  const descriptions = annotations.flatMap((a) =>
    a.type === 'whydiff' && a.description !== undefined ? [a.description] : []
  )
  const browser = descriptions.find((d) => d.includes(OTHER_BROWSER))
  if (browser !== undefined) return browser
  if (name === null) return null
  const prefix = `${notExplainedLabel(name)}: `
  const own = descriptions.find((d) => d.startsWith(prefix))
  return own === undefined ? null : (own.slice(prefix.length).split('\n', 1)[0] ?? '')
}

/** How an annotation about a failed screenshot whydiff did not explain begins: the built-in's attachment name, which the reporter matches exactly. */
export function notExplainedLabel(name: string): string {
  return `${name}: not explained`
}

/** Why a failed screenshot that left no actual image is not explained, with the assertion's error when it is known. */
export function noActualImage(error: string | undefined): string {
  const reason = 'the assertion produced no actual image'
  return error === undefined ? reason : `${reason} (${errorLine(error)})`
}

/** An assertion error as one line, without colours or the `Error: ` of a serialized error; a first line that announces details, as Playwright's matcher header does, gets the first indented line after it. */
export function errorLine(message: string): string {
  const lines = stripVTControlCharacters(message)
    .replace(/^Error: /, '')
    .split('\n')
  const first = lines[0] ?? ''
  const detail = HEADER.test(first)
    ? lines.find((line) => line.startsWith('  ') && line.trim() !== '')
    : undefined
  return detail === undefined ? first : `${first.replace(/:$/, '')}: ${detail.trim()}`
}

/** The test's timeout among an attempt's errors: the one that made it `timedOut`, else, once a soft failure made it `failed`, the first that reads as one; null when it ran into none. */
export function timeoutOf(result: {
  readonly status: string
  readonly errors: readonly { readonly message?: string }[]
}): Timeout | null {
  const messages = result.errors.map((error) => error.message ?? '')
  const at =
    result.status === 'timedOut'
      ? 0
      : messages.findIndex((message) => TEST_TIMEOUT.test(stripVTControlCharacters(message)))
  const message = messages[at]
  return at < 0 || message === undefined ? null : { message, after: messages.slice(at + 1) }
}

interface Failed {
  readonly name: string | null
  readonly error: string | null
  readonly cut: boolean
}

// A failed step is named by the images the built-in attached to it, and by nothing when it attached
// none. The built-in attaches a diff only for a comparison that failed, so a diff no step names is
// a failed screenshot too: all that a run rebuilt from test-results, without steps, can go on.
function failedScreenshots(
  steps: readonly StepLike[],
  attachments: readonly AttachmentLike[],
  timeout: Timeout | null
): Failed[] {
  const failed: Failed[] = steps.flatMap((step) => {
    const cut = cutBy(step, timeout)
    if (cut === null && step.error === undefined) return []
    const error = cut ?? step.error?.message ?? null
    return [{ name: imagesName(step.attachments), error, cut: cut !== null }]
  })
  for (const attachment of attachments) {
    const image = readImageAttachment(attachment)
    if (image?.kind === 'diff' && !failed.some((f) => f.name === image.name)) {
      failed.push({ name: image.name, error: null, cut: false })
    }
  }
  return failed
}

// Playwright records an attempt's errors in the order they happen, the test's timeout among them. An
// assertion the timeout cut ends as the page is torn down, with an error recorded after the
// timeout's, or never ends; its reason is the timeout, not the teardown or an annotation made of it.
// One whose error was recorded before the timeout, or caught by a toPass, failed on its own.
function cutBy(step: StepLike, timeout: Timeout | null): string | null {
  if (timeout === null) return null
  const error = step.error?.message
  const cut = error === undefined ? step.duration < 0 : timeout.after.includes(error)
  return cut ? timeout.message : null
}

function imagesName(attachments: readonly AttachmentLike[]): string | null {
  for (const attachment of attachments) {
    const image = readImageAttachment(attachment)
    if (image !== null) return image.name
  }
  return null
}

function titleIdentity(test: TestIdentity, ordinal: number): PairIdentity {
  const title = test.titles.join(' > ')
  return {
    screen: screenKey(test, title, `#${String(ordinal)}`),
    title,
    file: test.file,
    line: test.line,
    project: test.project,
  }
}

// Innermost steps only: the override's step wraps the built-in's, which is the one counted.
function screenshotSteps(steps: readonly StepLike[]): StepLike[] {
  return steps.flatMap((step) => {
    const inner = screenshotSteps(step.steps)
    if (inner.length > 0) return inner
    return step.category === 'expect' && step.title.includes('toHaveScreenshot') ? [step] : []
  })
}

export function compareListed(a: Listed, b: Listed): number {
  return (
    compareText(a.identity.project, b.identity.project) ||
    compareText(a.identity.file, b.identity.file) ||
    a.identity.line - b.identity.line ||
    compareText(a.identity.title, b.identity.title) ||
    a.ordinal - b.ordinal ||
    compareText(a.identity.screen, b.identity.screen)
  )
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
