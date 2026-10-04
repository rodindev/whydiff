/** Deduplicated style rows in first-use order; nodes point into it. */
export class StyleTable {
  private readonly indexOf = new Map<string, number>()
  readonly rows: string[][] = []

  index(row: readonly string[]): number {
    const key = row.join('\u0000')
    let index = this.indexOf.get(key)
    if (index === undefined) {
      index = this.rows.length
      this.indexOf.set(key, index)
      this.rows.push([...row])
    }
    return index
  }
}
