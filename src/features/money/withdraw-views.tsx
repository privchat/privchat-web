// Withdraw / bank-card dialog views (P4 user-side wallet loop, aligned with
// App/H5): card list + bind + withdraw request + order list + order detail.
// Submitting a withdraw freezes funds (PENDING) until back-office review.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useMoneyUi } from './money-ui';
import {
  listBankCards,
  bindBankCard,
  deleteBankCard,
  createWithdraw,
  listWithdrawOrders,
  getWithdrawDetail,
  getWallet,
  fenToYuan,
  yuanToFen,
  withdrawHoldReason,
  WITHDRAW_STATUS_ON_HOLD,
  withdrawStatusKey,
  mapWalletErrorKey,
  type BankCard,
  type WithdrawOrder,
} from '@/lib/platform-wallet-provider';

/** createdAt arrives as epoch millis (string/number) → local time. */
function formatTime(v: string | undefined): string {
  if (v === undefined || v === '') return '';
  const n = Number(v);
  const d = Number.isFinite(n) && n > 1e12 ? new Date(n) : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

// ─────────────────────────── bank cards ───────────────────────────

export function BankCardsView() {
  const { t } = useTranslation();
  const money = useMoneyUi();
  const [cards, setCards] = useState<BankCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = async () => {
    setErr(null);
    try {
      setCards(await listBankCards());
    } catch (e) {
      setErr(t(mapWalletErrorKey(e, true)));
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (card: BankCard) => {
    if (!window.confirm(t('money.wd.delete_confirm', { card: card.cardNoMasked }))) return;
    setBusyId(card.id);
    try {
      await deleteBankCard(card.id);
      await load();
    } catch (e) {
      setErr(t(mapWalletErrorKey(e, false)));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      {err !== null && <p className="text-sm text-destructive">{err}</p>}
      {loaded && cards.length === 0 && err === null && (
        <p className="text-sm text-muted-foreground">{t('money.wd.cards_empty')}</p>
      )}
      {cards.map((c) => (
        <div key={c.id} className="flex items-center justify-between rounded-lg border p-3" data-testid="bank-card-row">
          <div>
            <div className="text-sm font-medium">
              {c.bankName} {c.cardNoMasked}
            </div>
            <div className="text-xs text-muted-foreground">{c.holderName}</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={busyId === c.id}
            onClick={() => void remove(c)}
          >
            {t('money.wd.delete_card')}
          </Button>
        </div>
      ))}
      <Button data-testid="bank-card-add" onClick={() => money.open({ type: 'bind-card' })}>
        {t('money.wd.add_card')}
      </Button>
    </div>
  );
}

export function BindCardView() {
  const { t } = useTranslation();
  const money = useMoneyUi();
  const [holderName, setHolderName] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [cardNo, setCardNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = !busy && holderName.trim() !== '' && bankName.trim() !== '' && cardNo.trim() !== '';

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await bindBankCard({ holderName, bankName, bankCode: bankCode || undefined, cardNo });
      money.open({ type: 'bank-cards' });
    } catch (e) {
      setErr(t(mapWalletErrorKey(e, false)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <Input
        value={holderName}
        onChange={(e) => setHolderName(e.currentTarget.value)}
        placeholder={t('money.wd.holder_ph')}
        data-testid="bind-holder"
      />
      <Input
        value={bankName}
        onChange={(e) => setBankName(e.currentTarget.value)}
        placeholder={t('money.wd.bank_ph')}
        data-testid="bind-bank"
      />
      <Input
        value={bankCode}
        onChange={(e) => setBankCode(e.currentTarget.value)}
        placeholder={t('money.wd.bank_code_ph')}
      />
      <Input
        value={cardNo}
        onChange={(e) => setCardNo(e.currentTarget.value.replace(/[^\d]/g, ''))}
        placeholder={t('money.wd.card_no_ph')}
        maxLength={32}
        data-testid="bind-card-no"
      />
      {err !== null && <p className="text-sm text-destructive">{err}</p>}
      <Button disabled={!canSubmit} onClick={() => void submit()} data-testid="bind-submit">
        {t('money.wd.bind_submit')}
      </Button>
    </div>
  );
}

// ─────────────────────────── withdraw ───────────────────────────

export function WithdrawView() {
  const { t } = useTranslation();
  const money = useMoneyUi();
  const [available, setAvailable] = useState(0);
  const [cards, setCards] = useState<BankCard[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setErr(null);
      try {
        const [w, cs] = await Promise.all([getWallet(), listBankCards()]);
        setAvailable(w.available);
        setCards(cs);
        setSelectedId((prev) => prev ?? cs[0]?.id ?? null);
      } catch (e) {
        setErr(t(mapWalletErrorKey(e, true)));
      } finally {
        setLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fen = yuanToFen(amount);
  const canSubmit = !busy && selectedId !== null && fen !== null && fen > 0 && fen <= available;

  const submit = async () => {
    if (selectedId === null || fen === null) return;
    setBusy(true);
    setErr(null);
    try {
      await createWithdraw({ bankCardId: selectedId, amount: fen });
      money.open({ type: 'withdraw-orders' });
    } catch (e) {
      setErr(t(mapWalletErrorKey(e, false)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="text-sm text-muted-foreground">
        {t('money.wd.available', { amount: fenToYuan(available) })}
      </div>
      <Input
        value={amount}
        onChange={(e) => setAmount(e.currentTarget.value)}
        placeholder={t('money.wd.amount_ph')}
        inputMode="decimal"
        data-testid="withdraw-amount"
      />
      {amount !== '' && fen !== null && fen > available && (
        <p className="text-sm text-destructive">{t('money.wd.exceed_available')}</p>
      )}

      <div className="text-sm font-semibold">{t('money.wd.select_card')}</div>
      {loaded && cards.length === 0 ? (
        <Button variant="outline" onClick={() => money.open({ type: 'bind-card' })}>
          {t('money.wd.need_card')}
        </Button>
      ) : (
        cards.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`flex items-center justify-between rounded-lg border p-3 text-left text-sm ${selectedId === c.id ? 'border-primary' : ''}`}
            onClick={() => setSelectedId(c.id)}
            data-testid="withdraw-card-option"
          >
            <span>
              {c.bankName} {c.cardNoMasked}
            </span>
            {selectedId === c.id && <span className="text-primary">✓</span>}
          </button>
        ))
      )}

      {err !== null && <p className="text-sm text-destructive">{err}</p>}
      <Button disabled={!canSubmit} onClick={() => void submit()} data-testid="withdraw-submit">
        {t('money.wd.submit')}
      </Button>
      <p className="text-center text-xs text-muted-foreground">{t('money.wd.freeze_hint')}</p>
    </div>
  );
}

export function WithdrawOrdersView() {
  const { t } = useTranslation();
  const money = useMoneyUi();
  const [orders, setOrders] = useState<WithdrawOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setOrders((await listWithdrawOrders(1, 50)).list);
      } catch (e) {
        setErr(t(mapWalletErrorKey(e, true)));
      } finally {
        setLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col p-4">
      {err !== null && <p className="text-sm text-destructive">{err}</p>}
      {loaded && orders.length === 0 && err === null && (
        <p className="text-sm text-muted-foreground">{t('money.wd.orders_empty')}</p>
      )}
      {orders.map((o) => (
        <div
          key={o.id}
          className="flex cursor-pointer items-center justify-between border-b py-2.5 last:border-b-0 hover:bg-muted/50"
          onClick={() => money.open({ type: 'withdraw-detail', id: o.id })}
          data-testid="withdraw-order-row"
        >
          <div>
            <div
              className={
                o.status === WITHDRAW_STATUS_ON_HOLD ? 'text-sm text-destructive' : 'text-sm'
              }
            >
              {t(withdrawStatusKey(o.status))}
            </div>
            <div className="text-[11px] text-muted-foreground">{formatTime(o.createdAt)}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold">{fenToYuan(o.amount)}</span>
            <span className="text-muted-foreground">›</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function WithdrawDetailView({ orderId }: { orderId: number }) {
  const { t } = useTranslation();
  const [order, setOrder] = useState<WithdrawOrder | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void getWithdrawDetail(orderId)
      .then(setOrder)
      .catch((e: unknown) => setErr(t(mapWalletErrorKey(e, true))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  if (err !== null) return <p className="p-4 text-sm text-destructive">{err}</p>;
  if (order === null) return <p className="p-4 text-sm text-muted-foreground">{t('money.wallet.loading')}</p>;

  const rows: Array<[string, string]> = [
    [t('money.wd.f_amount'), fenToYuan(order.amount)],
    [t('money.wd.f_fee'), fenToYuan(order.fee)],
    [t('money.wd.f_actual'), fenToYuan(order.actualAmount)],
    [t('money.wd.f_status'), t(withdrawStatusKey(order.status))],
    [t('money.wd.f_time'), formatTime(order.createdAt)],
  ];

  // 挂起原因：运营手填的整段文案，原样展示（spec §10.5）。
  const hold = withdrawHoldReason(order);

  return (
    <div className="space-y-2 p-4 text-sm" data-testid="withdraw-detail">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between">
          <span className="text-muted-foreground">{label}</span>
          <span>{value}</span>
        </div>
      ))}
      {hold !== null && (
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">{t('money.wd.f_reason')}</span>
          <span className="text-right text-destructive">{hold}</span>
        </div>
      )}
      {order.freezeRemarkUserVisible !== undefined && order.freezeRemarkUserVisible !== '' && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('money.wd.f_reason')}</span>
          <span className="text-destructive">{order.freezeRemarkUserVisible}</span>
        </div>
      )}
    </div>
  );
}
