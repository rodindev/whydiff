import { flagValue, hasFlag, integerFlag, parseArgs, requireFlag } from './args.js'

const spec = { out: true, json: false, 'max-causes': true }

describe('parseArgs', () => {
  it('splits positionals from flags with and without values, in any order', () => {
    const args = parseArgs(['a', '--out', 'dir', 'b', '--json'], spec, 'diff')
    expect(args.positionals).toEqual(['a', 'b'])
    expect(flagValue(args, 'out')).toBe('dir')
    expect(hasFlag(args, 'json')).toBe(true)
    expect(flagValue(args, 'json')).toBeUndefined()
    expect(hasFlag(args, 'max-causes')).toBe(false)
  })

  it('refuses an unknown flag and a flag without its value', () => {
    expect(() => parseArgs(['--bogus'], spec, 'diff')).toThrow(
      'unknown option --bogus for whydiff diff. Run npx whydiff diff --help for the options.'
    )
    expect(() => parseArgs(['--out'], spec, 'diff')).toThrow('--out needs a value')
    expect(() => parseArgs(['--out', '--json'], spec, 'diff')).toThrow('--out needs a value')
  })

  it('knows no abbreviations: a single dash is a positional', () => {
    expect(parseArgs(['-o', 'x'], spec, 'diff').positionals).toEqual(['-o', 'x'])
  })

  it('keeps the last value of a repeated flag', () => {
    expect(flagValue(parseArgs(['--out', 'a', '--out', 'b'], spec, 'diff'), 'out')).toBe('b')
  })
})

describe('flag readers', () => {
  it('requires a flag by name and parses positive integers', () => {
    const args = parseArgs(['--max-causes', '3'], spec, 'diff')
    expect(requireFlag(args, 'max-causes', 'diff')).toBe('3')
    expect(integerFlag(args, 'max-causes', 20)).toBe(3)
    expect(integerFlag(parseArgs([], spec, 'diff'), 'max-causes', 20)).toBe(20)
    expect(() => requireFlag(args, 'out', 'diff')).toThrow('--out is required')
    expect(() =>
      integerFlag(parseArgs(['--max-causes', '0'], spec, 'diff'), 'max-causes', 20)
    ).toThrow('--max-causes takes a positive integer, not 0.')
    expect(() =>
      integerFlag(parseArgs(['--max-causes', 'x'], spec, 'diff'), 'max-causes', 20)
    ).toThrow('positive integer')
  })
})
