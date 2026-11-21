import { defineConfig, devices } from '@playwright/test'

/**
 * Browser end-to-end tests against a REAL local Supabase stack (not demo data).
 * Needs SUPABASE_API_URL and SUPABASE_ANON_KEY (local: `npx supabase status`).
 * The app is built in Supabase mode into dist-e2e and served by `vite preview` on :4174.
 * Locally, PW_CHANNEL=chrome uses the installed Chrome instead of a downloaded browser.
 */
const API = process.env.SUPABASE_API_URL ?? ''
const ANON = process.env.SUPABASE_ANON_KEY ?? ''

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) } },
  ],
  webServer: {
    command: 'npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port 4174 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4174',
    timeout: 240_000,
    reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: API, VITE_SUPABASE_ANON_KEY: ANON, VITE_DATA_MODE: 'supabase' },
  },
})
