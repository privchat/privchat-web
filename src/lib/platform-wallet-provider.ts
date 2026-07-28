// PLATFORM wallet / red-packet / money-transfer over /app/* — port of
// privchat-h5's platform-wallet-provider (RP-12 semantics: money cards are
// server-injected; the client only calls platform APIs and renders).
// Amounts are integer cents (分). Display strings are i18n KEYS here — the
// UI layer translates (web is fully i18n'd, unlike H5's inline zh).
import {
  deleteAuthedEnvelope,
  getEnvelope,
  postAuthedEnvelope,
  requireData,
} from './platform-envelope';
import { PlatformApiError, PlatformConfigError } from './platform-errors';
import { activePlatform } from './platform-session';

/** Wallet balance (application PayWallet subset, cents). */
export interface WalletInfo {
  id: number;
  userId: number;
  balance: number;
  totalExpense: number;
  totalRecharge: number;
  freezePrice: number;
  /** available = balance − freezePrice */
  available: number;
}

const ZERO_WALLET: WalletInfo = {
  id: 0,
  userId: 0,
  balance: 0,
  totalExpense: 0,
  totalRecharge: 0,
  freezePrice: 0,
  available: 0,
};

interface WalletWire {
  id?: number;
  userId?: number;
  balance?: number;
  totalExpense?: number;
  totalRecharge?: number;
  freezePrice?: number;
}

function toWallet(w: WalletWire | undefined | null): WalletInfo {
  if (!w) return ZERO_WALLET;
  const balance = w.balance ?? 0;
  const freezePrice = w.freezePrice ?? 0;
  return {
    id: w.id ?? 0,
    userId: w.userId ?? 0,
    balance,
    totalExpense: w.totalExpense ?? 0,
    totalRecharge: w.totalRecharge ?? 0,
    freezePrice,
    available: balance - freezePrice,
  };
}

/** GET /pay/wallet/get — zero balance when no wallet row exists yet. */
export async function getWallet(): Promise<WalletInfo> {
  const { baseUrl, token } = activePlatform();
  return toWallet(await getEnvelope<WalletWire>(`${baseUrl}/pay/wallet/get`, token));
}

/** Red packet order (App RedPacketOrderView, cents). */
export interface RedPacketOrder {
  id: number;
  senderUserId: number;
  channelId: string;
  /** 0=dm 1=group */
  scene: number;
  /** 0=normal 1=lucky */
  type: number;
  totalAmount: number;
  totalCount: number;
  remainingAmount: number;
  remainingCount: number;
  /** 0=ACTIVE 1=FINISHED 2=EXPIRED 3=REFUNDING */
  status: number;
  greeting?: string;
  expireAt: number;
  createdAt: number;
  /** #85-A2 delivery: 'DELIVERED' (card injected) | 'PROCESSING' (worker backfilling). Derived from outbox. */
  deliveryStatus?: string;
  messageId?: string;
}

/**
 * #85-A2 money send result. code=0 means the funds request was reliably accepted,
 * NOT that the chat card is delivered — check deliveryStatus.
 */
export interface MoneySendResult {
  orderId: number;
  deliveryStatus: string;
  messageId?: string;
}

export interface RedPacketClaim {
  id: number;
  redPacketId: number;
  userId: number;
  amount: number;
  claimedAt: number;
}

/** Money transfer order (App MoneyTransferOrderView, cents). */
export interface MoneyTransferOrder {
  id: number;
  fromUserId: number;
  toUserId: number;
  channelId: string;
  amount: number;
  remark?: string;
  /** 0=SUCCESS 1=REFUNDED */
  status: number;
  createdAt: number;
  /** #85-A2 delivery status (derived from outbox). */
  deliveryStatus?: string;
  messageId?: string;
}

/** Ledger row (cents; price signed, >0 income). bizId = red packet / transfer order id. */
export interface WalletTransaction {
  id: number;
  walletId: number;
  bizType: number;
  bizId: number;
  title?: string;
  price: number;
  balance: number;
  createdAt?: string;
}

export interface WalletTransactionPage {
  list: WalletTransaction[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
}

// Server-side kotlinx uses encodeDefaults=false: fields at their default
// (0 / null) are OMITTED from the JSON entirely. Every Int status/enum field
// must be defaulted here, or `x.status === 0` checks silently fail.
const RP_DEFAULTS = { scene: 0, type: 0, status: 0, remainingAmount: 0, remainingCount: 0 };
function normRedPacket(o: RedPacketOrder): RedPacketOrder {
  return { ...RP_DEFAULTS, ...o };
}

const TF_DEFAULTS = { status: 0 };
function normTransfer(o: MoneyTransferOrder): MoneyTransferOrder {
  return { ...TF_DEFAULTS, ...o };
}

const CLAIM_DEFAULTS = { amount: 0 };
function normClaim(c: RedPacketClaim): RedPacketClaim {
  return { ...CLAIM_DEFAULTS, ...c };
}

const TX_DEFAULTS = { bizType: 0, bizId: 0, price: 0, balance: 0 };
function normTx(t: WalletTransaction): WalletTransaction {
  return { ...TX_DEFAULTS, ...t };
}

/** POST /red-packet/send */
export async function sendRedPacket(input: {
  channelId: string;
  scene: number;
  type: number;
  totalAmount: number;
  totalCount: number;
  greeting?: string;
}): Promise<MoneySendResult> {
  // #85-A2: response is { orderId, deliveryStatus, messageId } (no full order). code=0 = funds accepted.
  const { baseUrl, token } = activePlatform();
  return requireData(
    await postAuthedEnvelope<MoneySendResult>(`${baseUrl}/red-packet/send`, token, input),
    'red-packet.send',
  );
}

/** POST /red-packet/claim/{id} — 409 (business conflict) = empty/claimed/expired. */
export async function claimRedPacket(redPacketId: number | string): Promise<RedPacketClaim> {
  const { baseUrl, token } = activePlatform();
  return normClaim(
    requireData(
      await postAuthedEnvelope<RedPacketClaim>(`${baseUrl}/red-packet/claim/${redPacketId}`, token, {}),
      'red-packet.claim',
    ),
  );
}

/** GET /red-packet/detail/{id} */
export async function redPacketDetail(redPacketId: number | string): Promise<RedPacketOrder> {
  const { baseUrl, token } = activePlatform();
  return normRedPacket(
    requireData(
      await getEnvelope<RedPacketOrder>(`${baseUrl}/red-packet/detail/${redPacketId}`, token),
      'red-packet.detail',
    ),
  );
}

/** GET /red-packet/claims/{id} (desc) */
export async function redPacketClaims(redPacketId: number | string): Promise<RedPacketClaim[]> {
  const { baseUrl, token } = activePlatform();
  const list =
    (await getEnvelope<RedPacketClaim[]>(`${baseUrl}/red-packet/claims/${redPacketId}`, token)) ?? [];
  return list.map(normClaim);
}

/** POST /money-transfer/send — instant credit; the confirm step is client UI only. */
export async function sendMoneyTransfer(input: {
  toUserId: number;
  channelId: string;
  amount: number;
  remark?: string;
}): Promise<MoneySendResult> {
  // #85-A2: response is { orderId, deliveryStatus, messageId }. code=0 = funds accepted, not card delivered.
  const { baseUrl, token } = activePlatform();
  return requireData(
    await postAuthedEnvelope<MoneySendResult>(`${baseUrl}/money-transfer/send`, token, input),
    'money-transfer.send',
  );
}

/** GET /money-transfer/detail/{id} */
export async function moneyTransferDetail(transferId: number | string): Promise<MoneyTransferOrder> {
  const { baseUrl, token } = activePlatform();
  return normTransfer(
    requireData(
      await getEnvelope<MoneyTransferOrder>(`${baseUrl}/money-transfer/detail/${transferId}`, token),
      'money-transfer.detail',
    ),
  );
}

/** GET /pay/wallet-transaction/page?pageNo&pageSize (desc) */
export async function pageWalletTransactions(pageNo = 1, pageSize = 20): Promise<WalletTransactionPage> {
  const { baseUrl, token } = activePlatform();
  const data = await getEnvelope<WalletTransactionPage>(
    `${baseUrl}/pay/wallet-transaction/page?pageNo=${pageNo}&pageSize=${pageSize}`,
    token,
  );
  if (data === undefined || data === null) {
    return { list: [], total: 0, page: pageNo, size: pageSize, totalPages: 0 };
  }
  return { ...data, list: (data.list ?? []).map(normTx) };
}

// ─────────────────────────── display helpers ───────────────────────────

/** cents → "¥x.xx" ("-¥x.xx" for negatives). Missing / non-numeric input renders
 *  as ¥0.00 — a NaN must never reach a money label. The server used to drop
 *  default-valued fields entirely (kotlinx encodeDefaults=false), so a zero fee
 *  arrived as `undefined` and the detail page showed "¥NaN.NaN". */
export function fenToYuan(fen: number | null | undefined): string {
  const safe = typeof fen === 'number' && Number.isFinite(fen) ? fen : 0;
  const neg = safe < 0;
  const abs = Math.abs(safe);
  const yuan = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${neg ? '-' : ''}¥${yuan}.${cents < 10 ? '0' : ''}${cents}`;
}

/** yuan input string → cents; invalid / non-positive → null. */
export function yuanToFen(input: string): number | null {
  const s = input.trim();
  if (s === '' || !/^[0-9]+(\.[0-9]{1,2})?$/.test(s)) return null;
  const parts = s.split('.');
  const yuan = Number(parts[0]);
  const cents = parts.length === 2 ? Number((parts[1] ?? '').padEnd(2, '0')) : 0;
  const fen = yuan * 100 + cents;
  return fen <= 0 ? null : fen;
}

/** Ledger bizType → i18n key under `money.biz.*` (UI translates). */
export function walletBizTypeKey(bizType: number): string {
  switch (bizType) {
    case 1: return 'money.biz.recharge';
    case 2: return 'money.biz.recharge_refund';
    case 200: return 'money.biz.admin_adjust';
    case 300: return 'money.biz.withdraw_freeze';
    case 301: return 'money.biz.withdraw_unfreeze';
    case 302: return 'money.biz.withdraw_deduct';
    case 303: return 'money.biz.withdraw_refund';
    case 400: return 'money.biz.red_packet_send';
    case 401: return 'money.biz.red_packet_claim';
    case 402: return 'money.biz.red_packet_refund';
    case 500: return 'money.biz.transfer_out';
    case 501: return 'money.biz.transfer_in';
    case 502: return 'money.biz.transfer_refund';
    default: return 'money.biz.other';
  }
}

/** Red packet status line (sender/receiver perspective, App parity).
 *  Returns an i18n key plus optional params (refund amount). */
export function redPacketStatusInfo(
  order: RedPacketOrder,
  claimedByMe: boolean,
  isSender: boolean,
): { key: string; params?: Record<string, string> } {
  const allClaimed = order.status === 1 || order.remainingCount <= 0;
  const expiredOrRefunded = order.status === 2 || order.status === 3;
  if (isSender) {
    if (expiredOrRefunded && order.remainingAmount > 0) {
      return { key: 'money.rp.status_refunded_to_you', params: { amount: fenToYuan(order.remainingAmount) } };
    }
    if (allClaimed) return { key: 'money.rp.status_all_claimed' };
    if (expiredOrRefunded) return { key: 'money.rp.status_expired' };
    return { key: 'money.rp.status_waiting' };
  }
  if (claimedByMe) return { key: 'money.rp.status_claimed_by_me' };
  if (allClaimed) return { key: 'money.rp.status_too_slow' };
  if (expiredOrRefunded) return { key: 'money.rp.status_expired' };
  return { key: 'money.rp.status_claimable' };
}

/** Business error → i18n key (aligned with App/H5 mapWalletError; never
 *  leaks the raw exception to the user). */
export function mapWalletErrorKey(err: unknown, isLoad: boolean): string {
  if (err instanceof PlatformConfigError) return 'money.err.not_platform';
  if (err instanceof PlatformApiError) {
    switch (err.code) {
      case 10004:
        return 'money.err.permission';
      case 10201:
        return 'money.err.not_found';
      case 10204:
      case 10205:
        return 'money.err.conflict_or_balance';
      default:
        if (err.code >= 10100 && err.code <= 10199) return 'money.err.bad_params';
        if (err.code >= 10000 && err.code <= 10099) return 'money.err.auth_expired';
        return isLoad ? 'money.err.load_failed' : 'money.err.op_failed';
    }
  }
  return isLoad ? 'money.err.load_failed' : 'money.err.op_failed';
}

// ── Bank cards & withdraw (P4 user-side loop, aligned with App/H5) ──────────

export interface BankCard {
  id: number;
  userId: number;
  holderName: string;
  bankName: string;
  bankCode?: string;
  cardNoMasked: string;
  status: number;
  createdAt?: string;
}

/** Withdraw order (user view, cents). Internal review fields are not exposed. */
export interface WithdrawOrder {
  id: number;
  bankCardId: number;
  amount: number;
  fee: number;
  actualAmount: number;
  currency: string;
  /** 0=pending 1=approved 2=processing 3=paid 4=rejected 5=failed 6=cancelled 7=on hold */
  status: number;
  /** User-visible reject/failure reason. */
  freezeRemarkUserVisible?: string;
  /**
   * Hold reason code (spec WALLET_WITHDRAW_SPEC §10). The server sends a code plus
   * render params, never prose — the user-visible text is localized on the client.
   */
  holdReasonCode?: string;
  /** Render params as JSON text, e.g. {"bank":"ICBC","resume_at":"09:00"}. */
  holdReasonParams?: string;
  createdAt?: string;
  reviewedAt: number;
  paidAt: number;
}

export interface WithdrawPage {
  list: WithdrawOrder[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
}

export interface BindBankCardInput {
  holderName: string;
  bankName: string;
  bankCode?: string;
  cardNo: string;
}

// kotlinx encodeDefaults=false: default-valued fields (status=0, fee=0 …) are
// absent from the wire JSON — normalize before use.
function toWithdrawOrder(o: Partial<WithdrawOrder>): WithdrawOrder {
  return {
    id: 0,
    bankCardId: 0,
    amount: 0,
    fee: 0,
    actualAmount: 0,
    currency: 'CNY',
    status: 0,
    reviewedAt: 0,
    paidAt: 0,
    ...o,
  };
}

/** GET /wallet/bank-cards/list */
export async function listBankCards(): Promise<BankCard[]> {
  const { baseUrl, token } = activePlatform();
  const cards = (await getEnvelope<Partial<BankCard>[]>(`${baseUrl}/wallet/bank-cards/list`, token)) ?? [];
  return cards.map((c) => ({ id: 0, userId: 0, holderName: '', bankName: '', cardNoMasked: '', status: 0, ...c }));
}

/** POST /wallet/bank-cards/bind — field presence is validated by the UI. */
export async function bindBankCard(input: BindBankCardInput): Promise<BankCard> {
  const { baseUrl, token } = activePlatform();
  return requireData(
    await postAuthedEnvelope<BankCard>(`${baseUrl}/wallet/bank-cards/bind`, token, {
      holderName: input.holderName.trim(),
      bankName: input.bankName.trim(),
      bankCode: input.bankCode?.trim() || undefined,
      cardNo: input.cardNo.trim(),
    }),
    'wallet.bind-card',
  );
}

/** DELETE /wallet/bank-cards/delete/{id} */
export async function deleteBankCard(id: number): Promise<void> {
  const { baseUrl, token } = activePlatform();
  await deleteAuthedEnvelope<boolean>(`${baseUrl}/wallet/bank-cards/delete/${id}`, token);
}

/** POST /wallet/withdraw/create — freezes funds on submit (PENDING), payout after review. */
export async function createWithdraw(input: { bankCardId: number; amount: number }): Promise<WithdrawOrder> {
  const { baseUrl, token } = activePlatform();
  return toWithdrawOrder(
    requireData(
      await postAuthedEnvelope<Partial<WithdrawOrder>>(`${baseUrl}/wallet/withdraw/create`, token, {
        bankCardId: input.bankCardId,
        amount: input.amount,
        currency: 'CNY',
      }),
      'wallet.create-withdraw',
    ),
  );
}

/** GET /wallet/withdraw/list?pageNo&pageSize */
export async function listWithdrawOrders(pageNo = 1, pageSize = 50): Promise<WithdrawPage> {
  const { baseUrl, token } = activePlatform();
  const data = await getEnvelope<{ list?: Partial<WithdrawOrder>[]; total?: number; page?: number; size?: number; totalPages?: number }>(
    `${baseUrl}/wallet/withdraw/list?pageNo=${pageNo}&pageSize=${pageSize}`,
    token,
  );
  return {
    list: (data?.list ?? []).map(toWithdrawOrder),
    total: data?.total ?? 0,
    page: data?.page ?? pageNo,
    size: data?.size ?? pageSize,
    totalPages: data?.totalPages ?? 0,
  };
}

/** GET /wallet/withdraw/detail/{id} */
export async function getWithdrawDetail(id: number): Promise<WithdrawOrder> {
  const { baseUrl, token } = activePlatform();
  return toWithdrawOrder(
    requireData(
      await getEnvelope<Partial<WithdrawOrder>>(`${baseUrl}/wallet/withdraw/detail/${id}`, token),
      'wallet.withdraw-detail',
    ),
  );
}

/** Withdraw status → i18n key (labels aligned with App/H5). */
export function withdrawStatusKey(status: number | null | undefined): string {
  // A missing status means PENDING(0): orders are created as PENDING, and 0 is
  // exactly the value the server is most likely to omit from the response.
  const safe = typeof status === 'number' && Number.isFinite(status) ? status : 0;
  return safe >= 0 && safe <= 7 ? `money.wd.status_${safe}` : 'money.wd.status_unknown';
}

/** Withdrawal is on hold (spec WALLET_WITHDRAW_SPEC §10). */
export const WITHDRAW_STATUS_ON_HOLD = 7;

/**
 * Hold reason code + params → i18n key and interpolation values. Returns null when the
 * order is not on hold or carries no code.
 */
export function withdrawHoldReason(
  order: Pick<WithdrawOrder, 'holdReasonCode' | 'holdReasonParams' | 'status'>,
): { key: string; values: Record<string, string> } | null {
  if (order.status !== WITHDRAW_STATUS_ON_HOLD) return null;
  const code = order.holdReasonCode?.trim();
  if (!code) return null;
  let values: Record<string, string> = {};
  if (order.holdReasonParams) {
    try {
      const parsed: unknown = JSON.parse(order.holdReasonParams);
      if (parsed && typeof parsed === 'object') {
        values = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]),
        );
      }
    } catch {
      // Malformed params must not hide the fact that the order is stuck —
      // fall through to the generic text below.
    }
  }
  switch (code) {
    case 'BANK_CUTOFF': {
      // Bank name / resume time are optional: render the shorter variant when absent.
      const hasBank = Boolean(values.bank);
      const hasResume = Boolean(values.resume_at);
      if (hasBank && hasResume) return { key: 'money.wd.hold_bank_cutoff_full', values };
      if (hasResume) return { key: 'money.wd.hold_bank_cutoff_resume', values };
      return { key: 'money.wd.hold_bank_cutoff', values };
    }
    case 'CARD_UNUSABLE':
      return { key: 'money.wd.hold_card_unusable', values };
    case 'NAME_MISMATCH':
      return { key: 'money.wd.hold_name_mismatch', values };
    case 'COMPLIANCE_REVIEW':
      return { key: 'money.wd.hold_compliance', values };
    // OTHER carries free text that is intentionally not translated.
    case 'OTHER':
      return values.text
        ? { key: 'money.wd.hold_other', values }
        : { key: 'money.wd.hold_generic', values };
    default:
      return { key: 'money.wd.hold_generic', values };
  }
}
