// Playwright config — Round C smoke + R5.2 virtual-timeline gate.
//
// Single browser (chromium) on the local machine; no matrix yet. The
// dev server is started by Playwright itself with the test mode flag
// flipped, so each spec runs against a fresh isolated app entry that
// doesn't need a live `privchat-server` to be reachable.
//
// R5.2: when the parent process sets `VITE_PRIVCHAT_VIRTUAL_TIMELINE=1`,
// we forward that into the spawned dev server's environment so the
// app boots through the virtual MessageList path. The whole smoke
// suite re-runs against that path via `pnpm test:e2e:virtual`. We
// also disable webServer reuse in that mode to avoid silently
// re-using a stale plain-mode server cached from an earlier run.
//
// `webServer.command` writes the env flag inline; CI doesn't need a
// separate `.env.test` file.

import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;

const virtualTimelineFlag =
  process.env.VITE_PRIVCHAT_VIRTUAL_TIMELINE === '1'
    ? 'VITE_PRIVCHAT_VIRTUAL_TIMELINE=1 '
    : '';

export default defineConfig({
  testDir: './tests/smoke',
  // Smoke specs are short — 30s per test is generous; flaking past
  // that means the harness is broken, not slow.
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? 'dot' : 'list',
  // CI runs without retries — flakes should fail loud.
  retries: process.env.CI ? 0 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Start the Vite dev server with the test-harness env flag so
    // `main.tsx` swaps in `<TestApp/>`. Port-locked so specs can rely
    // on a fixed `baseURL`.
    command: `VITE_PRIVCHAT_TEST_MODE=mock ${virtualTimelineFlag}pnpm exec vite --port ${PORT} --strictPort`,
    port: PORT,
    // Reuse a running dev server locally (fast iteration) — but only
    // when env-mode matches. In virtual mode we always restart, so
    // we don't accidentally hit a cached plain-mode server.
    reuseExistingServer: !process.env.CI && virtualTimelineFlag === '',
    timeout: 60_000,
  },
});
