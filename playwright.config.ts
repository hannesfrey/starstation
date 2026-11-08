import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  // the whole run takes ~5 min: a run that hangs fails instead of blocking for ever
  globalTimeout: 20 * 60_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'tools/cache/playwright-results'
})
