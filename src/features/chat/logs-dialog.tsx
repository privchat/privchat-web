// Lightweight in-app log viewer. Subscribes to the in-memory ring
// buffer (`log-buffer.ts`) — populated by patching `console.*` at
// module load — and renders the entries in a modal. Two actions:
// copy-all and clear. No filtering / search; this is a "I need to see
// the noisy SDK debug logs without devtools" affordance, not a full
// log explorer.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { clearLogs, subscribeLogs, type LogEntry } from './log-buffer';

const LEVEL_CLS: Record<LogEntry['level'], string> = {
  log: 'text-foreground',
  info: 'text-foreground',
  debug: 'text-muted-foreground',
  warn: 'text-amber-500',
  error: 'text-destructive',
};

export function LogsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<LogEntry[]>([]);

  useEffect(() => {
    if (!open) return;
    return subscribeLogs((next) => setEntries([...next]));
  }, [open]);

  const onCopyAll = () => {
    const text = entries
      .map((e) => `[${formatTs(e.ts)}] [${e.level.toUpperCase()}] ${e.text}`)
      .join('\n');
    void navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('logs.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onCopyAll} disabled={entries.length === 0}>
            {t('logs.copy_all')}
          </Button>
          <Button size="sm" variant="outline" onClick={clearLogs} disabled={entries.length === 0}>
            {t('logs.clear')}
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {entries.length}
          </span>
        </div>
        <div className="max-h-[60vh] min-h-[200px] overflow-y-auto rounded border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
          {entries.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground">
              {t('logs.empty')}
            </div>
          ) : (
            entries.map((e, i) => (
              <div key={i} className={cn('whitespace-pre-wrap break-all', LEVEL_CLS[e.level])}>
                <span className="text-muted-foreground">[{formatTs(e.ts)}]</span>{' '}
                <span className="opacity-70">[{e.level}]</span> {e.text}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatTs(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const z = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${z}`;
}
