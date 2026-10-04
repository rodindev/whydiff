import { defineConfig } from 'vitest/config'

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ['whydiff-source'],
    },
  },
  test: {
    globals: true,
    include: ['packages/*/src/**/*.spec.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
      exclude: ['**/*.spec.ts'],
    },
  },
})
