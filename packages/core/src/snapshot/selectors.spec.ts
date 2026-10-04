import { selectorList, selectorSubject } from './selectors.js'

describe('selectorList', () => {
  it('splits a list at its top-level commas and trims each selector', () => {
    expect(selectorList('.ui-col-12, .ui-col-6,.ui-col')).toEqual([
      '.ui-col-12',
      '.ui-col-6',
      '.ui-col',
    ])
    expect(selectorList('.ui-col')).toEqual(['.ui-col'])
  })

  it('keeps commas inside functions, attribute values and escapes', () => {
    expect(selectorList(':is(.ui-row, .ui-grid) > .ui-col, .ui-cell')).toEqual([
      ':is(.ui-row, .ui-grid) > .ui-col',
      '.ui-cell',
    ])
    expect(selectorList('[title="a, b"], [data-x=\'c,)\'], .ui-w-1\\,5')).toEqual([
      '[title="a, b"]',
      "[data-x='c,)']",
      '.ui-w-1\\,5',
    ])
  })
})

describe('selectorSubject', () => {
  const alone = { context: [], typed: false, qualified: false }

  it('takes the classes of the last compound, outside pseudo-classes and their arguments', () => {
    expect(selectorSubject('.ui-card')).toEqual({ ...alone, classes: ['ui-card'] })
    expect(selectorSubject('.ui-tab:hover::before')).toEqual({ ...alone, classes: ['ui-tab'] })
    expect(selectorSubject('.ui-tab.is-on')).toEqual({ ...alone, classes: ['ui-tab', 'is-on'] })
    expect(selectorSubject(':where(.css-1x).ui-btn:not(.ui-btn--off)')).toEqual({
      ...alone,
      classes: ['ui-btn'],
    })
    expect(selectorSubject(':where(.ui-row > :not(:last-child))')).toEqual({
      ...alone,
      classes: [],
    })
    expect(selectorSubject('*.ui-box')).toEqual({ ...alone, classes: ['ui-box'] })
  })

  it('keeps the classes of each compound before it, and says what narrows the last one', () => {
    expect(selectorSubject('.ui-panel .ui-link')).toEqual({
      classes: ['ui-link'],
      context: [['ui-panel']],
      typed: false,
      qualified: true,
    })
    expect(selectorSubject('.ui-list.is-open > li')).toEqual({
      classes: [],
      context: [['ui-list', 'is-open']],
      typed: true,
      qualified: true,
    })
    expect(selectorSubject('nav button.ui-action')).toEqual({
      classes: ['ui-action'],
      context: [],
      typed: true,
      qualified: true,
    })
    expect(selectorSubject('#main.ui-page')).toEqual({
      ...alone,
      classes: ['ui-page'],
      qualified: true,
    })
    expect(selectorSubject('.ui-tab[aria-selected="true"]')).toEqual({
      ...alone,
      classes: ['ui-tab'],
      qualified: true,
    })
  })

  it('unescapes class names as the browser serializes them', () => {
    expect(selectorSubject('.hover\\:ui-box:hover').classes).toEqual(['hover:ui-box'])
    expect(selectorSubject('.step-1\\.5').classes).toEqual(['step-1.5'])
    expect(selectorSubject('.span-\\[42px\\]').classes).toEqual(['span-[42px]'])
    expect(selectorSubject('.\\32 up\\:ui-box').classes).toEqual(['2up:ui-box'])
  })
})
