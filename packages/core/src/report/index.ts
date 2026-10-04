export { buildReport, describeRun } from './build.js'
export { code, count, plain, plural } from './format.js'
export { renderRunPage } from './html.js'
export { screenshotId } from './ids.js'
export { locatorFor } from './locator.js'
export { parseReport } from './parse.js'
export {
  bareHeadline,
  changedLines,
  describeEffect,
  describeMemberChanges,
  describeRegion,
  describeUnchanged,
  noneExplained,
  renderReport,
  renderScreenshot,
  type ChangedLine,
} from './render.js'
export { analyzeScreen, type ScreenSource } from './screen.js'
export { serializeReport } from './serialize.js'
export {
  REPORT_FORMAT_VERSION,
  type CauseDraft,
  type CauseV1,
  type ComparedV1,
  type EffectV1,
  type ExampleV1,
  type FactKind,
  type FactV1,
  type LeadV1,
  type MatchWord,
  type MemberChangeV1,
  type MemberV1,
  type ObservationV1,
  type RenderOptions,
  type ReportDraft,
  type ReportInput,
  type ReportV1,
  type ScreenInput,
  type ScreenshotStatus,
  type ScreenshotV1,
  type UnexplainedV1,
} from './types.js'
export { validateReport } from './validate.js'
