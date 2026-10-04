import { defineConfig } from '@playwright/test'

export default defineConfig({
  testMatch: 'screens.spec.ts',
  workers: 1,
  reporter: [
    ['@whydiff/playwright/reporter'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'results.json' }],
  ],
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 480, height: 320 } },
  webServer: { command: 'node serve.ts', url: 'http://127.0.0.1:4173/settings.html' },
})
