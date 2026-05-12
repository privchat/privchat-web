// R8.3a — error taxonomy for the PLATFORM HTTP transport.
//
// Four classes, distinguished by where in the HTTP cycle the failure
// landed. Tests assert on `.name`; production code can `instanceof`
// to decide retry/wipe-session/show-toast policy in later rounds.
//
//   PlatformConfigError   — caller bug (bad baseUrl, missing session
//                           preconditions). Throw early, fail loud.
//   PlatformHttpError     — transport (DNS / connect refused / non-2xx
//                           HTTP status). Carries the HTTP status
//                           (0 when fetch itself rejected).
//   PlatformProtocolError — response landed but envelope shape /
//                           required-field invariants broke. Treat as
//                           server bug or version skew.
//   PlatformApiError      — envelope `code !== 0`. Carries the
//                           server-provided code + message; UI
//                           transparently surfaces `message`.

export class PlatformConfigError extends Error {
  override readonly name = 'PlatformConfigError';
}

export class PlatformHttpError extends Error {
  override readonly name = 'PlatformHttpError';
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export class PlatformProtocolError extends Error {
  override readonly name = 'PlatformProtocolError';
}

export class PlatformApiError extends Error {
  override readonly name = 'PlatformApiError';
  constructor(public readonly code: number, message: string) {
    super(message);
  }
}
