import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 12000 },
  use: {
    baseURL: 'http://127.0.0.1:5183',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1050 } } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5183',
    reuseExistingServer: false,
    env: { SIMULATION_TEST_MODE: '1', SIMULATION_OFFLINE: '1', SIMULATION_DATA_FILE: ':memory:', MISTRAL_API_KEY: '', API_PORT: '3013', WEB_PORT: '5183' },
  },
})
