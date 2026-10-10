'use strict';
const { defineConfig } = require('@playwright/test');

/* E2E com navegadores reais. Sobe o próprio servidor na porta 3100.
   CHROMIUM_PATH (opcional): usa um Chromium já instalado em vez do baixado pelo Playwright. */
module.exports = defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] }
      : {}
  },
  webServer: {
    command: 'node server.js',
    url: 'http://127.0.0.1:3100/health',
    env: { PORT: '3100', MAX_CONNS_IP: '60' },
    reuseExistingServer: !process.env.CI,
    timeout: 15_000
  }
});
