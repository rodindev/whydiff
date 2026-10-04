import { readFile } from 'node:fs/promises'
import { dirname, relative, sep } from 'node:path'

import { walkFiles } from './walk.js'

/** One spec file that calls `toHaveScreenshot`, and how it takes `test` and `expect`. */
export interface ScreenshotSpec {
  readonly path: string
  readonly text: string
  /** True when it takes `test` or `expect` from `@playwright/test`, where `withWhydiff` never runs. */
  readonly plain: boolean
  /** Its text with `test` and `expect` taken from the fixtures file instead; null when it is not plain or its import is in a form that is not safe to rewrite. */
  readonly rewritten: string | null
}

// Playwright's default testMatch: `.spec` or `.test` before any script extension.
const SPEC_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/
// An import from `@playwright/test`, over several lines too: the clause, the quote and the semicolon.
const PLAYWRIGHT_IMPORT = /^import\s+([^;'"]*?)\s*from\s*(['"])@playwright\/test\2(;?)/gm
// `const { test, expect } = require('@playwright/test')` and the like, which init leaves alone.
const REQUIRED = /\b(?:test|expect)\b[^;=]*=\s*require\(\s*['"]@playwright\/test['"]\s*\)/
const RUNNERS: ReadonlySet<string> = new Set(['test', 'expect'])
const ALIASED_RUNNER = /^(?:test|expect)\s+as\s/
const SCRIPT_EXTENSION = /\.[cm]?[jt]sx?$/
const JS_EXTENSION = /\.[cm]?jsx?$/
const RELATIVE_EXTENSION = /\bfrom\s+['"]\.\.?\/[^'"]*?(\.[cm]?[jt]s)['"]/

/** The spec files under `dir` that call `toHaveScreenshot` and not `withWhydiff`, in walk order, each with the rewrite that takes `test` and `expect` from `fixtures`. */
export async function screenshotSpecs(dir: string, fixtures: string): Promise<ScreenshotSpec[]> {
  const specs: ScreenshotSpec[] = []
  for (const path of (await walkFiles(dir).catch(() => [])).filter((f) => SPEC_FILE.test(f))) {
    const text = await readFile(path, 'utf8')
    if (!text.includes('toHaveScreenshot') || text.includes('withWhydiff(')) continue
    specs.push({ path, text, ...rewrite(text, importPath(path, fixtures, text)) })
  }
  return specs
}

function rewrite(text: string, from: string): { plain: boolean; rewritten: string | null } {
  let plain = REQUIRED.test(text)
  let safe = !plain
  const rewritten = text.replace(
    PLAYWRIGHT_IMPORT,
    (statement: string, clause: string, quote: string, semi: string) => {
      if (clause.startsWith('type ')) return statement
      const named = /^\{([^}]*)\}$/.exec(clause)?.[1]
      if (named === undefined) {
        plain = true
        safe = false
        return statement
      }
      const specifiers = named
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
      const runners = specifiers.filter((s) => RUNNERS.has(s))
      if (specifiers.some((s) => ALIASED_RUNNER.test(s))) {
        plain = true
        safe = false
      }
      if (runners.length === 0) return statement
      plain = true
      const kept = specifiers.filter((s) => !RUNNERS.has(s))
      return [
        ...(kept.length > 0
          ? [`import { ${kept.join(', ')} } from ${quote}@playwright/test${quote}${semi}`]
          : []),
        `import { ${runners.join(', ')} } from ${quote}${from}${quote}${semi}`,
      ].join('\n')
    }
  )
  return { plain, rewritten: plain && safe ? rewritten : null }
}

// Relative to the spec, with the extension its own relative imports carry, else none for a
// TypeScript fixtures file, which Playwright resolves without one, and the file's own for a
// JavaScript one, which Node's ESM loader needs.
function importPath(spec: string, fixtures: string, text: string): string {
  const path = relative(dirname(spec), fixtures).split(sep).join('/')
  const relativePath = path.startsWith('.') ? path : `./${path}`
  const bare = relativePath.replace(SCRIPT_EXTENSION, '')
  const used = RELATIVE_EXTENSION.exec(text)?.[1]
  if (used !== undefined) return `${bare}${used}`
  return JS_EXTENSION.test(fixtures) ? relativePath : bare
}
