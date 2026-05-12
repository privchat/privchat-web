// Bot menu schema decoder + transfer-based loader.
//
// Spec: privchat-docs/spec/07-application/BOT_INTERACTION_SPEC.md §8.
// Mirrors privchat-sdk-kotlin BotMenu.kt and privchat-ui BotMenuController.kt.

import type { PrivchatClientAdapter } from '@privchat/react';

/** Wire `data` payload of `bot/menu/get` (UTF-8 JSON bytes). */
export interface BotMenu {
  version: number;
  items: BotMenuItem[];
}

export interface BotMenuItem {
  id: string;
  title: string;
  action: BotMenuAction;
}

/** Discriminated union by `type`. Spec §4 / §8.2 — only three kinds. */
export type BotMenuAction =
  | { type: 'transfer'; route: string; body?: Record<string, unknown> }
  | { type: 'message'; text: string; metadata?: Record<string, unknown> }
  | {
      type: 'web';
      url: string;
      open_mode?: 'browser' | 'in_app_webview' | 'mini_app';
      prefetch_signed_url_route?: string;
    };

/** Parse the raw `data` bytes returned by `bot/menu/get`. */
export function decodeBotMenu(payload: Uint8Array | undefined): BotMenu | null {
  if (!payload || payload.length === 0) return null;
  const text = new TextDecoder('utf-8', { fatal: false }).decode(payload);
  if (text.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isBotMenu(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isBotMenu(v: unknown): v is BotMenu {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as { version?: unknown; items?: unknown };
  return typeof obj.version === 'number' && Array.isArray(obj.items);
}

const MENU_ROUTE = 'bot/menu/get';
const MENU_TIMEOUT_MS = 5_000;

/**
 * Fetch the bot menu for `channelId` via wire Transfer.
 *
 * The adapter's `transfer` goes through `client.transfer()` → server
 * `TransferRequest` → application `/service/privchat/transfer/dispatch` →
 * `BotMenuTransferHandler` → `privchat_bot_profile.menu_schema`.
 *
 * Throws on transport error; resolves to `{ ok: false, ... }` on
 * application-level non-zero `code`.
 */
export async function loadBotMenu(
  adapter: PrivchatClientAdapter,
  channelId: string,
): Promise<
  | { ok: true; menu: BotMenu }
  | { ok: false; code: number; message: string }
> {
  const requestId = newRequestId();
  const resp = await adapter.transfer({
    request_id: requestId,
    channel_id: channelId,
    route: MENU_ROUTE,
    body: new Uint8Array(0),
    timeoutMs: MENU_TIMEOUT_MS,
  });
  if (resp.code !== 0) {
    return { ok: false, code: resp.code, message: resp.message };
  }
  const menu = decodeBotMenu(resp.data);
  if (menu === null) {
    return { ok: false, code: -1, message: 'bot/menu/get returned malformed schema' };
  }
  return { ok: true, menu };
}

/** UUID v4 — crypto preferred, fall back to Math.random for older runtimes. */
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
