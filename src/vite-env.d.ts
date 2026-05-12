/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to `'mock'` by the Playwright test build to swap the app
   *  entry to the mock harness. Unset / any other value → production
   *  app boots normally. */
  readonly VITE_PRIVCHAT_TEST_MODE?: string;
  /** R5.2 — set to `'1'` to opt the timeline into the virtualized
   *  renderer. Default OFF: the plain MessageList path stays as
   *  the production code path until the virtual timeline has
   *  bedded in. */
  readonly VITE_PRIVCHAT_VIRTUAL_TIMELINE?: string;
  /** R8.1 — selects which account system the build authenticates
   *  against. `'builtin'` (default) talks to the
   *  `privchat-server`'s `account/auth/login` RPC; `'platform'`
   *  routes through `privchat-application`'s HTTP API for auth +
   *  profile + QR + SMS. Picked at compile time; toggling
   *  requires a rebuild. See docs/PLATFORM_ACCOUNT_MODE_DESIGN.md. */
  readonly VITE_PRIVCHAT_ACCOUNT_MODE?: string;
  /** R8.1 — required when `VITE_PRIVCHAT_ACCOUNT_MODE === 'platform'`.
   *  Root URL of the platform's app routes (e.g.
   *  `https://app.example.com/app`), no trailing slash. Ignored
   *  in builtin mode. */
  readonly VITE_PRIVCHAT_PLATFORM_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
