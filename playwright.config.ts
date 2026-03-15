import path from 'path'
import { defineConfig, devices } from '@playwright/test'

const artifactStamp = process.env.PLAYWRIGHT_ARTIFACT_STAMP ?? new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const playwrightDatabaseUrl = process.env.PLAYWRIGHT_DATABASE_URL ?? 'file:./dev.db'
const playwrightPort = process.env.PLAYWRIGHT_APP_PORT ?? '3100'
const playwrightBaseUrl = `http://127.0.0.1:${playwrightPort}`

process.env.PLAYWRIGHT_ARTIFACT_STAMP = artifactStamp

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60000,
  reporter: [['list']],
  use: {
    baseURL: playwrightBaseUrl,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  outputDir: path.join('tests', 'artifacts', 'results', artifactStamp),
  webServer: {
    command: 'npm run dev',
    env: {
      ...process.env,
      DATABASE_URL: playwrightDatabaseUrl,
      APP_URL: playwrightBaseUrl,
      APP_PORT: playwrightPort,
      PORT: playwrightPort,
    },
    url: playwrightBaseUrl,
    reuseExistingServer: false,
    timeout: 120000,
  },
})