# `privchat-web`

Official PrivChat React Web App. First consumer of [`@privchat/react`](../privchat-react/).

> **Status:** R0 skeleton — login page placeholder + connection state card.
> No timeline, no channel list, no router yet.

## Stack

- Vite 5 + React 19 + TypeScript
- Tailwind CSS v3 + shadcn/ui (slate, CSS variables)
- `@privchat/sdk` (file: link to `../privchat-sdk-typescript`)
- `@privchat/react` (file: link to `../privchat-react`)

## Local setup

The two upstream packages must be present and built first:

```bash
# 1. SDK
cd ../privchat-sdk-typescript && npm install && npm run build

# 2. React layer
cd ../privchat-react && npm install && npm run build

# 3. This app
cd ../privchat-web && npm install
npm run dev
```

Open http://localhost:5173 and you'll see the R0 login card. Enter the
gateway URL, click **Create client**, then **Connect** / **Authenticate** to
exercise the SDK's lifecycle. The state badge updates via
`useConnectionState` over the SDK's event stream.

## Architecture

The host (this app) owns the `PrivchatClient` instance and drives lifecycle
(`connect` / `authenticate` / `disconnect` / `dispose`). React reads state
through `DirectClientAdapter` ⇒ `<PrivchatProvider>`. See
[`../privchat-react/docs/PRIVCHAT_REACT_ARCHITECTURE.md`](../privchat-react/docs/PRIVCHAT_REACT_ARCHITECTURE.md)
for the full boundary contract.

## Roadmap

| Phase | Surface                                                          |
| ----- | ---------------------------------------------------------------- |
| W0    | this skeleton                                                    |
| W1    | three-pane layout, channel list, open conversation               |
| W2    | message timeline (TanStack Virtual), text composer, send + outbox |
| W3    | unread, read cursors, typing/presence                            |
| W4+   | multi-tab leader election, SharedWorker SDK, media, settings     |

`@privchat/react` grows in lockstep, but only when this app forces the API
shape — never speculatively.

## License

Apache-2.0
