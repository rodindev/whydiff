import type { DeclarationV1, RuleV1 } from '@whydiff/core'

/** A declaration entry with its rule and reads written out instead of indices. */
export interface Chain {
  readonly prop: string
  readonly rule?: RuleV1
  readonly value?: string
  readonly initial?: true
  readonly inherited?: true
  readonly reads?: readonly Chain[]
}

/** The entries of one `uses` row written out, for comparing with a chain written by hand. */
export function chains(
  from: { readonly rules: readonly RuleV1[]; readonly declarations: readonly DeclarationV1[] },
  row: readonly number[]
): Chain[] {
  const write = (index: number): Chain => {
    const { rule, reads, ...entry } = from.declarations[index] ?? { prop: '' }
    const chain: { -readonly [K in keyof Chain]: Chain[K] } = entry
    const written = rule === undefined ? undefined : from.rules[rule]
    if (written !== undefined) chain.rule = written
    if (reads !== undefined) chain.reads = reads.map(write)
    return chain
  }
  return row.map(write)
}
