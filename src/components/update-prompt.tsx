// 「新版本可用」提示(对齐 admin 后台体验):构建产物带 version.json(buildId),
// 前端每 5 分钟 + 页面回前台时比对;变化则弹「刷新以获取最新版本」。
// 取消后同一 buildId 不再打扰;version.json 缺失(本地 dev)静默跳过。
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

async function fetchBuildId(): Promise<string | null> {
  try {
    const r = await fetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { buildId?: unknown };
    return typeof j.buildId === 'string' ? j.buildId : null;
  } catch {
    return null;
  }
}

export function UpdatePrompt() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const initialRef = useRef<string | null>(null);
  const dismissedRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const id = await fetchBuildId();
      if (cancelled || id === null) return;
      if (initialRef.current === null) {
        initialRef.current = id;
        return;
      }
      if (id !== initialRef.current && id !== dismissedRef.current) {
        dismissedRef.current = id;
        setOpen(true);
      }
    };
    void check();
    const timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm" data-testid="update-prompt">
        <DialogHeader>
          <DialogTitle>{t('update.title')}</DialogTitle>
          <DialogDescription>{t('update.desc')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('update.cancel')}
          </Button>
          <Button onClick={() => window.location.reload()}>{t('update.refresh')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
