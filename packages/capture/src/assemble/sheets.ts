import type { SheetV1 } from '@whydiff/core'

import type { RawSheet } from '../raw.js'

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/** Where a sheet's owner element sits: frame order, then document order; constructed sheets rank last. */
export type SheetRank = (sheet: RawSheet) => readonly [frame: number, node: number]

/** Sheets in document order of their owner elements, then in the order the browser announced them. */
export function orderSheets(sheets: readonly RawSheet[], rank: SheetRank): RawSheet[] {
  return [...sheets].sort((a, b) => {
    const [frameA, nodeA] = rank(a)
    const [frameB, nodeB] = rank(b)
    return frameA - frameB || nodeA - nodeB || a.order - b.order
  })
}

/** The sheet table of the snapshot, in the order given. */
export function assembleSheets(sheets: readonly RawSheet[]): SheetV1[] {
  return sheets.map((sheet) => {
    const out: Mutable<SheetV1> = { hash: sheet.hash }
    if (sheet.href !== null) out.href = sheet.href
    if (sheet.inline) out.inline = true
    if (sheet.harness) out.harness = true
    return out
  })
}
