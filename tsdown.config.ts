import { defineConfig } from 'tsdown'

export default defineConfig({
  workspace: true,
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  fixedExtension: false,
  dts: true,
  deps: { onlyBundle: [] },
  publint: true,
  failOnWarn: true,
})
