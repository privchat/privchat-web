// Money transfer (App MoneyTransferSendPage parity): amount/note → confirm
// step → instant credit. Direct chats only; card injected server-side (RP-12).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUserProfile } from '@privchat/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { sendMoneyTransfer, yuanToFen, fenToYuan, mapWalletErrorKey } from '@/lib/platform-wallet-provider';

export function TransferSendView({
  channelId,
  toUserId,
  toName,
  onDone,
}: {
  channelId: string;
  toUserId: string;
  toName: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [remark, setRemark] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toUid = Number(toUserId);
  // Display name: SDK profile first (passed name may be a bare uid), then the
  // passed non-numeric name, then a generic fallback.
  const profile = useUserProfile(toUserId);
  const passed = toName.trim();
  const displayName =
    profile?.nickname ||
    profile?.username ||
    (passed !== '' && !/^\d+$/.test(passed) ? passed : t('app.unknown_user', { id: toUserId }));

  if (!Number.isFinite(toUid) || toUid <= 0) {
    return <p className="p-4 text-sm text-destructive">{t('money.tf.dm_only')}</p>;
  }

  const fen = yuanToFen(amount);

  const doTransfer = async () => {
    if (fen === null || submitting) return;
    setSubmitting(true);
    try {
      await sendMoneyTransfer({
        toUserId: toUid,
        channelId,
        amount: fen,
        remark: remark.trim() || undefined,
      });
      setTimeout(onDone, 400);
    } catch (e) {
      setErr(t(mapWalletErrorKey(e, false)));
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (confirming && fen !== null) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col items-center gap-2 rounded-xl border py-7">
          <div className="text-[15px]">{t('money.tf.confirm_title', { name: displayName })}</div>
          <div className="text-4xl font-bold">{fenToYuan(fen)}</div>
          {remark.trim() !== '' && (
            <div className="text-[13px] text-muted-foreground">
              {t('money.tf.field_remark')}: {remark.trim()}
            </div>
          )}
          <p className="px-6 text-center text-xs text-muted-foreground">{t('money.tf.confirm_hint')}</p>
        </div>
        {err !== null && <p className="text-sm text-destructive">{err}</p>}
        <Button
          className="h-11 bg-[#f08a1d] text-white hover:bg-[#dd7d15]"
          disabled={submitting}
          onClick={() => void doTransfer()}
        >
          {t('money.tf.confirm')}
        </Button>
        <Button variant="outline" onClick={() => setConfirming(false)}>
          {t('money.tf.cancel')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-[15px] font-semibold">{t('money.tf.to', { name: displayName })}</p>
      <div className="flex flex-col gap-1.5">
        <Label>{t('money.tf.amount_label')}</Label>
        <Input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.currentTarget.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t('money.tf.remark_label')}</Label>
        <Input
          maxLength={64}
          placeholder={t('money.tf.remark_placeholder')}
          value={remark}
          onChange={(e) => setRemark(e.currentTarget.value)}
        />
      </div>
      {err !== null && <p className="text-sm text-destructive">{err}</p>}
      <Button
        className="h-11 bg-[#f08a1d] text-white hover:bg-[#dd7d15]"
        onClick={() => {
          setErr(null);
          if (yuanToFen(amount) === null) {
            setErr(t('money.tf.err_amount'));
            return;
          }
          setConfirming(true);
        }}
      >
        {t('money.tf.next')}
      </Button>
    </div>
  );
}
