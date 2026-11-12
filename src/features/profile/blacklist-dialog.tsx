// BlacklistDialog — 黑名单管理页（BLACKLIST_SPEC §4.3）。打开时拉取
// contact/blacklist/list，逐行展示被拉黑用户 + 解除按钮。列表是临时 UI
//  surface：每次 open 重新拉取，解除成功后乐观移除该行（失败回滚 + 重拉）。
//
// 服务端响应只带 id/blocked_at/reason（TS 契约无 user_info），昵称/头像
// 走本地 user 缓存（useUserProfile），未同步时回退 `#uid`——不为了显示
// 名字去发额外的 detail RPC。
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { BlacklistUserInfo } from '@privchat/sdk';
import {
  useBlacklistList,
  useUnblockUser,
  useUserProfile,
} from '@privchat/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { captureException } from '@/lib/error-reporter';
import { Avatar } from '../chat/avatar';
import { errorText } from '../chat/error-text';

export function BlacklistDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const fetchBlacklist = useBlacklistList();
  const unblock = useUnblockUser();

  const [items, setItems] = useState<BlacklistUserInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyUid, setBusyUid] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    return fetchBlacklist()
      .then((resp) => {
        setItems(resp.users);
      })
      .catch((e: unknown) => {
        captureException(e, { source: 'blacklist.list' });
        setError(errorText(e));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [fetchBlacklist]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchBlacklist()
      .then((resp) => {
        if (!cancelled) setItems(resp.users);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        captureException(e, { source: 'blacklist.list' });
        setError(errorText(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, fetchBlacklist]);

  const handleUnblock = async (item: BlacklistUserInfo) => {
    if (busyUid !== null) return;
    if (!confirm(t('blacklist.unblock_confirm'))) return;
    setBusyUid(item.blocked_user_id);
    setError(null);
    const prev = items;
    setItems(items.filter((r) => r.blocked_user_id !== item.blocked_user_id));
    try {
      await unblock(item.blocked_user_id);
    } catch (e) {
      captureException(e, { source: 'blacklist.unblock' });
      setItems(prev); // 回滚，服务端才是真源
      setError(errorText(e));
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('blacklist.title')}</DialogTitle>
        </DialogHeader>
        {error !== null && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <div className="max-h-[60vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground" data-testid="blacklist-empty">
              {t('blacklist.empty')}
            </div>
          )}
          <ul className="divide-y">
            {items.map((item) => (
              <BlacklistRow
                key={item.blocked_user_id}
                item={item}
                busy={busyUid === item.blocked_user_id}
                disabled={busyUid !== null}
                onUnblock={() => void handleUnblock(item)}
              />
            ))}
          </ul>
        </div>
        {error !== null && !loading && (
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            {t('blacklist.retry')}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BlacklistRow({
  item,
  busy,
  disabled,
  onUnblock,
}: {
  item: BlacklistUserInfo;
  busy: boolean;
  disabled: boolean;
  onUnblock: () => void;
}) {
  const { t, i18n } = useTranslation();
  const uid = String(item.blocked_user_id);
  const user = useUserProfile(uid);
  const display =
    (user?.nickname !== undefined && user.nickname !== '' ? user.nickname : undefined) ??
    (user?.username !== undefined && user.username !== '' ? user.username : undefined) ??
    `#${uid}`;
  const blockedAt = formatBlockedAt(item.blocked_at, i18n.language);
  return (
    <li className="flex items-center gap-3 py-2" data-testid="blacklist-row" data-uid={uid}>
      <Avatar seed={`u:${uid}`} label={display} size="md" userId={uid} remoteUrl={user?.avatar_url} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{display}</div>
        <div className="truncate text-xs text-muted-foreground">
          {blockedAt !== '' && <span>{t('blacklist.blocked_at', { date: blockedAt })}</span>}
          {item.reason !== undefined && item.reason !== null && item.reason !== '' && (
            <span> · {item.reason}</span>
          )}
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onUnblock}
        disabled={disabled}
        data-testid="blacklist-unblock"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('blacklist.unblock')}
      </Button>
    </li>
  );
}

function formatBlockedAt(iso: string, language: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString(language.startsWith('zh') ? 'zh-CN' : 'en-US');
}