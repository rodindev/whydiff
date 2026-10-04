import { clusterCauses } from '../cluster/cluster.js'
import {
  button,
  customProperties,
  fieldReset,
  formControls,
  markdownTraps,
  page,
  ruleFamilies,
  ruleMove,
  screenOf,
} from '../testing/screens.js'
import { buildReport } from './build.js'
import { renderRunPage } from './html.js'
import { screenshotId } from './ids.js'
import { renderReport, renderScreenshot } from './render.js'
import { serializeReport } from './serialize.js'
import type { ScreenInput } from './types.js'

const padded = (name: string, text: string, to: string): ScreenInput =>
  screenOf(
    name,
    page([button(10, {}, text)]),
    page([button(10, { 'padding-left': to }, text)]),
    [[10, 10, 80, 30]],
    {
      file: 'tests/buttons.spec.ts',
      project: 'chromium',
    }
  )

describe('report goldens', () => {
  it('pins the four-screen cluster run', async () => {
    const screens = [
      padded('s1', 'Save it', '8px'),
      padded('s2', 'Cancel it', '8px'),
      padded('s3', 'Reset it', '12px'),
      screenOf(
        's4',
        page([
          button(10, {}, 'Lonely one'),
          { tag: 'img', box: [300, 300, 200, 100], cls: ['hero'] },
        ]),
        page([
          button(10, { color: 'rgb(9, 9, 9)' }, 'Lonely one'),
          { tag: 'img', box: [300, 300, 200, 100], cls: ['hero'] },
        ]),
        [
          [10, 10, 80, 30],
          [320, 320, 50, 50],
        ],
        { file: 'tests/hero.spec.ts', line: 40, project: 'chromium' }
      ),
      screenOf('s5', page([button(10)]), page([button(10)]), []),
    ]
    const report = buildReport({
      version: '0.0.1',
      compared: {
        before: 'main',
        after: 'feat/buttons',
        browser: 'chromium 147',
        viewport: '1000x800',
      },
      screens,
      clusters: clusterCauses(screens.filter((s) => s.regions.length > 0)),
    })
    await expect(serializeReport(report)).toMatchFileSnapshot(
      '../../fixtures/report/run/report.json'
    )
    await expect(renderReport(report)).toMatchFileSnapshot('../../fixtures/report/run/report.md')
    await expect(renderRunPage(report)).toMatchFileSnapshot('../../fixtures/report/run/report.html')
  })

  it('pins a run with rule clusters', async () => {
    const screens = ruleFamilies()
    const report = buildReport({
      version: '0.0.1',
      compared: { before: 'main', after: 'feat/framework-upgrade' },
      screens,
      clusters: clusterCauses(screens),
    })
    await expect(serializeReport(report)).toMatchFileSnapshot(
      '../../fixtures/report/rules/report.json'
    )
    await expect(renderReport(report)).toMatchFileSnapshot('../../fixtures/report/rules/report.md')
    await expect(renderRunPage(report)).toMatchFileSnapshot(
      '../../fixtures/report/rules/report.html'
    )
  })

  it('pins a rule that moved across builds', async () => {
    const screens = ruleMove()
    const report = buildReport({
      version: '0.0.1',
      compared: { before: 'main', after: 'feat/framework-upgrade' },
      screens,
      clusters: clusterCauses(screens),
    })
    await expect(serializeReport(report)).toMatchFileSnapshot(
      '../../fixtures/report/rule-move/report.json'
    )
    await expect(renderReport(report)).toMatchFileSnapshot(
      '../../fixtures/report/rule-move/report.md'
    )
    await expect(renderRunPage(report)).toMatchFileSnapshot(
      '../../fixtures/report/rule-move/report.html'
    )
  })

  it('pins an element under two rules, a reset that now sets its paddings and a rule that is gone', async () => {
    const screens = fieldReset()
    const report = buildReport({
      version: '0.0.1',
      compared: { before: 'main', after: 'feat/form-reset' },
      screens,
      clusters: clusterCauses(screens),
    })
    await expect(serializeReport(report)).toMatchFileSnapshot(
      '../../fixtures/report/field-reset/report.json'
    )
    await expect(renderReport(report)).toMatchFileSnapshot(
      '../../fixtures/report/field-reset/report.md'
    )
    await expect(renderRunPage(report)).toMatchFileSnapshot(
      '../../fixtures/report/field-reset/report.html'
    )
  })

  it('pins the notes of regions inside form controls', async () => {
    const screens = formControls()
    const report = buildReport({
      version: '0.0.1',
      compared: { before: 'main', after: 'feat/form-reset' },
      screens,
      clusters: clusterCauses(screens),
    })
    await expect(serializeReport(report)).toMatchFileSnapshot(
      '../../fixtures/report/form-controls/report.json'
    )
    await expect(renderReport(report)).toMatchFileSnapshot(
      '../../fixtures/report/form-controls/report.md'
    )
    await expect(renderRunPage(report)).toMatchFileSnapshot(
      '../../fixtures/report/form-controls/report.html'
    )
  })

  it('pins what Markdown would misread, in the run and on a screenshot', async () => {
    const screens = markdownTraps()
    const report = buildReport({
      version: '0.0.1',
      compared: { before: 'main', after: 'feat/ui-upgrade' },
      screens,
      clusters: clusterCauses(screens),
    })
    await expect(serializeReport(report)).toMatchFileSnapshot(
      '../../fixtures/report/markdown/report.json'
    )
    await expect(renderReport(report)).toMatchFileSnapshot(
      '../../fixtures/report/markdown/report.md'
    )
    await expect(renderRunPage(report)).toMatchFileSnapshot(
      '../../fixtures/report/markdown/report.html'
    )
    await expect(renderScreenshot(report, screenshotId('s1'))).toMatchFileSnapshot(
      '../../fixtures/report/markdown/screenshot.md'
    )
  })

  it('pins the six ways a custom property reaches a longhand and a browser default a rule now wins over', async () => {
    const screens = customProperties()
    const report = buildReport({
      version: '0.0.1',
      compared: { before: 'main', after: 'feat/tokens' },
      screens,
      clusters: clusterCauses(screens),
    })
    await expect(serializeReport(report)).toMatchFileSnapshot(
      '../../fixtures/report/custom-properties/report.json'
    )
    await expect(renderReport(report)).toMatchFileSnapshot(
      '../../fixtures/report/custom-properties/report.md'
    )
    await expect(renderRunPage(report)).toMatchFileSnapshot(
      '../../fixtures/report/custom-properties/report.html'
    )
    await expect(renderScreenshot(report, screenshotId('s1'))).toMatchFileSnapshot(
      '../../fixtures/report/custom-properties/screenshot.md'
    )
  })

  it('pins a run without changes', async () => {
    const same = page([button(10)])
    const screens = [screenOf('s1', same, same, []), screenOf('s2', same, same, [])]
    const report = buildReport({
      version: '0.0.1',
      compared: { before: 'main', after: 'main' },
      screens,
      clusters: clusterCauses([]),
    })
    await expect(serializeReport(report)).toMatchFileSnapshot(
      '../../fixtures/report/no-change/report.json'
    )
    await expect(renderReport(report)).toMatchFileSnapshot(
      '../../fixtures/report/no-change/report.md'
    )
    await expect(renderRunPage(report)).toMatchFileSnapshot(
      '../../fixtures/report/no-change/report.html'
    )
  })
})
