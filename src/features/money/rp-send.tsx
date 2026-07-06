// Send red packet (App RedPacketSendPage parity): groups pick normal/lucky +
// count; direct chats are fixed normal×1. RP-12: only the platform API is
// called — the chat card is injected server-side.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { sendRedPacket, yuanToFen, mapWalletErrorKey } from '@/lib/platform-wallet-provider';

export function RedPacketSendView({
  channelId,
  channelType,
  onDone,
}: {
  channelId: string;
  channelType: number;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const isGroup = channelType === 2;
  const [amount, setAmount] = useState('');
  const [count, setCount] = useState('1');
  const [greeting, setGreeting] = useState('');
  const [isLucky, setIsLucky] = useState(isGroup);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const submit = async () => {
    setErr(null);
    const fen = yuanToFen(amount);
    if (fen === null) {
      setErr(t('money.rp.err_amount'));
      return;
    }
    const cnt = Number(count);
    if (!Number.isInteger(cnt) || cnt < 1) {
      setErr(t('money.rp.err_count'));
      return;
    }
    if (!isGroup && cnt > 1) {
      setErr(t('money.rp.err_dm_count'));
      return;
    }
    if (fen < cnt) {
      setErr(t('money.rp.err_min_per'));
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      await sendRedPacket({
        channelId,
        scene: isGroup ? 1 : 0,
        type: isLucky ? 1 : 0,
        totalAmount: fen,
        totalCount: cnt,
        greeting: greeting.trim() || undefined,
      });
      setOk(true);
      setTimeout(onDone, 700);
    } catch (e) {
      setErr(t(mapWalletErrorKey(e, false)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      {isGroup && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant={isLucky ? 'default' : 'outline'}
            className="flex-1"
            onClick={() => setIsLucky(true)}
          >
            {t('money.rp.type_lucky')}
          </Button>
          <Button
            type="button"
            variant={!isLucky ? 'default' : 'outline'}
            className="flex-1"
            onClick={() => setIsLucky(false)}
          >
            {t('money.rp.type_normal')}
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label>{t('money.rp.amount_label')}</Label>
        <Input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.currentTarget.value)} />
      </div>
      {isGroup && (
        <div className="flex flex-col gap-1.5">
          <Label>{t('money.rp.count_label')}</Label>
          <Input inputMode="numeric" placeholder="1" value={count} onChange={(e) => setCount(e.currentTarget.value)} />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label>{t('money.rp.greeting_label')}</Label>
        <Input
          maxLength={64}
          placeholder={t('money.rp.greeting_placeholder')}
          value={greeting}
          onChange={(e) => setGreeting(e.currentTarget.value)}
        />
      </div>
      {err !== null && <p className="text-sm text-destructive">{err}</p>}
      <Button
        className="h-11 bg-[#e5433d] text-white hover:bg-[#d13c36]"
        disabled={submitting}
        onClick={() => void submit()}
      >
        {ok ? t('money.rp.submit_ok') : t('money.rp.submit')}
      </Button>
      <p className="text-center text-xs text-muted-foreground">{t('money.rp.expire_hint')}</p>
    </div>
  );
}
