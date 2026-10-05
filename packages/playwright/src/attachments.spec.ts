import {
  acrossAttempts,
  attachedImages,
  attachmentName,
  collectPairs,
  compareListed,
  errorLine,
  listScreenshots,
  noActualImage,
  notExplainedLabel,
  notExplainedReason,
  readImageAttachment,
  readWhydiffAttachment,
  type Listed,
  type ReportedAttachment,
  type StepLike,
} from './attachments.js'

const json = 'application/json'

describe('attachment names', () => {
  it('round-trips a nested name for every kind', () => {
    expect(attachmentName('nested/second', 'markdown')).toBe('whydiff/nested/second/markdown')
    expect(
      readWhydiffAttachment({
        name: 'whydiff/nested/second/markdown',
        contentType: 'text/markdown',
      })
    ).toEqual({ name: 'nested/second', kind: 'markdown' })
    expect(attachmentName('card', 'snapshot-actual')).toBe('whydiff/card/snapshot-actual')
    expect(
      readWhydiffAttachment({ name: 'whydiff/card/snapshot-expected', contentType: json })
    ).toEqual({ name: 'card', kind: 'snapshot-expected' })
  })

  it('ignores the explicit call, other content types and other names', () => {
    expect(readWhydiffAttachment({ name: 'whydiff/1-card', contentType: json })).toBeNull()
    expect(
      readWhydiffAttachment({ name: 'whydiff/card/snapshot-actual', contentType: 'text/plain' })
    ).toBeNull()
    expect(readWhydiffAttachment({ name: 'whydiff/card/diff', contentType: json })).toBeNull()
    expect(readWhydiffAttachment({ name: 'whydiff/card/actual', contentType: json })).toBeNull()
    expect(readWhydiffAttachment({ name: 'card/snapshot-actual', contentType: json })).toBeNull()
  })

  it('reads the built-in images by suffix and content type', () => {
    expect(readImageAttachment({ name: 'a-b-actual.png', contentType: 'image/png' })).toEqual({
      name: 'a-b',
      kind: 'actual',
    })
    expect(readImageAttachment({ name: 'card-previous.png', contentType: 'image/png' })).toBeNull()
    expect(readImageAttachment({ name: 'card-diff.png', contentType: 'text/plain' })).toBeNull()
  })
})

describe('attachedImages', () => {
  it('reads the first screenshot attached from the index on with its siblings, paths only', () => {
    const png = (name: string, path?: string) => ({
      name,
      contentType: 'image/png',
      ...(path === undefined ? {} : { path }),
    })
    const attachments = [
      png('old-actual.png', '/x/old-actual.png'),
      { name: 'whydiff/1-card', contentType: 'application/json', path: '/x/1.json' },
      png('card-expected.png', '/s/card.png'),
      png('card-actual.png', '/x/card-actual.png'),
      png('card-diff.png', '/x/card-diff.png'),
      png('next-actual.png', '/x/next-actual.png'),
      png('next-actual.png', '/x/next-actual-2.png'),
    ]
    expect(attachedImages(attachments, 1)).toEqual({
      name: 'card',
      expected: '/s/card.png',
      actual: '/x/card-actual.png',
    })
    expect(attachedImages(attachments, 5)).toEqual({ name: 'next', actual: '/x/next-actual.png' })
    expect(attachedImages(attachments, 7)).toBeNull()
    expect(attachedImages([png('bodied-actual.png')], 0)).toBeNull()
  })
})

describe('collectPairs', () => {
  it('groups by screenshot in the order whydiff attached them and skips images without a pair', () => {
    const a = (name: string, contentType: string) => ({ name, contentType, path: `/x/${name}` })
    const pairs = collectPairs([
      a('second-expected.png', 'image/png'),
      a('second-actual.png', 'image/png'),
      a('lonely-actual.png', 'image/png'),
      a('whydiff/second/markdown', 'text/markdown'),
      a('whydiff/second/snapshot-actual', json),
      a('first-actual.png', 'image/png'),
      a('first-diff.png', 'image/png'),
      a('whydiff/first/markdown', 'text/markdown'),
      a('whydiff/first/snapshot-actual', json),
      a('whydiff/first/snapshot-expected', json),
      a('whydiff/1-first', json),
    ])
    expect(
      pairs.map((p) => [p.name, Object.keys(p.whydiff).sort(), Object.keys(p.images).sort()])
    ).toEqual([
      ['second', ['markdown', 'snapshot-actual'], ['actual', 'expected']],
      ['first', ['markdown', 'snapshot-actual', 'snapshot-expected'], ['actual', 'diff']],
    ])
    expect(pairs[1]?.whydiff['snapshot-expected']?.path).toBe('/x/whydiff/first/snapshot-expected')
  })
})

const step = (
  title: string,
  steps: StepLike[] = [],
  error?: string,
  attachments: ReportedAttachment[] = []
): StepLike => ({
  category: title.startsWith('Expect') ? 'expect' : 'test.step',
  title,
  attachments,
  steps,
  ...(error === undefined ? {} : { error: { message: error } }),
})

const test = (titles: string[], line: number, project = 'chromium') => ({
  project,
  testId: `${project}-${titles.join('-')}`,
  titles,
  file: 'card.spec.ts',
  line,
  repeat: 0,
})

describe('listScreenshots', () => {
  it('lists whydiff pairs in attachment order, then one title-only entry per passed assertion', () => {
    const actual: ReportedAttachment = {
      name: 'b-actual.png',
      contentType: 'image/png',
      path: '/b-actual.png',
    }
    const attachments: ReportedAttachment[] = [
      actual,
      { name: 'whydiff/b/markdown', contentType: 'text/markdown', path: '/b.md' },
      { name: 'whydiff/a/markdown', contentType: 'text/markdown', path: '/a.md' },
    ]
    const steps = [
      step('Expect "toHaveScreenshot(b.png)"', [
        step('Expect "toHaveScreenshot(b.png)"', [], 'x', [actual]),
      ]),
      step('a group', [
        step('Expect "toHaveScreenshot(c.png)"', [step('Expect "toHaveScreenshot(c.png)"')]),
      ]),
      step('Expect "toHaveScreenshot"'),
      step('Expect "toBeVisible"'),
    ]
    const listed = listScreenshots(test(['card', 'renders'], 3), attachments, steps, [])
    expect(
      listed.map((l) => [l.identity.screen, l.identity.title, l.ordinal, l.files?.name])
    ).toEqual([
      ['chromium\x1ecard.spec.ts\x1ecard > renders > b', 'card > renders > b', 0, 'b'],
      ['chromium\x1ecard.spec.ts\x1ecard > renders > a', 'card > renders > a', 1, 'a'],
      ['chromium\x1ecard.spec.ts\x1ecard > renders\x1e#2', 'card > renders', 2, undefined],
      ['chromium\x1ecard.spec.ts\x1ecard > renders\x1e#3', 'card > renders', 3, undefined],
    ])
  })

  it('lists a failed screenshot without a pair after the pairs, named by the images of its step', () => {
    const png = (name: string): ReportedAttachment => ({
      name,
      contentType: 'image/png',
      path: `/${name}`,
    })
    const a = [png('a-expected.png'), png('a-actual.png'), png('a-diff.png')]
    const b = [png('b-expected.png'), png('b-actual.png'), png('b-diff.png')]
    const gone = [png('gone-expected.png')]
    const attachments: ReportedAttachment[] = [
      ...a,
      ...b,
      { name: 'whydiff/b/markdown', contentType: 'text/markdown', body: Buffer.from('#') },
      ...gone,
    ]
    const steps = [
      step('Expect "toHaveScreenshot(a.png)"', [], 'Error: a failed', a),
      step('Expect "toHaveScreenshot(b.png)"', [], 'Error: b failed', b),
      step('Expect "toHaveScreenshot(gone.png)"', [], 'Error: gone failed', gone),
      step(
        'Expect "toHaveScreenshot(fresh.png)"',
        [],
        "Error: A snapshot doesn't exist at /fresh.png."
      ),
      step('Expect "toHaveScreenshot(c.png)"'),
    ]
    const annotations = [{ type: 'whydiff', description: 'a: not explained: ENOENT: no file' }]
    const listed = listScreenshots(test(['card'], 3), attachments, steps, annotations)
    expect(
      listed.map((l) => [
        l.identity.screen,
        l.identity.title,
        l.ordinal,
        l.files?.name,
        l.notExplained,
      ])
    ).toEqual([
      ['chromium\x1ecard.spec.ts\x1ecard > b', 'card > b', 0, 'b', null],
      ['chromium\x1ecard.spec.ts\x1ecard > a', 'card > a', 1, undefined, 'ENOENT: no file'],
      ['chromium\x1ecard.spec.ts\x1ecard > gone', 'card > gone', 2, undefined, 'gone failed'],
      [
        'chromium\x1ecard.spec.ts\x1ecard\x1e#3',
        'card',
        3,
        undefined,
        "A snapshot doesn't exist at /fresh.png.",
      ],
      ['chromium\x1ecard.spec.ts\x1ecard\x1e#4', 'card', 4, undefined, null],
    ])
  })

  it("gives a failed assertion that attached no image its attempt's timeout as the reason when the attempt timed out", () => {
    const actual: ReportedAttachment = {
      name: 'a-actual.png',
      contentType: 'image/png',
      path: '/a-actual.png',
    }
    const closed = 'Error: screencast.showOverlays: Target page, context or browser has been closed'
    const steps = [
      step('Expect "toHaveScreenshot(slow.png)"', [], closed),
      step('Expect "toHaveScreenshot(a.png)"', [], 'Error: a failed', [actual]),
    ]
    const reasons = (timedOut?: string): (string | null)[] =>
      listScreenshots(test(['card'], 3), [], steps, [], timedOut).map((l) => l.notExplained)
    expect(reasons('Test timeout of 30000ms exceeded.')).toEqual([
      'Test timeout of 30000ms exceeded.',
      'a failed',
    ])
    expect(reasons()).toEqual([closed.replace(/^Error: /, ''), 'a failed'])
  })

  it('lists a diff no step names with the fixed reason, as a run rebuilt without steps has it', () => {
    const attachments: ReportedAttachment[] = [
      { name: 'card-actual.png', contentType: 'image/png', path: '/card-actual.png' },
      { name: 'card-diff.png', contentType: 'image/png', path: '/card-diff.png' },
    ]
    const [listed] = listScreenshots(test(['card'], 3), attachments, [], [])
    expect(listed?.identity.title).toBe('card > card')
    expect(listed?.notExplained).toMatch(/^no whydiff annotation names it: /)
  })

  it('sorts by project, file, line, title and ordinal', () => {
    const entries = [
      ...listScreenshots(test(['z'], 9), [], [step('Expect "toHaveScreenshot"')], []),
      ...listScreenshots(
        test(['b'], 2),
        [],
        [step('Expect "toHaveScreenshot"'), step('Expect "toHaveScreenshot"')],
        []
      ),
      ...listScreenshots(test(['a'], 2), [], [step('Expect "toHaveScreenshot"')], []),
      ...listScreenshots(test(['a'], 1, 'firefox'), [], [step('Expect "toHaveScreenshot"')], []),
    ]
    expect(
      entries
        .sort(compareListed)
        .map((e) => `${e.identity.project} ${e.identity.title} ${String(e.ordinal)}`)
    ).toEqual(['chromium a 0', 'chromium b 0', 'chromium b 1', 'chromium z 0', 'firefox a 0'])
  })
})

describe('acrossAttempts', () => {
  const card = test(['card'], 3)

  /** One attempt of the card test: a pair for each failed name, its Markdown under the attempt's directory, then the passed names. */
  const attempt = (retry: number, failed: string[], passed: string[] = []): Listed[] =>
    listScreenshots(
      card,
      failed.map((name) => ({
        name: `whydiff/${name}/markdown`,
        contentType: 'text/markdown',
        path: `/retry${String(retry)}/${name}.md`,
      })),
      [
        ...failed.map((name) =>
          step(`Expect "toHaveScreenshot(${name}.png)"`, [], 'Error: x', [
            { name: `${name}-actual.png`, contentType: 'image/png', path: `/${name}-actual.png` },
          ])
        ),
        ...passed.map((name) => step(`Expect "toHaveScreenshot(${name}.png)"`)),
      ],
      []
    )

  const taken = (attempts: Listed[][]): (string | null)[][] =>
    acrossAttempts(card, attempts).map((l) => [
      l.files?.name ?? `#${String(l.ordinal)}`,
      l.files?.whydiff.markdown?.path ?? null,
    ])

  it('is the attempt itself for a test that ran once', () => {
    expect(acrossAttempts(card, [attempt(0, ['a'], ['b', 'c'])])).toEqual(
      attempt(0, ['a'], ['b', 'c'])
    )
  })

  it('keeps a screenshot the retry never reached, as the attempt that failed it lists it', () => {
    expect(taken([attempt(0, ['a']), attempt(1, [])])).toEqual([['a', '/retry0/a.md']])
    expect(taken([attempt(0, ['a', 'b']), attempt(1, ['a'])])).toEqual([
      ['b', '/retry0/b.md'],
      ['a', '/retry1/a.md'],
    ])
  })

  it('keeps a screenshot that failed and then passed on retry as failed, and counts it once', () => {
    expect(taken([attempt(0, ['a']), attempt(1, [], ['a'])])).toEqual([['a', '/retry0/a.md']])
    expect(taken([attempt(0, ['a'], ['b']), attempt(1, [], ['a', 'b'])])).toEqual([
      ['a', '/retry0/a.md'],
      ['#1', null],
    ])
  })

  it('takes a screenshot that failed again from the retry', () => {
    expect(taken([attempt(0, ['a']), attempt(1, ['a']), attempt(2, [])])).toEqual([
      ['a', '/retry1/a.md'],
    ])
  })

  it('keeps the passed screenshots of the attempt that reached the most, as a serial retry that skips the test leaves them', () => {
    expect(taken([attempt(0, [], ['a', 'b']), attempt(1, [])])).toEqual([
      ['#0', null],
      ['#1', null],
    ])
  })
})

describe('notExplainedReason', () => {
  const whydiff = (description: string) => ({ type: 'whydiff', description })

  it('takes the first line after the label that names the attachment exactly', () => {
    const annotations = [
      { type: 'other', description: 'topass: not explained: not ours' },
      whydiff('topass-1: not explained: the second attempt'),
      whydiff('topass.png baseline snapshot not kept: a pass'),
      whydiff('topass: not explained: skipped after 61000 ms, over the budget of 60000 ms.\nmore'),
      whydiff('shop\\card: not explained: a nested name on Windows'),
    ]
    expect(notExplainedReason('topass', annotations)).toBe(
      'skipped after 61000 ms, over the budget of 60000 ms.'
    )
    expect(notExplainedReason('topass-1', annotations)).toBe('the second attempt')
    expect(notExplainedReason('topass-2', annotations)).toBeNull()
    expect(notExplainedReason('shop\\card', annotations)).toBe('a nested name on Windows')
    expect(notExplainedReason('card', annotations)).toBeNull()
  })

  it('names another browser for every screenshot of its test, named or not', () => {
    const browser = 'webkit screenshots are not explained: whydiff captures in Chromium only'
    expect(notExplainedReason('card', [whydiff(browser)])).toBe(browser)
    expect(notExplainedReason(null, [whydiff(browser)])).toBe(browser)
  })

  it('finds nothing for a screenshot without a name or without an annotation', () => {
    expect(notExplainedReason(null, [whydiff('card: not explained: other')])).toBeNull()
    expect(notExplainedReason('card', [])).toBeNull()
  })

  it('reads the label the matcher writes', () => {
    const description = `${notExplainedLabel('card')}: ${noActualImage(undefined)}`
    expect(description).toBe('card: not explained: the assertion produced no actual image')
    expect(notExplainedReason('card', [whydiff(description)])).toBe(
      'the assertion produced no actual image'
    )
  })
})

describe('errorLine', () => {
  it("joins Playwright's header with the indented detail under it", () => {
    expect(
      errorLine(
        "Error: \u001b[2mexpect(\u001b[22m\u001b[31mlocator\u001b[39m\u001b[2m).\u001b[22mtoHaveScreenshot\u001b[2m(\u001b[22m\u001b[32mexpected\u001b[39m\u001b[2m)\u001b[22m failed\n\nLocator: locator('#gone')\nTimeout: 500ms\n  Timeout 500ms exceeded.\n\n  Snapshot: gone.png"
      )
    ).toBe('expect(locator).toHaveScreenshot(expected) failed: Timeout 500ms exceeded.')
    expect(
      errorLine(
        'Screenshot comparison failed:\n\n  Expected result should be different from the actual one.'
      )
    ).toBe('Screenshot comparison failed: Expected result should be different from the actual one.')
  })

  it('reads the header of earlier releases, the bare call, and keeps their one-line timeout', () => {
    expect(
      errorLine(
        'Error: expect(page).toHaveScreenshot(expected)\n\n  1,200 pixels (ratio 0.01 of all image pixels) are different.\n\nExpected: /e.png'
      )
    ).toBe(
      'expect(page).toHaveScreenshot(expected): 1,200 pixels (ratio 0.01 of all image pixels) are different.'
    )
    expect(
      errorLine(
        "Timed out 500ms waiting for expect(locator).toHaveScreenshot(expected)\n\nLocator: locator('#gone')\n  Timeout 500ms exceeded."
      )
    ).toBe('Timed out 500ms waiting for expect(locator).toHaveScreenshot(expected)')
  })

  it('keeps a first line that announces no detail as it is', () => {
    expect(
      errorLine('page.screenshot: Timeout 500ms exceeded.\nCall log:\n  - taking page screenshot')
    ).toBe('page.screenshot: Timeout 500ms exceeded.')
    expect(errorLine("Error: A snapshot doesn't exist at /fresh.png.")).toBe(
      "A snapshot doesn't exist at /fresh.png."
    )
    expect(errorLine('TargetClosedError: the page closed')).toBe(
      'TargetClosedError: the page closed'
    )
  })

  it('wraps the error of an assertion without an actual image', () => {
    expect(noActualImage('Error: the page closed')).toBe(
      'the assertion produced no actual image (the page closed)'
    )
  })
})
