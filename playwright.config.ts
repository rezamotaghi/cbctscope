// The web build's end-to-end suite (docs/web-build.md, section 8): Chromium only, against the
// static export on a loopback static server. Run through `npm run test:e2e`, which also builds
// the low-threshold variant into out-small/ for the size-notice test.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const SMALL_PORT = 4174;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1600, height: 1000 },
    // WebGL in headless Chromium: software rendering through SwiftShader
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    {
      name: 'web',
      testIgnore: /size-notice/,
      use: { baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      name: 'low-threshold',
      testMatch: /size-notice/,
      use: { baseURL: `http://127.0.0.1:${SMALL_PORT}` },
    },
  ],
  webServer: [
    {
      command: `node scripts/serve-out.mjs out ${PORT}`,
      url: `http://127.0.0.1:${PORT}/`,
      reuseExistingServer: false,
    },
    {
      command: `node scripts/serve-out.mjs out-small ${SMALL_PORT}`,
      url: `http://127.0.0.1:${SMALL_PORT}/`,
      reuseExistingServer: false,
    },
  ],
});
