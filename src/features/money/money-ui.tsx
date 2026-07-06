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

export type MoneyView =
  | { type: 'rp-send'; channelId: string; channelType: number }
  | { type: 'rp-detail'; id: string }
  | { type: 'tf-send'; channelId: string; toUserId: string; toName: string }
  | { type: 'tf-detail'; id: string }
  | { type: 'wallet' };

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

  const title =
    view === null
      ? ''
      : view.type === 'rp-send'
        ? t('money.rp.send_title')
        : view.type === 'rp-detail'
          ? t('money.rp.detail_title')
          : view.type === 'tf-send'
            ? t('money.tf.send_title')
            : view.type === 'tf-detail'
              ? t('money.tf.detail_title')
              : t('money.wallet.title');

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
          </div>
        </DialogContent>
      </Dialog>
    </MoneyUiContext.Provider>
  );
}
