// Neton application-server error -> localized user copy.
//
// Single resolver shared by every PLATFORM (Neton) call site. The
// mapping follows the cross-client catalog (Kotlin app / H5 / web
// implement the same table): machine code first, then field errors,
// then the numeric category. Returns null when nothing maps so the
// caller can show its own action-specific fallback — the raw server
// `message` (a machine code) is never user copy.
//
// NOT for PrivChat IM-server errors (RpcError / protocol ErrorCode);
// those go through `features/chat/error-text.ts`.

import { PlatformApiError, type PlatformFieldError } from './platform-errors';

export interface PlatformErrorTranslator {
  (key: string, opts?: Record<string, unknown>): string;
}

/** Resolved i18n key + interpolation params. */
export interface PlatformErrorCopy {
  key: string;
  params?: Record<string, number>;
}

const K = {
  sessionExpired: 'server_error.session_expired',
  permissionDenied: 'server_error.permission_denied',
  notFound: 'server_error.not_found',
  conflict: 'server_error.conflict',
  duplicate: 'server_error.duplicate',
  busy: 'server_error.busy',
  rateLimited: 'server_error.rate_limited',
  dailyLimit: 'server_error.daily_limit',
  serviceUnavailable: 'server_error.service_unavailable',
  requestTooLarge: 'server_error.request_too_large',
  fieldRequired: 'server_error.field_required',
  fieldTooShort: 'server_error.field_too_short',
  fieldTooLong: 'server_error.field_too_long',
  fieldLengthRange: 'server_error.field_length_range',
  fieldTooSmall: 'server_error.field_too_small',
  fieldTooLarge: 'server_error.field_too_large',
  fieldInvalidFormat: 'server_error.field_invalid_format',
  fieldInvalidEmail: 'server_error.field_invalid_email',
  // Reused existing keys (same meaning already shipped).
  invalidCredentials: 'login.error_invalid_credentials',
  accountDisabled: 'login.error_account_disabled',
  accountDeleted: 'server_error.account_deleted',
  mobileInvalid: 'server_error.mobile_invalid',
  mobileTaken: 'bind_mobile.err_taken',
  mobileAlreadyBound: 'bind_mobile.err_bound',
  smsCodeRequired: 'server_error.sms_code_required',
  smsCodeInvalid: 'server_error.sms_code_invalid',
  smsCodeExpired: 'server_error.sms_code_expired',
  smsCodeAttemptsExceeded: 'server_error.sms_code_attempts_exceeded',
  verificationTooFrequent: 'server_error.verification_too_frequent',
  verificationDailyLimit: 'server_error.verification_daily_limit',
  verificationUnavailable: 'server_error.verification_unavailable',
  loginLocked: 'server_error.login_locked',
  usernameTaken: 'login.error_username_taken',
  usernameReserved: 'login.error_username_reserved',
  usernameFormat: 'login.error_username_format',
  usernameRateLimited: 'server_error.username_rate_limited',
  passwordTooShort: 'login.error_password_short',
  passwordTooLong: 'server_error.password_too_long',
  registerModeDisabled: 'server_error.register_mode_disabled',
  nicknameLength: 'server_error.nickname_length',
  bioTooLong: 'server_error.bio_too_long',
  profileFieldInvalid: 'server_error.profile_field_invalid',
  avatarInvalid: 'server_error.avatar_invalid',
  reportDescriptionTooLong: 'server_error.report_description_too_long',
  inviteInvalid: 'invite.err_invalid',
  inviteAlreadyBound: 'server_error.invite_already_bound',
  signInAlreadyToday: 'sign_in.already_signed',
  signInRewardUnavailable: 'server_error.sign_in_reward_unavailable',
  amountInvalid: 'money.rp.err_amount',
  walletNotFound: 'server_error.wallet_not_found',
  balanceInsufficient: 'server_error.balance_insufficient',
  transferToSelf: 'server_error.transfer_to_self',
  redPacketCountInvalid: 'server_error.red_packet_count_invalid',
  redPacketAmountBelowCount: 'money.rp.err_min_per',
  redPacketNotFound: 'server_error.red_packet_not_found',
  redPacketExpired: 'server_error.red_packet_expired',
  redPacketDrained: 'server_error.red_packet_drained',
  redPacketAlreadyClaimed: 'server_error.red_packet_already_claimed',
  redPacketNotClaimable: 'server_error.red_packet_not_claimable',
  redPacketClaimForbidden: 'server_error.red_packet_claim_forbidden',
  bankCardInfoRequired: 'server_error.bank_card_info_required',
  bankCardNumberInvalid: 'server_error.bank_card_number_invalid',
  bankCardNotFound: 'server_error.bank_card_not_found',
  bankCardHasPendingWithdrawals: 'server_error.bank_card_has_pending_withdrawals',
  withdrawStatusNotAllowed: 'server_error.withdraw_status_not_allowed',
  payChannelUnavailable: 'server_error.pay_channel_unavailable',
  fileTooLarge: 'server_error.file_too_large',
  fileTypeNotAllowed: 'server_error.file_type_not_allowed',
  fileEmpty: 'server_error.file_empty',
  qrExpired: 'server_error.qr_expired',
  qrStateInvalid: 'server_error.qr_state_invalid',
  qrInvalid: 'server_error.qr_invalid',
  qrScannerMismatch: 'server_error.qr_scanner_mismatch',
  qrLoginUnavailable: 'server_error.qr_login_unavailable',
} as const;

function group(key: string, codes: string[]): Array<[string, string]> {
  return codes.map((c) => [c, key]);
}

const MACHINE_CODES: ReadonlyMap<string, string> = new Map<string, string>([
  ...group(K.sessionExpired, [
    'AUTH_REQUIRED',
    'INVALID_REFRESH_TOKEN',
    'NOT_A_REFRESH_TOKEN',
    'INVALID_REFRESH_TOKEN_SUBJECT',
    'REFRESH_TOKEN_EXPIRED',
    'REFRESH_TOKEN_REVOKED',
    'LOGIN_REQUIRED',
    'REFRESH_TOKEN_INVALID',
    // Refresh sent without the issuing deviceId: only a fresh sign-in recovers.
    'DEVICE_ID_REQUIRED',
  ]),
  ...group(K.permissionDenied, [
    'PERMISSION_DENIED',
    'IP_NOT_ALLOWED',
    'ACCOUNT_DELETION_DISABLED',
    'FILE_FORBIDDEN',
  ]),
  ...group(K.notFound, [
    'RESOURCE_NOT_FOUND',
    'ACCOUNT_NOT_FOUND',
    'WITHDRAW_ORDER_NOT_FOUND',
    'PAY_TRANSFER_NOT_FOUND',
    'FILE_NOT_FOUND',
    'FILE_DELETED',
    'ADDRESS_NOT_FOUND',
  ]),
  ['RATE_LIMITED', K.rateLimited],
  ...group(K.busy, [
    'LOCK_NOT_ACQUIRED',
    'INVITE_CODE_GENERATION_CONFLICT',
    'RED_PACKET_CLAIM_CONFLICT',
    'WITHDRAW_CONCURRENT_MODIFIED',
    'WALLET_RECHARGE_CONCURRENT_MODIFIED',
  ]),
  ...group(K.serviceUnavailable, [
    'SERVICE_UNAVAILABLE',
    'TIMEOUT',
    'REQUEST_TIMEOUT',
    'ROUTE_NOT_FOUND',
    'METHOD_NOT_ALLOWED',
    'SOCIAL_LOGIN_UNAVAILABLE',
  ]),
  ['PAYLOAD_TOO_LARGE', K.requestTooLarge],
  ['INVALID_CREDENTIALS', K.invalidCredentials],
  ['ACCOUNT_DISABLED', K.accountDisabled],
  ['ACCOUNT_DELETED', K.accountDeleted],
  ...group(K.mobileInvalid, ['INVALID_MOBILE', 'MOBILE_INVALID']),
  ...group(K.mobileTaken, ['MOBILE_IN_USE', 'MOBILE_ALREADY_TAKEN']),
  ['MOBILE_ALREADY_BOUND', K.mobileAlreadyBound],
  ['SMS_CODE_REQUIRED', K.smsCodeRequired],
  ['SMS_CODE_INVALID', K.smsCodeInvalid],
  ['SMS_CODE_EXPIRED', K.smsCodeExpired],
  ...group(K.smsCodeAttemptsExceeded, ['SMS_CODE_ATTEMPTS_EXCEEDED', 'SMS_CODE_LOCKED']),
  ['VERIFICATION_TOO_FREQUENT', K.verificationTooFrequent],
  ['VERIFICATION_DAILY_LIMIT', K.verificationDailyLimit],
  ...group(K.verificationUnavailable, [
    'VERIFICATION_UNAVAILABLE',
    'VERIFICATION_CHANNEL_UNAVAILABLE',
    'VERIFICATION_SEND_FAILED',
    'VERIFICATION_DAILY_BUDGET_EXHAUSTED',
    'SMS_NOT_CONFIGURED',
  ]),
  ['LOGIN_LOCKED', K.loginLocked],
  ['USERNAME_TAKEN', K.usernameTaken],
  ['USERNAME_RESERVED', K.usernameReserved],
  ['INVALID_USERNAME_FORMAT', K.usernameFormat],
  ['USERNAME_RATE_LIMITED', K.usernameRateLimited],
  ['PASSWORD_TOO_SHORT', K.passwordTooShort],
  ['PASSWORD_TOO_LONG', K.passwordTooLong],
  ...group(K.registerModeDisabled, ['REGISTER_MODE_DISABLED', 'UNSUPPORTED_REGISTER_MODE']),
  ['INVALID_NICKNAME_LENGTH', K.nicknameLength],
  ['INVALID_BIO_LENGTH', K.bioTooLong],
  ...group(K.profileFieldInvalid, ['INVALID_GENDER', 'INVALID_BIRTHDAY_FORMAT']),
  ...group(K.avatarInvalid, [
    'INVALID_AVATAR_FILE_ID',
    'AVATAR_FILE_NOT_FOUND',
    'AVATAR_FILE_INACTIVE',
    'INVALID_AVATAR_BUSINESS_TYPE',
    'AVATAR_FILE_NO_URL',
  ]),
  ['REPORT_DESCRIPTION_TOO_LONG', K.reportDescriptionTooLong],
  ...group(K.inviteInvalid, ['INVITE_CODE_INVALID', 'INVITE_CODE_UNSUPPORTED']),
  ['INVITE_ALREADY_BOUND', K.inviteAlreadyBound],
  ['ALREADY_SIGNED_IN_TODAY', K.signInAlreadyToday],
  ['SIGN_IN_CASH_REWARD_UNAVAILABLE', K.signInRewardUnavailable],
  ['AMOUNT_INVALID', K.amountInvalid],
  ['WALLET_NOT_FOUND', K.walletNotFound],
  ...group(K.balanceInsufficient, [
    'WALLET_BALANCE_INSUFFICIENT',
    'WALLET_AVAILABLE_BALANCE_INSUFFICIENT',
  ]),
  ['TRANSFER_TO_SELF', K.transferToSelf],
  ['RED_PACKET_COUNT_INVALID', K.redPacketCountInvalid],
  ['RED_PACKET_AMOUNT_BELOW_COUNT', K.redPacketAmountBelowCount],
  ['RED_PACKET_NOT_FOUND', K.redPacketNotFound],
  ['RED_PACKET_EXPIRED', K.redPacketExpired],
  ['RED_PACKET_DRAINED', K.redPacketDrained],
  ['RED_PACKET_ALREADY_CLAIMED', K.redPacketAlreadyClaimed],
  ['RED_PACKET_NOT_CLAIMABLE', K.redPacketNotClaimable],
  ['RED_PACKET_CLAIM_FORBIDDEN', K.redPacketClaimForbidden],
  ...group(K.bankCardInfoRequired, [
    'BANK_CARD_HOLDER_NAME_REQUIRED',
    'BANK_CARD_BANK_NAME_REQUIRED',
    'BANK_CARD_NUMBER_REQUIRED',
  ]),
  ['BANK_CARD_NUMBER_INVALID', K.bankCardNumberInvalid],
  ['BANK_CARD_NOT_FOUND', K.bankCardNotFound],
  ['BANK_CARD_HAS_PENDING_WITHDRAWALS', K.bankCardHasPendingWithdrawals],
  ['WITHDRAW_STATUS_NOT_ALLOWED', K.withdrawStatusNotAllowed],
  ['PAY_CHANNEL_UNAVAILABLE', K.payChannelUnavailable],
  ['FILE_TOO_LARGE', K.fileTooLarge],
  ['INVALID_MIME_TYPE', K.fileTypeNotAllowed],
  ['EMPTY_FILE', K.fileEmpty],
  // Web QR login (`/platform/qr-login/*`, privchat module).
  ['QR_SCENE_NOT_FOUND', K.qrExpired],
  ['QR_SCENE_STATE_INVALID', K.qrStateInvalid],
  ...group(K.qrInvalid, ['QR_TOKEN_MISMATCH', 'QR_CONFIRM_TOKEN_INVALID']),
  ['QR_SCANNER_MISMATCH', K.qrScannerMismatch],
  ['QR_LOGIN_UNAVAILABLE', K.qrLoginUnavailable],
]);

function machineCodeCopy(code: string): PlatformErrorCopy | null {
  const key = MACHINE_CODES.get(code);
  if (key !== undefined) return { key };
  // Every other `*_RATE_LIMITED` (USERNAME_RATE_LIMITED is in the table).
  if (code.endsWith('_RATE_LIMITED')) return { key: K.rateLimited };
  return null;
}

function fieldCopy(fe: PlatformFieldError): PlatformErrorCopy | null {
  const min = fe.params?.min;
  const max = fe.params?.max;
  switch (fe.code) {
    case 'REQUIRED':
      return { key: K.fieldRequired };
    case 'TOO_SHORT':
      if (max !== undefined) {
        return min !== undefined ? { key: K.fieldLengthRange, params: { min, max } } : null;
      }
      return min !== undefined ? { key: K.fieldTooShort, params: { min } } : null;
    case 'TOO_LONG':
      if (min !== undefined && max !== undefined) {
        return { key: K.fieldLengthRange, params: { min, max } };
      }
      return max !== undefined ? { key: K.fieldTooLong, params: { max } } : null;
    case 'TOO_SMALL':
      return min !== undefined ? { key: K.fieldTooSmall, params: { min } } : null;
    case 'TOO_LARGE':
      return max !== undefined ? { key: K.fieldTooLarge, params: { max } } : null;
    case 'INVALID_FORMAT':
      return { key: K.fieldInvalidFormat };
    case 'INVALID_EMAIL':
      return { key: K.fieldInvalidEmail };
    default:
      return machineCodeCopy(fe.code);
  }
}

function firstFieldCopy(errors: readonly PlatformFieldError[]): PlatformErrorCopy | null {
  for (const fe of errors) {
    const copy = fieldCopy(fe);
    if (copy !== null) return copy;
  }
  return null;
}

const SESSION_EXPIRED_CODES = new Set([10000, 10001, 10002, 10003, 10005, 10006, 10009, 10010]);

function numericCopy(code: number): PlatformErrorCopy | null {
  if (SESSION_EXPIRED_CODES.has(code)) return { key: K.sessionExpired };
  switch (code) {
    case 10004:
    case 10008:
      return { key: K.permissionDenied };
    case 10007:
      return { key: K.accountDisabled };
    case 10011:
      return { key: K.invalidCredentials };
    case 10106:
      return { key: K.requestTooLarge };
    case 10201:
    case 10203:
      return { key: K.notFound };
    case 10200:
    case 10202:
    case 10205:
      return { key: K.conflict };
    case 10204:
      return { key: K.duplicate };
    case 10301:
    case 10302:
      return { key: K.dailyLimit };
    case 3:
    case 5:
      return { key: K.serviceUnavailable };
    default:
      if (code >= 10300 && code <= 10399) return { key: K.rateLimited };
      return null;
  }
}

/** Catalog resolution order -> i18n key, or null when nothing maps. */
export function resolvePlatformError(err: unknown): PlatformErrorCopy | null {
  if (!(err instanceof PlatformApiError)) return null;
  const mc = err.machineCode;
  if ((mc === 'VALIDATION_FAILED' || mc === 'INVALID_PARAMS') && err.fieldErrors.length > 0) {
    const copy = firstFieldCopy(err.fieldErrors);
    if (copy !== null) return copy;
  }
  if (mc !== null) {
    const copy = machineCodeCopy(mc);
    if (copy !== null) return copy;
  }
  return firstFieldCopy(err.fieldErrors) ?? numericCopy(err.code);
}

/** Localized copy for a Neton platform error, or null (caller falls
 *  back to its action-specific text; never to the raw message). */
export function describePlatformError(
  err: unknown,
  t: PlatformErrorTranslator,
): string | null {
  const copy = resolvePlatformError(err);
  if (copy === null) return null;
  return copy.params === undefined ? t(copy.key) : t(copy.key, copy.params);
}

/** QR scene codes after which the only recovery is a fresh QR code. */
const QR_REFRESH_CODES: ReadonlySet<string> = new Set([
  'QR_SCENE_NOT_FOUND',
  'QR_SCENE_STATE_INVALID',
]);

/** True when a QR-login error means "this code is dead — show a new one". */
export function isQrSceneGone(err: unknown): boolean {
  const mc = platformMachineCode(err);
  return mc !== null && QR_REFRESH_CODES.has(mc);
}

/** Machine code of a platform error, or null. */
export function platformMachineCode(err: unknown): string | null {
  return err instanceof PlatformApiError ? err.machineCode : null;
}
