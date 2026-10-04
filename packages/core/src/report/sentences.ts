import { count, plural } from './format.js'

/** Fixed wording agents learn to recognise; reused verbatim by every renderer. */
export const SENTENCES = {
  observed: 'What changed on this screen:',
  unexplainedIntro: [
    'Pixels changed, no DOM, style or geometry change found under the region.',
    'Usual reasons: image content, canvas, icon font, text anti-aliasing.',
  ],
  ambiguous: (ambiguous: number, members: number): string =>
    `ambiguous: for ${count(ambiguous)} of ${plural(members, 'changed element')}, two elements on the other side matched almost equally. The property change is the same for both, so the element named may be the wrong one.`,
  massChange:
    'mass change: more than the region limit of changed areas in this screenshot. Pixel filter disabled, showing structural changes only. Some listed changes may not be visible.',
  sizeMismatch: (before: readonly [number, number], after: readonly [number, number]): string =>
    `size mismatch: the screenshot was ${String(before[0])}x${String(before[1])} px, now ${String(after[0])}x${String(after[1])} px. Compared the overlapping area.`,
  noChange: (pixels: number): string => `No visible change: 0 of ${count(pixels)} pixels differ.`,
  noneExplained: (where: string): string =>
    `Each is listed ${where}, under No baseline snapshot or Not explained, with what whydiff lacked to explain it.`,
  noChangeChecklist:
    'If you expected a change, check: same URL and state? dev server reloaded? change inside a masked or scrolled-out area?',
} as const
