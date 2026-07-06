// Red packet detail (App RedPacketDetailPage parity): red header + my claim
// + progress + claim list; in-view "open" button when claimable
// (ACTIVE && not claimed && remaining > 0 && (not sender || group packet)).
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePrivchatClient, useUserProfile } from '@privchat/react';
import { Button } from '@/components/ui/button';
import { UserName } from './user-name';
import {
  claimRedPacket,
  redPacketClaims,
  redPacketDetail,
  redPacketStatusInfo,
  fenToYuan,
  mapWalletErrorKey,
  type RedPacketClaim,
  type RedPacketOrder,
} from '@/lib/platform-wallet-provider';

/** "{name} 发出的红包" — resolved as a plain string so i18n word order works. */
function SenderLine({ uid }: { uid: string }) {
  const { t } = useTranslation();
  const user = useUserProfile(uid);
  const name = user?.nickname || user?.username || t('app.unknown_user', { id: uid });
  return <>{t('money.rp.from', { name })}</>;
}

export function RedPacketDetailView({ redPacketId }: { redPacketId: string }) {
  const { t } = useTranslation();
  const selfUid = usePrivchatClient().sessionSnapshot().user_id;
  const [order, setOrder] = useState<RedPacketOrder | null>(null);
  const [claims, setClaims] = useState<RedPacketClaim[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  const reload = useCallback(async () => {
    setErr(null);
    try {
      const [o, c] = await Promise.all([redPacketDetail(redPacketId), redPacketClaims(redPacketId)]);
      setOrder(o);
      setClaims(c);
    } catch (e) {
      setErr(t(mapWalletErrorKey(e, true)));
    }
  }, [redPacketId, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (err !== null) return <p className="p-4 text-sm text-destructive">{err}</p>;
  if (order === null) return <p className="p-4 text-sm text-muted-foreground">{t('money.wallet.loading')}</p>;

  const isSender = String(order.senderUserId) === selfUid;
  const myClaim = claims.find((c) => String(c.userId) === selfUid);
  const claimable =
    order.status === 0 && myClaim === undefined && order.remainingCount > 0 && (!isSender || order.scene === 1);
  const isLucky = order.type === 1;
  const finished = order.status === 1 || order.remainingCount <= 0;
  const bestLuck =
    isLucky && finished && claims.length > 0
      ? claims.reduce((best, c) => (c.amount > best.amount || (c.amount === best.amount && c.id < best.id) ? c : best))
      : undefined;
  const claimedAmount = order.totalAmount - order.remainingAmount;
  const claimedCount = order.totalCount - order.remainingCount;
  const status = redPacketStatusInfo(order, myClaim !== undefined, isSender);

  const doClaim = async () => {
    if (claiming) return;
    setClaiming(true);
    try {
      await claimRedPacket(order.id);
    } catch (e) {
      setErr(t(mapWalletErrorKey(e, false)));
    } finally {
      setClaiming(false);
      void reload();
    }
  };

  return (
    <div>
      <div className="flex flex-col items-center gap-2 bg-gradient-to-b from-[#f0573f] to-[#e5433d] px-4 py-6 text-white">
        <div className="text-[15px] font-semibold">
          <SenderLine uid={String(order.senderUserId)} />
        </div>
        <div className="text-[13px] opacity-90">{order.greeting || t('money.card.rp_default_greeting')}</div>
        {myClaim !== undefined && (
          <>
            <div className="mt-2 text-4xl font-bold">{fenToYuan(myClaim.amount)}</div>
            <div className="text-xs opacity-85">{t('money.rp.claimed_saved')}</div>
          </>
        )}
        {claimable && (
          <Button
            className="mt-3 rounded-full bg-[#fcd34d] px-8 font-bold text-[#7c2d12] hover:bg-[#fbbf24]"
            disabled={claiming}
            onClick={() => void doClaim()}
          >
            {t('money.rp.open_btn')}
          </Button>
        )}
      </div>

      <p className="px-4 py-3 text-xs text-muted-foreground">
        {isLucky
          ? t('money.rp.summary_lucky', {
              claimed: String(claimedCount),
              total: String(order.totalCount),
              claimedAmount: fenToYuan(claimedAmount),
              totalAmount: fenToYuan(order.totalAmount),
            })
          : t('money.rp.summary_normal', {
              count: String(order.totalCount),
              amount: fenToYuan(order.totalAmount),
              status: t(status.key, status.params),
            })}
      </p>

      <div>
        {claims.map((c) => (
          <div key={c.id} className="flex items-center gap-2.5 border-b px-4 py-2.5 last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">
                <UserName userId={String(c.userId)} />
              </div>
              <div className="text-[11px] text-muted-foreground">{new Date(c.claimedAt).toLocaleString()}</div>
            </div>
            <div className="flex flex-col items-end">
              <div className="text-sm font-semibold">{fenToYuan(c.amount)}</div>
              {bestLuck !== undefined && bestLuck.id === c.id && (
                <div className="text-[11px] text-amber-600">{t('money.rp.best_luck')}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
