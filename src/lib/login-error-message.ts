// R8.3b — classify provider/transport errors into user-facing
// strings. Avoids leaking error class names like
// "PlatformProtocolError" into the UI; UI calls the helper with
// the caught error + an `i18n` `t` function and displays the
// returned string.
//
// The dispatch table mirrors the four R8.3a platform error
// classes plus a "PlatformApiError pass-through" rule (server's
// `message` field is already user-facing per the application
// contract). Anything else falls back to a generic protocol
// label so we don't show empty toasts on weird failures.

export type LoginErrorContext = 'send-sms' | 'sms-login' | 'login';

export interface LoginErrorTranslator {
  (key: string, opts?: Record<string, unknown>): string;
}

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
      // Server-side validation message is already localized /
      // user-facing per application convention. Surface verbatim.
      return message;
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
      return ctx === 'send-sms'
        ? t('login.error_send_sms', { message })
        : ctx === 'sms-login'
          ? t('login.error_sms_login', { message })
          : t('login.error_login', { message });
  }
}
