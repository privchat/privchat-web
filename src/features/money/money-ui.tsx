// Money dialog host — web has no router, so red-packet / transfer / wallet
// "pages" are dialog views managed by this context. Any component under
// <MoneyDialogsProvider> can `useMoneyUi().open(...)`.
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RedPacketSendView } from './rp-send';
import { RedPacketDetailView } from './rp-detail';
import { TransferSendView } from './tf-send';
import { TransferDetailView } from './tf-detail';
import { WalletView } from './wallet-view';
import {
  BankCardsView,
  BindCardView,
  WithdrawView,
  WithdrawOrdersView,
  WithdrawDetailView,
} from './withdraw-views';

export type MoneyView =
  | { type: 'rp-send'; channelId: string; channelType: number }
  | { type: 'rp-detail'; id: string }
  | { type: 'tf-send'; channelId: string; toUserId: string; toName: string }
  | { type: 'tf-detail'; id: string }
  | { type: 'wallet' }
  | { type: 'bank-cards' }
  | { type: 'bind-card' }
  | { type: 'withdraw' }
  | { type: 'withdraw-orders' }
  | { type: 'withdraw-detail'; id: number };

const TITLE_KEYS: Record<MoneyView['type'], string> = {
  'rp-send': 'money.rp.send_title',
  'rp-detail': 'money.rp.detail_title',
  'tf-send': 'money.tf.send_title',
  'tf-detail': 'money.tf.detail_title',
  wallet: 'money.wallet.title',
  'bank-cards': 'money.wd.cards_title',
  'bind-card': 'money.wd.bind_title',
  withdraw: 'money.wd.withdraw_title',
  'withdraw-orders': 'money.wd.orders_title',
  'withdraw-detail': 'money.wd.detail_title',
};

interface MoneyUi {
  open: (view: MoneyView) => void;
  close: () => void;
}

const MoneyUiContext = createContext<MoneyUi>({ open: () => {}, close: () => {} });

export function useMoneyUi(): MoneyUi {
  return useContext(MoneyUiContext);
}

export function MoneyDialogsProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [view, setView] = useState<MoneyView | null>(null);
  const open = useCallback((v: MoneyView) => setView(v), []);
  const close = useCallback(() => setView(null), []);
  const api = useMemo(() => ({ open, close }), [open, close]);

  const title = view === null ? '' : t(TITLE_KEYS[view.type]);

  return (
    <MoneyUiContext.Provider value={api}>
      {children}
      <Dialog open={view !== null} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto">
            {view?.type === 'rp-send' && (
              <RedPacketSendView channelId={view.channelId} channelType={view.channelType} onDone={close} />
            )}
            {view?.type === 'rp-detail' && <RedPacketDetailView redPacketId={view.id} />}
            {view?.type === 'tf-send' && (
              <TransferSendView
                channelId={view.channelId}
                toUserId={view.toUserId}
                toName={view.toName}
                onDone={close}
              />
            )}
            {view?.type === 'tf-detail' && <TransferDetailView transferId={view.id} />}
            {view?.type === 'wallet' && <WalletView />}
            {view?.type === 'bank-cards' && <BankCardsView />}
            {view?.type === 'bind-card' && <BindCardView />}
            {view?.type === 'withdraw' && <WithdrawView />}
            {view?.type === 'withdraw-orders' && <WithdrawOrdersView />}
            {view?.type === 'withdraw-detail' && <WithdrawDetailView orderId={view.id} />}
          </div>
        </DialogContent>
      </Dialog>
    </MoneyUiContext.Provider>
  );
}
