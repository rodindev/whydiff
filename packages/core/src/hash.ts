const OFFSET = 0xcbf29ce484222325n
const PRIME = 0x100000001b3n
const MASK = 0xffffffffffffffffn

/** FNV-1a 64 of the UTF-8 bytes, in base36. */
export function fnv1a64(text: string): string {
  let hash = OFFSET
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * PRIME) & MASK
  }
  return hash.toString(36)
}
