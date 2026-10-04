import type { DocumentSnapshot } from '../raw.js'
import { assemble, capture, main, rawDocument } from '../testing/columns.js'

describe('indexDocument', () => {
  it('reads each sparse column a fixed number of times per entry, whatever the node count', () => {
    const count = 400
    const built = main([
      { tag: 'html', parent: 0, box: [0, 0, 1000, 1000] },
      ...Array.from({ length: count }, (_, i) => ({
        tag: 'input',
        parent: 1,
        box: [0, i, 10, 1] as const,
        attrs: i % 2 === 0 ? { type: 'checkbox' } : {},
      })),
    ])
    const inputs = Array.from({ length: count }, (_, i) => i + 2)
    const intern = (text: string): number => built.strings.push(text) - 1
    let reads = 0
    let entries = 0
    const counted = (values: readonly number[]): number[] => {
      entries += values.length
      return new Proxy([...values], {
        get(target, key, receiver): unknown {
          if (typeof key === 'string' && /^\d+$/.test(key)) reads++
          return Reflect.get(target, key, receiver)
        },
      })
    }
    const column = (value: (input: number) => string): { index: number[]; value: number[] } => ({
      index: counted(inputs),
      value: counted(inputs.map((input) => intern(value(input)))),
    })
    const document: DocumentSnapshot = {
      ...built.document,
      nodes: {
        ...built.document.nodes,
        inputValue: column((input) => `value ${String(input)}`),
        textValue: column(() => 'text'),
        currentSourceURL: column((input) => `http://app.test/${String(input)}.png`),
        shadowRootType: column(() => 'open'),
        inputChecked: { index: counted(inputs.filter((input) => input % 2 === 0)) },
      },
    }
    const { nodes } = assemble(
      capture([rawDocument({ ...built, document }, 'MAIN', 'http://app.test/')])
    )
    expect(reads).toBeLessThanOrEqual(2 * entries)
    expect(nodes).toHaveLength(count + 1)
    expect(nodes[1]).toMatchObject({ checked: true, flags: ['shadow:open'] })
    expect(nodes[2]).toMatchObject({ value: 'value 3', flags: ['shadow:open'] })
    expect(nodes[2]?.img).toHaveLength(16)
  })
})
