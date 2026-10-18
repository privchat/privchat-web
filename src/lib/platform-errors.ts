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
//                           numeric code, the machine code and any
//                           per-field errors. `message` is for logs
//                           only — never show it to the user; map it
//                           with `describePlatformError()` instead.

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

/** One entry of the envelope's `errors[]` (field-level validation). */
export interface PlatformFieldError {
  field: string;
  /** Machine code, e.g. `REQUIRED`, `TOO_SHORT`, `INVALID_MOBILE`. */
  code: string;
  params?: { min?: number; max?: number };
}

const MACHINE_CODE_RE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

/** Returns `message` when it is a Neton machine code, else null (old
 *  server sentence or local error text). */
export function toMachineCode(message: string | null | undefined): string | null {
  return typeof message === 'string' && MACHINE_CODE_RE.test(message) ? message : null;
}

export class PlatformApiError extends Error {
  override readonly name = 'PlatformApiError';
  /** Envelope `message` when it is a machine code, else null. */
  readonly machineCode: string | null;
  constructor(
    public readonly code: number,
    message: string,
    public readonly fieldErrors: readonly PlatformFieldError[] = [],
  ) {
    super(message);
    this.machineCode = toMachineCode(message);
  }
}
