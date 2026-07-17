// Money message cards (content types 11=red_packet / 12=money_transfer,
// RP-12: server-injected). `content` carries a display-snapshot JSON
// (camelCase). The snapshot is presentation-only; authoritative state loads
// in the detail dialog. Business colors are fixed (not brand-themed).
import { createContext, useContext } from 'react';
import type { MessageContent, MoneyMessageSnapshot } from '@privchat/sdk';
import { useTranslation } from 'react-i18next';
import { useMoneyUi } from './money-ui';

/**
 * Red-packet live status derived from conversation system messages
 * (App redPacketStatusOf parity): 2 = emptied/expired, 1 = claimed by me.
 * Keeps cards fresh after the injected snapshot goes stale.
 */
export const RedPacketLiveStatusContext = createContext<ReadonlyMap<string, number>>(new Map());
/** DM peer display name (transfer card perspective text); undefined in groups. */
export const MoneyPeerNameContext = createContext<string | undefined>(undefined);

const CARD_BASE =
  'w-[232px] cursor-pointer select-none overflow-hidden rounded-xl text-white flex flex-wrap items-center px-3.5 pt-3';

function RedPacketCard({ snap }: { snap: MoneyMessageSnapshot }) {
  const { t } = useTranslation();
  const money = useMoneyUi();
  const liveMap = useContext(RedPacketLiveStatusContext);
  const live = snap.ref_id !== undefined ? liveMap.get(snap.ref_id) : undefined;
  const statusText =
    live === 2
      ? t('money.card.rp_finished')
      : live === 1
        ? t('money.card.rp_claimed_mine')
        : snap.status === 'finished'
          ? t('money.card.rp_finished')
          : snap.status === 'expired' || snap.status === 'refunding'
            ? t('money.card.rp_expired')
            : t('money.card.rp_open');
  const done = statusText !== t('money.card.rp_open');
  return (
    <div
      className={`${CARD_BASE} bg-gradient-to-br from-[#f0573f] to-[#e5433d] ${done ? 'opacity-70' : ''}`}
      onClick={() => {
        if (snap.ref_id !== undefined) money.open({ type: 'rp-detail', id: snap.ref_id });
      }}
    >
      <span className="mr-3 text-3xl leading-none">🧧</span>
      <div className="min-w-0 flex-1 pb-3">
        <div className="truncate text-[15px] font-semibold">
          {snap.title || t('money.card.rp_default_greeting')}
        </div>
        <div className="text-xs opacity-85">{statusText}</div>
      </div>
      <div className="-mx-3.5 w-[calc(100%+28px)] bg-black/10 px-3.5 py-1 text-[11px] opacity-90">
        {snap.packet_type === 1 ? t('money.card.rp_type_lucky') : t('money.card.rp_type_normal')}
      </div>
    </div>
  );
}

function TransferCard({ snap, isSelf }: { snap: MoneyMessageSnapshot; isSelf: boolean }) {
  const { t } = useTranslation();
  const money = useMoneyUi();
  const peerName = useContext(MoneyPeerNameContext);
  const refunded = snap.status === 'refunded';
  const title =
    refunded || peerName === undefined
      ? t('money.card.tf_title')
      : isSelf
        ? t('money.card.tf_to', { name: peerName })
        : t('money.card.tf_from', { name: peerName });
  const statusText = refunded
    ? t('money.card.tf_refunded')
    : isSelf
      ? t('money.card.tf_arrived')
      : t('money.card.tf_saved');
  return (
    <div
      className={`${CARD_BASE} bg-gradient-to-br from-[#f7a03c] to-[#f08a1d] ${refunded ? 'opacity-70' : ''}`}
      onClick={() => {
        if (snap.ref_id !== undefined) money.open({ type: 'tf-detail', id: snap.ref_id });
      }}
    >
      <span className="mr-3 text-3xl leading-none">💸</span>
      <div className="min-w-0 flex-1 pb-3">
        {snap.amount_text !== undefined && snap.amount_text !== '' && (
          <div className="text-xl font-bold">{snap.amount_text}</div>
        )}
        <div className="truncate text-[15px] font-semibold">{title}</div>
        <div className="text-xs opacity-85">{statusText}</div>
      </div>
      <div className="-mx-3.5 w-[calc(100%+28px)] bg-black/10 px-3.5 py-1 text-[11px] opacity-90">
        {snap.summary || t('money.card.tf_title')}
      </div>
    </div>
  );
}

/** Returns a money card for content types 11/12, else null (row dispatch). */
export function MoneyCardBubble({
  body,
  isSelf,
}: {
  body: Extract<MessageContent, { kind: 'red_packet' | 'money_transfer' }>;
  isSelf: boolean;
}) {
  const { t } = useTranslation();
  const snap = body.money;
  if (snap.ref_id === undefined) {
    return (
      <div className={`${CARD_BASE} bg-gradient-to-br from-[#9ca3af] to-[#6b7280] pb-3`}>
        <span className="text-[15px] font-semibold">{t('money.card.unavailable')}</span>
      </div>
    );
  }
  return body.kind === 'red_packet' ? (
    <RedPacketCard snap={snap} />
  ) : (
    <TransferCard snap={snap} isSelf={isSelf} />
  );
}
