# Isolated real-IM browser acceptance

These scripts drive production Web/H5 components through real builtin login and
real WebSocket RPC. They do not inject tokens, replace adapters, or mock requests.
They must never target production services.

Set `PRIVCHAT_REAL_IM_FIXTURE` to an explicitly supplied disposable
`/tmp/privchat-features-im.*` fixture with private `accounts.json` and `public.json`.
The preparation script only permits the isolated gateway port 58410. It creates
a separate browser group and records `browser-group.json`; group 14 is reserved
for mobile acceptance and must not be mutated. Preparation and history seeding
are one-time operations, not prerequisites to repeat on every run.

Serve production Web on 127.0.0.1:5186 and H5 on 127.0.0.1:10086 with builtin
authentication and ws://127.0.0.1:58410/gate embedded at build time:

```sh
# Web, without sibling-repository prebuild scripts
pnpm exec tsc -b
VITE_PRIVCHAT_TEST_MODE=real VITE_PRIVCHAT_ACCOUNT_MODE=builtin VITE_PRIVCHAT_GATEWAY_URL=ws://127.0.0.1:58410/gate pnpm exec vite build
pnpm exec vite preview --host 127.0.0.1 --port 5186 --strictPort

# H5, from its own repository
TARO_APP_PRIVCHAT_GATEWAY_URL=ws://127.0.0.1:58410/gate TARO_APP_PRIVCHAT_AUTH_MODE=builtin NODE_ENV=production pnpm exec taro build --type h5
pnpm exec vite preview --host 127.0.0.1 --port 10086 --strictPort
```

Use the existing Playwright CLI session `four-feature-web`. Run stages from Web:

```sh
npx --offline --yes --package @playwright/cli playwright-cli -s=four-feature-web open http://127.0.0.1:5186/
node tests/real-im/run-cli.mjs tests/real-im/web-login.mjs
node tests/real-im/run-cli.mjs tests/real-im/h5-login.mjs
node tests/real-im/run-cli.mjs tests/real-im/pin-live.mjs
node tests/real-im/run-cli.mjs tests/real-im/web-cold-pin.mjs
node tests/real-im/run-cli.mjs tests/real-im/h5-cold-pin.mjs
node tests/real-im/run-cli.mjs tests/real-im/introduction-live.mjs
node tests/real-im/run-cli.mjs tests/real-im/reconnect-live.mjs
node tests/real-im/run-cli.mjs tests/real-im/cold-profile-reconciliation.mjs
```

Login stages assume a newly prepared, short history. After `seed-history.mjs`,
cold-pin stages require original pinned messages to be absent initially. A failed
locator, timeout, or prerequisite is a failed gate, never an implicit pass.
The runner redacts fixture passwords/tokens from CLI output and removes its
temporary private script. Preserve logs/screenshots outside Playwright's wiped
test-results directory. Inspect the acceptance report for actually executed
results, source hashes, and any residual gaps; the existence of a script is not
acceptance evidence.

Reconnect fault injection closes actual browser WebSockets and disables network
temporarily. It never synthesizes server messages. `reconnect-live.mjs` delegates
to the focused gate, which creates fresh real reader/writer sessions, verifies
authoritative server IDs after offline removal and addition, and requires the
Web workspace to remain mounted without reselecting the conversation. Independent
outage cycles wait for real socket traffic to settle; no fixed phase wait or fake
readiness response is used. Online unpin/repin and full reload are checked afterward.
A cold H5 group-info page has no mounted chat channel subscription; the separate
cold-profile gate measures bounded visible-page reconciliation rather than
mislabeling it as immediate online invalidation.

Pin/profile reconciliation callbacks send RPCs only when the SDK adapter reports
`authenticated`, not transport-open/connected. This avoids the server's required
unauthenticated-RPC disconnect during auth replay. Replies received after losing
authentication are ignored. Pin/profile writes also fail locally with translated
retry feedback until authentication finishes; the server remains authoritative.
Web retains an existing SDK-session workspace through transient reconnect states,
but does not retain it after logout/terminal identity loss or closing/disconnected.
