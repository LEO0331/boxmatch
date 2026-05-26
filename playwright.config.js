const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tools/e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.BOXMATCH_E2E_BASE_URL || 'http://127.0.0.1:8787',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node tools/e2e/static_server.mjs build/web 8787',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
