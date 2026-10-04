import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

/** @param {string} selector */
const privateMember = (selector) => ({
  selector,
  message: 'Underscore-prefixed members are private to their owner; use the public API.',
})

const TEST_API = '/^(describe|it|test)$/'

/**
 * @param {string} mode
 * @param {string} message
 */
const testMode = (mode, message) => [
  {
    selector: `MemberExpression[property.name="${mode}"]:matches([object.name=${TEST_API}], [object.object.name=${TEST_API}])`,
    message,
  },
  {
    selector: `CallExpression:matches([callee.name=${TEST_API}], [callee.object.name=${TEST_API}]) > ObjectExpression > Property[key.name="${mode}"]`,
    message,
  },
]

export default defineConfig(
  { ignores: ['**/dist/', '**/coverage/', '**/fixtures/', '**/.*/', '!.github/'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        privateMember('MemberExpression > Identifier.property[name=/^_/]'),
        privateMember('MemberExpression > Literal.property[value=/^_/]'),
        privateMember('ObjectPattern > Property > Identifier.key[name=/^_/]'),
        ...testMode(
          'only',
          'A focused test leaves the rest of the suite out of the gate; remove the only.'
        ),
        ...testMode(
          'skip',
          'A skipped test passes the gate without running; fix the test or delete it.'
        ),
        ...testMode('todo', 'A todo test is a TODO; open an issue instead.'),
      ],
      'no-warning-comments': ['error', { location: 'anywhere' }],
    },
  },
  {
    files: ['*.js', '*.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['packages/core/src/**'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:*',
                'fs',
                'path',
                'os',
                'process',
                'child_process',
                'http',
                'https',
                'net',
              ],
              message: '@whydiff/core is platform neutral; keep I/O in the adapters.',
            },
          ],
        },
      ],
    },
  },
  prettier
)
