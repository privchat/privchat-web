// 填写邀请码 dialog(MEMBER_INVITE_CODE §5.2):一个账号只能绑定一次;
// 已绑定则只读展示码/邀请人/时间。绑定成功且有邀请人 → 自动互加好友提示。
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePrivchatClient } from '@privchat/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  bindInviteCode,
  myInviteBinding,
  type MyInviteBinding,
} from '@/lib/platform-invite-provider';

export function InviteBindDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const uid = usePrivchatClient().sessionSnapshot().user_id ?? '';
  const [binding, setBinding] = useState<MyInviteBinding | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open || uid === '') return;
    setMsg(null);
    setBinding(null);
    void myInviteBinding(uid)
      .then(setBinding)
      .catch(() => setBinding({ bound: false }));
  }, [open, uid]);

  const submit = async () => {
    const trimmed = code.trim();
    if (trimmed === '' || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const result = await bindInviteCode(uid, trimmed);
      setBinding({
        bound: true,
        code: result.code,
        inviterUserId: result.inviterUserId,
        autoFriendStatus: result.autoFriendStatus,
      });
      setMsg({
        ok: true,
        text:
          result.inviterUserId !== undefined
            ? t('invite.success_friend')
            : t('invite.success'),
      });
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      setMsg({
        ok: false,
        text: raw.includes('INVITE_ALREADY_BOUND')
          ? t('invite.err_already')
          : raw.includes('INVITE_CODE_SELF')
            ? t('invite.err_self')
            : raw.includes('INVITE_CODE')
              ? t('invite.err_invalid')
              : t('invite.err_failed'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('invite.title')}</DialogTitle>
        </DialogHeader>
        {binding === null ? (
          <p className="text-sm text-muted-foreground">{t('invite.loading')}</p>
        ) : binding.bound ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('invite.bound_code')}</span>
              <span className="font-mono">{binding.code}</span>
            </div>
            {binding.inviterUserId !== undefined && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('invite.bound_inviter')}</span>
                <span>UID {binding.inviterUserId}</span>
              </div>
            )}
            {binding.boundAt !== undefined && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('invite.bound_at')}</span>
                <span>{new Date(binding.boundAt).toLocaleString()}</span>
              </div>
            )}
            <p className="pt-2 text-xs text-muted-foreground">{t('invite.bound_hint')}</p>
            {msg !== null && (
              <p className={msg.ok ? 'text-sm text-green-600' : 'text-sm text-destructive'}>
                {msg.text}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              value={code}
              onChange={(e) => setCode(e.currentTarget.value)}
              placeholder={t('invite.input_ph')}
              maxLength={32}
              disabled={busy}
              data-testid="invite-bind-input"
            />
            {msg !== null && (
              <p className={msg.ok ? 'text-sm text-green-600' : 'text-sm text-destructive'}>
                {msg.text}
              </p>
            )}
            <Button
              className="w-full"
              disabled={busy || code.trim() === ''}
              onClick={() => void submit()}
              data-testid="invite-bind-submit"
            >
              {t('invite.bind_btn')}
            </Button>
            <p className="text-center text-xs text-muted-foreground">{t('invite.bind_hint')}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
