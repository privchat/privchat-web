// QR_CODE_SPEC v1.3 — Reusable QR display dialog.
//
// Shared by "My QR" (user namecard) and "Group QR". On mount calls
// `useUserQrcode().get()` or `useGroupQrcode().get(groupId)`, renders
// the resulting URL into a <canvas> via the `qrcode` package, and
// shows:
//   - the QR image
//   - the literal URL (copyable)
//   - a "rotate" button that calls refresh()
//
// Refresh is destructive (old qr_key becomes unresolvable) so we
// confirm with a native `confirm()` first. Failure / loading states
// are rendered inline; no toast system in privchat-web.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { Copy, Loader2, RefreshCw } from 'lucide-react';
import { useGroupQrcode, useUserQrcode } from '@privchat/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { captureException } from '@/lib/error-reporter';
import { errorText } from './error-text';

// =====================================================
// Shared QR canvas
// =====================================================

interface QrCanvasProps {
  /** Full URL to encode (already built by server). */
  url: string;
  size?: number;
}

function QrCanvas({ url, size = 240 }: QrCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    QRCode.toCanvas(canvas, url, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
    }).catch((e) => {
      captureException(e, { source: 'qrcode-display.canvas' });
    });
  }, [url, size]);
  return <canvas ref={canvasRef} className="block rounded-md bg-white" />;
}

// =====================================================
// Inner panel — drives state machine and lifecycle.
// =====================================================

type Mode =
  | { kind: 'user' }
  | { kind: 'group'; groupId: string; groupName: string };

interface QrPanelState {
  loading: boolean;
  refreshing: boolean;
  qrKey: string | null;
  qrCode: string | null;
  error: string | null;
}

function useQrPanel(mode: Mode): QrPanelState & {
  reload: () => void;
  rotate: () => void;
} {
  const userOps = useUserQrcode();
  const groupOps = useGroupQrcode();
  const [state, setState] = useState<QrPanelState>({
    loading: true,
    refreshing: false,
    qrKey: null,
    qrCode: null,
    error: null,
  });

  const load = useCallback(
    async (signal: AbortSignal) => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const resp =
          mode.kind === 'user'
            ? await userOps.get()
            : await groupOps.get(mode.groupId);
        if (signal.aborted) return;
        setState({
          loading: false,
          refreshing: false,
          qrKey: resp.qr_key,
          qrCode: resp.qr_code,
          error: null,
        });
      } catch (e) {
        if (signal.aborted) return;
        captureException(e, { source: 'qrcode-display.load' });
        setState((s) => ({ ...s, loading: false, error: errorText(e) }));
      }
    },
    [mode, userOps, groupOps],
  );

  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load]);

  const rotate = useCallback(() => {
    setState((s) => ({ ...s, refreshing: true, error: null }));
    void (async () => {
      try {
        const resp =
          mode.kind === 'user'
            ? await userOps.refresh()
            : await groupOps.refresh(mode.groupId);
        setState({
          loading: false,
          refreshing: false,
          qrKey: resp.new_qr_key,
          qrCode: resp.qr_code,
          error: null,
        });
      } catch (e) {
        captureException(e, { source: 'qrcode-display.rotate' });
        setState((s) => ({
          ...s,
          refreshing: false,
          error: errorText(e),
        }));
      }
    })();
  }, [mode, userOps, groupOps]);

  const reload = useCallback(() => {
    const c = new AbortController();
    void load(c.signal);
  }, [load]);

  return { ...state, reload, rotate };
}

// =====================================================
// Dialog
// =====================================================

export interface QrcodeDisplayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
}

export function QrcodeDisplayDialog({
  open,
  onOpenChange,
  mode,
}: QrcodeDisplayDialogProps) {
  const { t } = useTranslation();
  // Mount panel lazily — only when dialog is open — so we don't fire
  // RPC when the user never opens it.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {mode.kind === 'user'
              ? t('qrcode.user_title')
              : t('qrcode.group_title', { name: mode.groupName })}
          </DialogTitle>
        </DialogHeader>
        {open ? <QrPanel mode={mode} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function QrPanel({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  void onClose; // not used in the body but kept for parity with future ops
  const { t } = useTranslation();
  const { loading, refreshing, qrCode, error, rotate } = useQrPanel(mode);
  const [copied, setCopied] = useState(false);

  const onRotate = useCallback(() => {
    if (refreshing) return;
    const ok = window.confirm(
      mode.kind === 'user'
        ? t('qrcode.confirm_rotate_user')
        : t('qrcode.confirm_rotate_group'),
    );
    if (!ok) return;
    rotate();
  }, [mode, t, refreshing, rotate]);

  const onCopy = useCallback(async () => {
    if (qrCode === null) return;
    try {
      await navigator.clipboard.writeText(qrCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      captureException(e, { source: 'qrcode-display.copy' });
    }
  }, [qrCode]);

  if (error !== null) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
        <Button size="sm" variant="outline" onClick={onRotate} disabled={refreshing}>
          {t('qrcode.retry')}
        </Button>
      </div>
    );
  }

  if (loading || qrCode === null) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        <QrCanvas url={qrCode} />
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {mode.kind === 'user'
          ? t('qrcode.user_hint')
          : t('qrcode.group_hint')}
      </p>
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5">
        <code className="flex-1 truncate text-[11px]" title={qrCode}>
          {qrCode}
        </code>
        <Button size="icon" variant="ghost" onClick={() => void onCopy()} aria-label={t('qrcode.copy_url')}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
      {copied ? (
        <p className="text-center text-[11px] text-emerald-600">{t('qrcode.copied')}</p>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={onRotate}
        disabled={refreshing}
      >
        {refreshing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        <span className="ml-1.5">{t('qrcode.rotate')}</span>
      </Button>
    </div>
  );
}
