// The web build's end-to-end suite (docs/web-build.md, section 8): Chromium only, against the
// static export on a loopback static server. Run through `npm run test:e2e`, which also builds
// the low-threshold variant into out-small/ for the size-notice test and the base-path
// variant into out-base/ (served under /cbctscope) for the base-path test.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const SMALL_PORT = 4174;
const BASE_PORT = 4175;
/** the base path of the sub-path build (the release builds the site for the root) */
const BASE_PATH = '/cbctscope';

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
      testIgnore: /size-notice|base-path/,
      use: { baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      name: 'low-threshold',
      testMatch: /size-notice/,
      use: { baseURL: `http://127.0.0.1:${SMALL_PORT}` },
    },
    {
      name: 'base-path',
      testMatch: /base-path/,
      use: { baseURL: `http://127.0.0.1:${BASE_PORT}` },
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
    {
      command: `node scripts/serve-out.mjs out-base ${BASE_PORT} --prefix ${BASE_PATH}`,
      url: `http://127.0.0.1:${BASE_PORT}${BASE_PATH}/`,
      reuseExistingServer: false,
    },
  ],
});
