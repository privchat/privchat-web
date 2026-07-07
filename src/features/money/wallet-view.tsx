// Wallet dialog view: balance card + transaction ledger with paging.
// Red-packet / transfer rows click through to their order detail views.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useMoneyUi } from './money-ui';
import {
  getWallet,
  pageWalletTransactions,
  walletBizTypeKey,
  fenToYuan,
  mapWalletErrorKey,
  type WalletInfo,
  type WalletTransaction,
} from '@/lib/platform-wallet-provider';

const PAGE_SIZE = 20;

/** createdAt arrives as epoch millis (string/number) → local time. */
function formatTxTime(v: string | undefined): string {
  if (v === undefined || v === '') return '';
  const n = Number(v);
  const d = Number.isFinite(n) && n > 1e12 ? new Date(n) : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

export function WalletView() {
  const { t } = useTranslation();
  const money = useMoneyUi();
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [items, setItems] = useState<WalletTransaction[]>([]);
  const [pageNo, setPageNo] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadTx = async (page: number, append: boolean) => {
    const res = await pageWalletTransactions(page, PAGE_SIZE);
    setItems((prev) => (append ? [...prev, ...res.list] : res.list));
    setPageNo(page);
    setHasMore(page < res.totalPages);
  };

  useEffect(() => {
    void (async () => {
      setErr(null);
      try {
        const [w] = await Promise.all([getWallet(), loadTx(1, false)]);
        setWallet(w);
      } catch (e) {
        setErr(t(mapWalletErrorKey(e, true)));
      } finally {
        setLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (tx: WalletTransaction) => {
    if (tx.bizId <= 0) return;
    if (tx.bizType >= 400 && tx.bizType <= 402) money.open({ type: 'rp-detail', id: String(tx.bizId) });
    else if (tx.bizType >= 500 && tx.bizType <= 502) money.open({ type: 'tf-detail', id: String(tx.bizId) });
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      {wallet !== null && (
        <div className="rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 p-4 text-white">
          <div className="text-xs opacity-85">{t('money.wallet.available')}</div>
          <div className="text-3xl font-bold">{fenToYuan(wallet.available)}</div>
          <div className="mt-2 flex gap-5 text-xs opacity-85">
            <span>
              {t('money.wallet.total')} {fenToYuan(wallet.balance)}
            </span>
            <span>
              {t('money.wallet.frozen')} {fenToYuan(wallet.freezePrice)}
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Button variant="outline" size="sm" data-testid="wallet-withdraw" onClick={() => money.open({ type: 'withdraw' })}>
          {t('money.wd.entry_withdraw')}
        </Button>
        <Button variant="outline" size="sm" data-testid="wallet-cards" onClick={() => money.open({ type: 'bank-cards' })}>
          {t('money.wd.entry_cards')}
        </Button>
        <Button variant="outline" size="sm" data-testid="wallet-orders" onClick={() => money.open({ type: 'withdraw-orders' })}>
          {t('money.wd.entry_orders')}
        </Button>
      </div>

      <div className="text-sm font-semibold">{t('money.wallet.transactions')}</div>
      {err !== null && <p className="text-sm text-destructive">{err}</p>}
      {loaded && items.length === 0 && err === null && (
        <p className="text-sm text-muted-foreground">{t('money.wallet.tx_empty')}</p>
      )}

      <div>
        {items.map((tx) => {
          const jumpable =
            tx.bizId > 0 && ((tx.bizType >= 400 && tx.bizType <= 402) || (tx.bizType >= 500 && tx.bizType <= 502));
          return (
            <div
              key={tx.id}
              className={`flex items-center justify-between border-b py-2.5 last:border-b-0 ${jumpable ? 'cursor-pointer hover:bg-muted/50' : ''}`}
              onClick={() => open(tx)}
            >
              <div>
                <div className="text-sm">{t(walletBizTypeKey(tx.bizType))}</div>
                <div className="text-[11px] text-muted-foreground">
                  {formatTxTime(tx.createdAt)}　{t('money.wallet.tx_balance_after', { amount: fenToYuan(tx.balance) })}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`text-sm font-semibold ${tx.price > 0 ? 'text-green-600' : ''}`}>
                  {tx.price > 0 ? '+' : ''}
                  {fenToYuan(tx.price)}
                </span>
                {jumpable && <span className="text-muted-foreground">›</span>}
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <Button
          variant="outline"
          disabled={loadingMore}
          onClick={() => {
            setLoadingMore(true);
            void loadTx(pageNo + 1, true)
              .catch((e) => setErr(t(mapWalletErrorKey(e, true))))
              .finally(() => setLoadingMore(false));
          }}
        >
          {t('money.wallet.load_more')}
        </Button>
      )}
    </div>
  );
}
