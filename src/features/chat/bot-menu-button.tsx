// BotMenuButton — composer-side icon that fetches the bot's menu schema
// (transfer `bot/menu/get`) and renders it as a dropdown above the input.
//
// Visible only when the conversation peer is `user_type=2` (Bot).
// Spec: BOT_INTERACTION_SPEC.md §3.1 / §3.2 / §4 / §8.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu as MenuIcon, ExternalLink, MessageSquare, Zap } from 'lucide-react';
import { usePrivchatClient } from '@privchat/react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { loadBotMenu, type BotMenu, type BotMenuItem } from './bot-menu';

export interface BotMenuButtonProps {
  channelId: string;
  /** Called with a free-form error message; host should toast / log. */
  onError?: (message: string) => void;
  /**
   * Called when a `message`-action menu item is clicked. The composer drives
   * the send so the message lands in the timeline with the right reply / ack
   * semantics; we don't shortcut around `sendTextMessage`.
   */
  onSendMessage?: (text: string, metadata?: Record<string, unknown>) => void;
}

export function BotMenuButton({ channelId, onError, onSendMessage }: BotMenuButtonProps) {
  const { t } = useTranslation();
  const adapter = usePrivchatClient();
  const [open, setOpen] = useState(false);
  // Cache the last successfully-loaded menu in a ref so re-opens are instant.
  // We do NOT cache failures; user must click again to retry.
  const cacheRef = useRef<{ channelId: string; menu: BotMenu } | null>(null);
  const [menu, setMenu] = useState<BotMenu | null>(null);
  const [loading, setLoading] = useState(false);

  // Invalidate cache on channel switch.
  useEffect(() => {
    if (cacheRef.current && cacheRef.current.channelId !== channelId) {
      cacheRef.current = null;
      setMenu(null);
    }
  }, [channelId]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    if (cacheRef.current && cacheRef.current.channelId === channelId) {
      setMenu(cacheRef.current.menu);
      return;
    }
    void (async () => {
      setLoading(true);
      try {
        const r = await loadBotMenu(adapter, channelId);
        if (r.ok) {
          cacheRef.current = { channelId, menu: r.menu };
          setMenu(r.menu);
        } else {
          onError?.(`${t('bot_menu.load_failed')}: code=${r.code} ${r.message}`);
          // Keep dropdown open so the empty state shows; user can close manually.
        }
      } catch (e) {
        onError?.(`${t('bot_menu.load_failed')}: ${(e as Error).message ?? 'unknown'}`);
      } finally {
        setLoading(false);
      }
    })();
  };

  const dispatchItem = async (item: BotMenuItem) => {
    setOpen(false);
    const action = item.action;
    if (action.type === 'message') {
      onSendMessage?.(action.text, action.metadata);
      return;
    }
    if (action.type === 'web') {
      // Spec §8.2 default open_mode = 'in_app_webview'; web app has no
      // native webview, so always open in a new tab. mini_app falls back
      // to plain open too — host responsible for richer handling.
      // prefetch_signed_url_route handling is left to the host (route
      // resolution + signed-url retrieval would need another transfer);
      // v1 uses the literal URL.
      window.open(action.url, '_blank', 'noopener,noreferrer');
      return;
    }
    // transfer
    try {
      const body =
        action.body !== undefined
          ? new TextEncoder().encode(JSON.stringify(action.body))
          : new Uint8Array(0);
      const resp = await adapter.transfer({
        request_id: newRequestId(),
        channel_id: channelId,
        route: action.route,
        body,
        timeoutMs: 5_000,
      });
      if (resp.code !== 0) {
        onError?.(`${item.title}: code=${resp.code} ${resp.message}`);
      }
      // Transfer responses are RPC-style — no timeline insert; host can
      // surface success via toast if desired.
    } catch (e) {
      onError?.(`${item.title}: ${(e as Error).message ?? 'unknown'}`);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('bot_menu.button_label')}
          title={t('bot_menu.button_label')}
        >
          <MenuIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuLabel>{t('bot_menu.title')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loading && (
          <DropdownMenuItem disabled>
            {t('bot_menu.loading')}
          </DropdownMenuItem>
        )}
        {!loading && menu !== null && menu.items.length === 0 && (
          <DropdownMenuItem disabled>{t('bot_menu.empty')}</DropdownMenuItem>
        )}
        {!loading &&
          menu !== null &&
          menu.items.map((item) => (
            <DropdownMenuItem key={item.id} onSelect={() => void dispatchItem(item)}>
              <ActionIcon action={item.action} />
              <span className="ml-2">{item.title}</span>
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ActionIcon({ action }: { action: BotMenuItem['action'] }) {
  if (action.type === 'message') return <MessageSquare className="h-3.5 w-3.5" />;
  if (action.type === 'web') return <ExternalLink className="h-3.5 w-3.5" />;
  return <Zap className="h-3.5 w-3.5" />;
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
