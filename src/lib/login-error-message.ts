// R8.3b — classify provider/transport errors into user-facing
// strings. Avoids leaking error class names like
// "PlatformProtocolError" into the UI; UI calls the helper with
// the caught error + an `i18n` `t` function and displays the
// returned string.
//
// The dispatch table mirrors the four R8.3a platform error
// classes. `PlatformApiError` goes through the shared Neton machine-code
// catalog (`describePlatformError`); the server `message` is a machine
// code and is never shown. Unmapped API errors fall back to the
// action-specific copy.

import { describePlatformError } from './platform-error-message';

export type LoginErrorContext = 'send-sms' | 'sms-login' | 'login' | 'qr-login';

export interface LoginErrorTranslator {
  (key: string, opts?: Record<string, unknown>): string;
}

const API_FALLBACK_KEY: Record<LoginErrorContext, string> = {
  'send-sms': 'login.error_send_sms_failed',
  'sms-login': 'login.error_sms_login_failed',
  login: 'login.error_login_failed',
  'qr-login': 'login.qr_create_failed',
};

export function getLoginErrorMessage(
  err: unknown,
  ctx: LoginErrorContext,
  t: LoginErrorTranslator,
): string {
  const e = err as { name?: unknown; message?: unknown };
  const name = typeof e.name === 'string' ? e.name : 'Error';
  const message = typeof e.message === 'string' ? e.message : String(err);

  switch (name) {
    case 'PlatformApiError':
      return describePlatformError(err, t) ?? t(API_FALLBACK_KEY[ctx]);
    case 'PlatformHttpError':
      return t('login.error_network');
    case 'PlatformProtocolError':
      return t('login.error_protocol');
    case 'PlatformConfigError':
      return t('login.error_config');
    default:
      // BUILTIN errors and anything unclassified — route through
      // the same i18n key the page used pre-R8.3b (login.error_login
      // / login.error_register / login.error_sms_login etc), so the
      // BUILTIN flow's existing error display stays byte-identical.
      // QR login runs over the unauth IM WebSocket (RpcError / transport
      // errors): their text is diagnostic only, so it goes to the console
      // and the user gets the QR-specific copy.
      if (ctx === 'qr-login') {
        // eslint-disable-next-line no-console
        console.warn('[qr-login] start failed', err);
        return t(API_FALLBACK_KEY[ctx]);
      }
      return ctx === 'send-sms'
        ? t('login.error_send_sms', { message })
        : ctx === 'sms-login'
          ? t('login.error_sms_login', { message })
          : t('login.error_login', { message });
  }
}
