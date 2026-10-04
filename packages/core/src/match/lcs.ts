/** Longest common subsequence as index pairs; on equal table values the before element is skipped. */
export function lcs<T>(before: readonly T[], after: readonly T[]): [number, number][] {
  const n = before.length
  const m = after.length
  const width = m + 1
  const table = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        before[i] === after[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0)
    }
  }
  const pairs: [number, number][] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (
      before[i] === after[j] &&
      table[i * width + j] === (table[(i + 1) * width + j + 1] ?? 0) + 1
    ) {
      pairs.push([i, j])
      i++
      j++
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      i++
    } else {
      j++
    }
  }
  return pairs
}
