// Transfer detail (App MoneyTransferDetailPage parity).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserName } from './user-name';
import {
  moneyTransferDetail,
  fenToYuan,
  mapWalletErrorKey,
  type MoneyTransferOrder,
} from '@/lib/platform-wallet-provider';

export function TransferDetailView({ transferId }: { transferId: string }) {
  const { t } = useTranslation();
  const [order, setOrder] = useState<MoneyTransferOrder | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setOrder(await moneyTransferDetail(transferId));
      } catch (e) {
        setErr(t(mapWalletErrorKey(e, true)));
      }
    })();
  }, [transferId, t]);

  if (err !== null) return <p className="p-4 text-sm text-destructive">{err}</p>;
  if (order === null) return <p className="p-4 text-sm text-muted-foreground">{t('money.wallet.loading')}</p>;

  const refunded = order.status === 1;
  const rows: Array<[string, React.ReactNode]> = [
    [t('money.tf.field_from'), <UserName key="f" userId={String(order.fromUserId)} />],
    [t('money.tf.field_to'), <UserName key="t" userId={String(order.toUserId)} />],
    ...(order.remark !== undefined && order.remark !== ''
      ? ([[t('money.tf.field_remark'), order.remark]] as Array<[string, React.ReactNode]>)
      : []),
    [t('money.tf.field_time'), new Date(order.createdAt).toLocaleString()],
    [t('money.tf.field_order'), String(order.id)],
  ];

  return (
    <div>
      <div className="flex flex-col items-center gap-1.5 py-7">
        <span className="text-4xl">💸</span>
        <div className="text-3xl font-bold">{fenToYuan(order.amount)}</div>
        <div className={`text-[13px] ${refunded ? 'text-muted-foreground' : 'text-green-600'}`}>
          {refunded ? t('money.tf.status_refunded') : t('money.tf.status_ok')}
        </div>
      </div>
      <div className="border-t">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between border-b px-4 py-2.5 text-sm last:border-b-0">
            <span className="text-muted-foreground">{label}</span>
            <span className="max-w-[60%] truncate text-right">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
