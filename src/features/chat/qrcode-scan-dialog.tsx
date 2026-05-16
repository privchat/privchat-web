// QR_CODE_SPEC v1.3 — Paste / receive QR link → resolve → act dialog.
//
// Web browsers can't access the camera scanning surface uniformly
// (getUserMedia + a JS QR decoder works but is platform-jagged), so
// v1 of this UI is a paste-the-URL flow:
//
//   1. user pastes the URL string they got from a scanner / share
//   2. parsePrivchatLink classifies it (user-get / group-join /
//      unsupported / not-privchat)
//   3. for user-get → call userQrcodeResolve → show user card + a
//      "Add friend" button (or "Already a friend" / "This is you")
//   4. for group-join → call groupJoinByQrcode → show "joined" /
//      "pending approval" / "rejected" state
//
// Future: integrate a JS QR decoder + getUserMedia preview.

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import {
  parsePrivchatLink,
  useGroupQrcode,
  useUserQrcode,
  type PrivchatProtocolLink,
} from '@privchat/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { captureException } from '@/lib/error-reporter';
import { Avatar } from './avatar';
import { errorText } from './error-text';

// =====================================================
// Resolve / join state machines
// =====================================================

type ResolveState =
  | { kind: 'idle' }
  | { kind: 'parsing' }
  | { kind: 'parsed-user'; qrKey: string }
  | { kind: 'parsed-group'; qrKey: string }
  | { kind: 'unsupported'; entity: string; action: string }
  | { kind: 'not-privchat' }
  | {
      kind: 'user-card';
      user_id: string;
      username: string;
      display_name?: string;
      avatar_url?: string;
      user_type: number;
      is_friend: boolean;
      is_self: boolean;
    }
  | { kind: 'group-joined'; groupId: string }
  | { kind: 'group-pending'; groupId: string; requestId?: string }
  | { kind: 'busy' }
  | { kind: 'error'; message: string };

interface QrcodeScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the user clicks "Open chat" / "Add friend" on a
   *  resolved user card. Host wires this to its normal friend-add
   *  flow (useOpenDirectConversation / contact-find-dialog). */
  onOpenUserProfile?: (userId: string) => void;
  /** Called when joining a group succeeded (status='joined'). Host
   *  routes the user into the new group channel. */
  onJoinedGroup?: (groupId: string) => void;
}

export function QrcodeScanDialog({
  open,
  onOpenChange,
  onOpenUserProfile,
  onJoinedGroup,
}: QrcodeScanDialogProps) {
  const { t } = useTranslation();
  const [raw, setRaw] = useState('');
  const [state, setState] = useState<ResolveState>({ kind: 'idle' });
  const userOps = useUserQrcode();
  const groupOps = useGroupQrcode();

  const reset = useCallback(() => {
    setRaw('');
    setState({ kind: 'idle' });
  }, []);

  const onParse = useCallback(() => {
    const link: PrivchatProtocolLink = parsePrivchatLink(raw.trim());
    switch (link.kind) {
      case 'user-get':
        setState({ kind: 'parsed-user', qrKey: link.qrKey });
        // immediately resolve
        void (async () => {
          setState({ kind: 'busy' });
          try {
            const card = await userOps.resolve(link.qrKey);
            setState({ kind: 'user-card', ...card });
          } catch (e) {
            captureException(e, { source: 'qrcode-scan.user-resolve' });
            setState({ kind: 'error', message: errorText(e) });
          }
        })();
        break;
      case 'group-join':
        setState({ kind: 'parsed-group', qrKey: link.qrKey });
        break;
      case 'unsupported':
        setState({
          kind: 'unsupported',
          entity: link.entity,
          action: link.action,
        });
        break;
      case 'not-privchat':
        setState({ kind: 'not-privchat' });
        break;
    }
  }, [raw, userOps]);

  const onJoinGroup = useCallback(
    (qrKey: string) => {
      setState({ kind: 'busy' });
      void (async () => {
        try {
          const resp = await groupOps.joinByQrcode(qrKey);
          if (resp.status === 'joined') {
            setState({ kind: 'group-joined', groupId: resp.group_id });
          } else if (resp.status === 'pending') {
            setState({
              kind: 'group-pending',
              groupId: resp.group_id,
              requestId: resp.request_id,
            });
          } else {
            setState({
              kind: 'error',
              message: t('qrcode.scan_group_unknown_status', {
                status: resp.status,
              }),
            });
          }
        } catch (e) {
          captureException(e, { source: 'qrcode-scan.group-join' });
          setState({ kind: 'error', message: errorText(e) });
        }
      })();
    },
    [groupOps, t],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('qrcode.scan_title')}</DialogTitle>
        </DialogHeader>
        <ScanBody
          raw={raw}
          setRaw={setRaw}
          state={state}
          onParse={onParse}
          onJoinGroup={onJoinGroup}
          onReset={reset}
          onOpenUserProfile={onOpenUserProfile}
          onJoinedGroup={onJoinedGroup}
        />
      </DialogContent>
    </Dialog>
  );
}

function ScanBody({
  raw,
  setRaw,
  state,
  onParse,
  onJoinGroup,
  onReset,
  onOpenUserProfile,
  onJoinedGroup,
}: {
  raw: string;
  setRaw: (s: string) => void;
  state: ResolveState;
  onParse: () => void;
  onJoinGroup: (qrKey: string) => void;
  onReset: () => void;
  onOpenUserProfile?: (userId: string) => void;
  onJoinedGroup?: (groupId: string) => void;
}) {
  const { t } = useTranslation();

  const canSubmit = useMemo(() => raw.trim() !== '', [raw]);

  // ---- terminal states ----

  if (state.kind === 'busy') {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {state.message}
        </div>
        <Button size="sm" variant="outline" onClick={onReset}>
          {t('qrcode.scan_reset')}
        </Button>
      </div>
    );
  }

  if (state.kind === 'not-privchat') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t('qrcode.scan_not_privchat')}
        </p>
        <Button size="sm" variant="outline" onClick={onReset}>
          {t('qrcode.scan_reset')}
        </Button>
      </div>
    );
  }

  if (state.kind === 'unsupported') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t('qrcode.scan_unsupported', {
            entity: state.entity,
            action: state.action,
          })}
        </p>
        <Button size="sm" variant="outline" onClick={onReset}>
          {t('qrcode.scan_reset')}
        </Button>
      </div>
    );
  }

  if (state.kind === 'user-card') {
    const display = state.display_name ?? state.username;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar
            seed={`u:${state.user_id}`}
            label={display}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{display}</div>
            <div className="truncate text-xs text-muted-foreground">
              @{state.username}
            </div>
          </div>
        </div>

        {state.is_self ? (
          <p className="text-center text-xs text-muted-foreground">
            {t('qrcode.scan_user_self')}
          </p>
        ) : state.is_friend ? (
          <Button
            size="sm"
            className="w-full"
            onClick={() => {
              onOpenUserProfile?.(state.user_id);
              onReset();
            }}
          >
            {t('qrcode.scan_user_open_chat')}
          </Button>
        ) : (
          <Button
            size="sm"
            className="w-full"
            onClick={() => {
              onOpenUserProfile?.(state.user_id);
              onReset();
            }}
          >
            {t('qrcode.scan_user_add_friend')}
          </Button>
        )}
        <Button size="sm" variant="outline" className="w-full" onClick={onReset}>
          {t('qrcode.scan_reset')}
        </Button>
      </div>
    );
  }

  if (state.kind === 'group-joined') {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm">{t('qrcode.scan_group_joined')}</p>
        <Button
          size="sm"
          className="w-full"
          onClick={() => {
            onJoinedGroup?.(state.groupId);
            onReset();
          }}
        >
          {t('qrcode.scan_group_open')}
        </Button>
      </div>
    );
  }

  if (state.kind === 'group-pending') {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm">{t('qrcode.scan_group_pending')}</p>
        <Button size="sm" variant="outline" onClick={onReset}>
          {t('qrcode.scan_reset')}
        </Button>
      </div>
    );
  }

  if (state.kind === 'parsed-group') {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm text-muted-foreground">
          {t('qrcode.scan_group_about_to_join')}
        </p>
        <Button size="sm" className="w-full" onClick={() => onJoinGroup(state.qrKey)}>
          {t('qrcode.scan_group_confirm_join')}
        </Button>
        <Button size="sm" variant="outline" className="w-full" onClick={onReset}>
          {t('qrcode.scan_reset')}
        </Button>
      </div>
    );
  }

  // ---- idle / typing ----
  return (
    <div className="space-y-3">
      <label className="block text-xs text-muted-foreground">
        {t('qrcode.scan_input_label')}
      </label>
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={3}
        placeholder="https://…/privchat:protocol/<entity>/<action>/<qrkey>"
        className="w-full resize-none rounded-md border bg-background p-2 text-xs"
      />
      <Button size="sm" className="w-full" disabled={!canSubmit} onClick={onParse}>
        {t('qrcode.scan_submit')}
      </Button>
    </div>
  );
}
