// R8.3a — `{ code, message?, data? }` envelope decode.
//
// Mirror of native `PlatformEnvelope<T>` + `requireOk()` from
// privchat-app's `PlatformAccountLoginImpl.kt`. All `auth/*` HTTP
// responses are wrapped this way; `code === 0` is the success
// signal, NOT HTTP 200 (a non-zero `code` can ride on a 200).
//
// `postEnvelope` returns `data` (which may be `undefined` — e.g.
// `/auth/send-sms-code` returns `{code:0, data:null}`); callers
// either tolerate undefined or `requireData()` it before mapping.

import {
  PlatformApiError,
  PlatformHttpError,
  PlatformProtocolError,
} from './platform-errors';

interface PlatformEnvelope<T> {
  code: number;
  message?: string;
  data?: T;
}

const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  Accept: 'application/json',
};

export async function postEnvelope<T>(
  url: string,
  body: unknown,
): Promise<T | undefined> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
  } catch (err) {
    // fetch() rejects on network errors (DNS, connection refused,
    // CORS preflight rejection). Map to status=0 so callers can
    // tell "request never reached server" from "server returned
    // 4xx/5xx".
    throw new PlatformHttpError(
      0,
      err instanceof Error ? err.message : String(err),
    );
  }
  if (!response.ok) {
    throw new PlatformHttpError(
      response.status,
      `HTTP ${response.status} from ${url}`,
    );
  }
  let envelope: PlatformEnvelope<T>;
  try {
    envelope = (await response.json()) as PlatformEnvelope<T>;
  } catch (err) {
    throw new PlatformProtocolError(
      `failed to parse JSON envelope: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
  if (
    typeof envelope !== 'object' ||
    envelope === null ||
    typeof envelope.code !== 'number'
  ) {
    throw new PlatformProtocolError(
      'envelope missing required `code` field',
    );
  }
  if (envelope.code !== 0) {
    throw new PlatformApiError(
      envelope.code,
      envelope.message ?? `code=${envelope.code}`,
    );
  }
  return envelope.data;
}

/** Convenience for endpoints that MUST return a payload (login,
 *  refresh). Throws `PlatformProtocolError` when `data` is
 *  undefined or null. */
export function requireData<T>(data: T | undefined | null, what: string): T {
  if (data === undefined || data === null) {
    throw new PlatformProtocolError(
      `expected non-empty \`data\` in ${what} response`,
    );
  }
  return data;
}

/** R8.4b — authed GET. Same envelope semantics as `postEnvelope`. */
export async function getEnvelope<T>(
  url: string,
  accessToken: string,
): Promise<T | undefined> {
  return requestEnvelope<T>(url, 'GET', accessToken, undefined);
}

/** R8.4b — authed PUT. */
export async function putEnvelope<T>(
  url: string,
  accessToken: string,
  body: unknown,
): Promise<T | undefined> {
  return requestEnvelope<T>(url, 'PUT', accessToken, body);
}

/** R8.4d-2 — authed multipart POST. Don't set `Content-Type` — the
 *  browser fills in the multipart boundary automatically when given a
 *  `FormData` body. Same `{code,message,data}` envelope semantics. */
export async function postMultipartEnvelope<T>(
  url: string,
  accessToken: string,
  form: FormData,
): Promise<T | undefined> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        // NO Content-Type — browser builds `multipart/form-data; boundary=...`
      },
      body: form,
    });
  } catch (err) {
    throw new PlatformHttpError(
      0,
      err instanceof Error ? err.message : String(err),
    );
  }
  if (!response.ok) {
    throw new PlatformHttpError(
      response.status,
      `HTTP ${response.status} from ${url}`,
    );
  }
  let envelope: PlatformEnvelope<T>;
  try {
    envelope = (await response.json()) as PlatformEnvelope<T>;
  } catch (err) {
    throw new PlatformProtocolError(
      `failed to parse JSON envelope: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
  if (
    typeof envelope !== 'object' ||
    envelope === null ||
    typeof envelope.code !== 'number'
  ) {
    throw new PlatformProtocolError(
      'envelope missing required `code` field',
    );
  }
  if (envelope.code !== 0) {
    throw new PlatformApiError(
      envelope.code,
      envelope.message ?? `code=${envelope.code}`,
    );
  }
  return envelope.data;
}

async function requestEnvelope<T>(
  url: string,
  method: 'GET' | 'PUT',
  accessToken: string,
  body: unknown,
): Promise<T | undefined> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
  if (body !== undefined) headers['Content-Type'] = JSON_HEADERS['Content-Type']!;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      mode: 'cors',
      credentials: 'omit',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new PlatformHttpError(
      0,
      err instanceof Error ? err.message : String(err),
    );
  }
  if (!response.ok) {
    throw new PlatformHttpError(
      response.status,
      `HTTP ${response.status} from ${url}`,
    );
  }
  let envelope: PlatformEnvelope<T>;
  try {
    envelope = (await response.json()) as PlatformEnvelope<T>;
  } catch (err) {
    throw new PlatformProtocolError(
      `failed to parse JSON envelope: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
  if (
    typeof envelope !== 'object' ||
    envelope === null ||
    typeof envelope.code !== 'number'
  ) {
    throw new PlatformProtocolError(
      'envelope missing required `code` field',
    );
  }
  if (envelope.code !== 0) {
    throw new PlatformApiError(
      envelope.code,
      envelope.message ?? `code=${envelope.code}`,
    );
  }
  return envelope.data;
}
