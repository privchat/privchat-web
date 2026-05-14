// R7.3 — sidebar account switcher.
//
// Lives in the top bar next to logout / theme / lang. Clicking the
// trigger opens a dropdown listing every entry in
// `privchat.web.accounts`, with a checkmark on the active one and
// an "Add account" item at the bottom. Selecting an account fires
// `onSelectAccount`; selecting "Add account" fires `onAddAccount`.
// The component does NOT manage any switch sequencing itself — App.tsx
// owns that — it's purely the UI affordance.
//
// Reads registry + active-account state via `useSyncExternalStore`
// hooks so adding an account / switching active automatically
// re-renders the trigger label and the dropdown list.

import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, Plus, Users, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  loadRegistry,
  subscribeRegistry,
} from '@/lib/account-registry-store';
import {
  getActiveAccountKey,
  subscribeActiveAccount,
} from '@/lib/active-account';
import type { AccountKey } from '@/lib/account-key';
import type { AccountEntry } from '@/lib/account-registry';
import { cn } from '@/lib/utils';

export interface AccountSwitcherProps {
  /** Stable React identity of the currently-active account. App.tsx
   *  passes this from its own state so the active row's checkmark
   *  doesn't race the registry-on-disk view (saveRegistry is async-
   *  ish and the active-account seam can lag a tick). */
  activeAccountKey: AccountKey | null;
  onSelectAccount: (key: AccountKey) => void;
  onAddAccount: () => void;
  /** R7.4 — true while a switch sequencer is running. The trigger
   *  button + every dropdown entry disable so the user can't queue
   *  another switch mid-flight. */
  disabled?: boolean;
  /** R7.4 — i18n key under `accounts.*` to render as an error chip
   *  at the top of the dropdown (e.g. switch was rolled back).
   *  `null` to hide the chip. */
  errorI18nKey?: 'switch_failed' | 'switch_target_missing' | null;
  /** Optional callback to clear the surfaced error. Wired to the
   *  close button on the chip; the chip itself doesn't auto-dismiss
   *  so the user has a chance to read it. */
  onDismissError?: () => void;
}

interface RegistrySnapshot {
  /** Sorted by `added_at` ascending so the original / first-added
   *  account stays at the top regardless of switching order. */
  entries: Array<{ key: AccountKey; entry: AccountEntry }>;
  active: AccountKey | null;
}

function loadSnapshot(): RegistrySnapshot {
  const reg = loadRegistry();
  if (reg === null) {
    return { entries: [], active: null };
  }
  const entries = (Object.entries(reg.accounts) as [AccountKey, AccountEntry][])
    .sort((a, b) => a[1].added_at - b[1].added_at)
    .map(([key, entry]) => ({ key, entry }));
  return { entries, active: reg.active };
}

let cachedSnapshot: RegistrySnapshot = loadSnapshot();
function rereadSnapshot(): void {
  cachedSnapshot = loadSnapshot();
}
function snapshotGetter(): RegistrySnapshot {
  return cachedSnapshot;
}
function snapshotSubscribe(cb: () => void): () => void {
  // Catch-up read: `cachedSnapshot` is module-level and initialized
  // ONCE at module load — which happens BEFORE the user logs in.
  // After login, `saveRegistry` notifies listeners, but at that
  // moment the AccountSwitcher (inside ChatWorkspace) isn't mounted
  // yet, so its listener doesn't exist and the cache stays stale.
  // The first time the switcher mounts post-login, useSyncExternalStore
  // calls this subscribe — refresh the cache here so the dropdown
  // shows the just-logged-in account on first paint.
  rereadSnapshot();
  // The registry primitive notifies us of all writes (saveRegistry /
  // clearRegistry); the active-account seam covers the in-memory
  // active flip that happens BEFORE any write. Subscribing to both
  // keeps the cache consistent with the visible UI through every
  // switching path R7.3 / R7.4 will exercise.
  const offRegistry = subscribeRegistry(() => {
    rereadSnapshot();
    cb();
  });
  const offActive = subscribeActiveAccount(() => {
    rereadSnapshot();
    cb();
  });
  return () => {
    offRegistry();
    offActive();
  };
}

function useRegistrySnapshot(): RegistrySnapshot {
  return useSyncExternalStore(snapshotSubscribe, snapshotGetter, snapshotGetter);
}

/** Display label for a registry entry. `display_name` is written
 *  asynchronously by `App.tsx` after each account becomes active and
 *  its profile hydrates from entity-sync (nickname → username). Falls
 *  back to user-set alias, then to a `User #<id>` placeholder for
 *  entries that have never been active in this browser. */
function accountDisplayName(entry: AccountEntry): string {
  const persisted = entry.display_name?.trim();
  if (persisted !== undefined && persisted !== '') return persisted;
  const alias = entry.alias?.trim();
  if (alias !== undefined && alias !== '') return alias;
  return `User #${entry.user_id}`;
}

export function AccountSwitcher({
  activeAccountKey,
  onSelectAccount,
  onAddAccount,
  disabled = false,
  errorI18nKey = null,
  onDismissError,
}: AccountSwitcherProps) {
  const { t } = useTranslation();
  const snapshot = useRegistrySnapshot();
  // Prefer the React-state active key passed from App.tsx; fall
  // back to the seam if the parent hasn't published one yet (early
  // boot, before connectAccount completes).
  const activeKey = activeAccountKey ?? snapshot.active ?? getActiveAccountKey();
  const activeEntry =
    activeKey !== null
      ? snapshot.entries.find((e) => e.key === activeKey)
      : undefined;
  const triggerLabel =
    activeEntry !== undefined
      ? accountDisplayName(activeEntry.entry)
      : t('accounts.switcher_unknown');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          aria-label={t('accounts.switcher_aria')}
          data-testid="account-switcher-trigger"
          data-switching={disabled ? '1' : '0'}
          disabled={disabled}
        >
          <Users className="h-4 w-4" />
          <span className="hidden sm:inline text-xs font-normal">
            {triggerLabel}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[220px]"
        data-testid="account-switcher-menu"
      >
        <DropdownMenuLabel>{t('accounts.switcher_title')}</DropdownMenuLabel>
        {errorI18nKey !== null && (
          <div
            data-testid="account-switcher-error"
            className="mx-1 mb-1 flex items-start gap-2 rounded-sm border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive"
          >
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="flex-1 leading-tight">
              {t(`accounts.${errorI18nKey}`)}
            </span>
            {onDismissError !== undefined && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismissError();
                }}
                aria-label={t('accounts.cancel_add')}
                className="shrink-0 rounded-sm p-0.5 hover:bg-destructive/20"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
        <DropdownMenuSeparator />
        {snapshot.entries.length === 0 ? (
          <DropdownMenuItem disabled>
            <span className="text-xs text-muted-foreground">
              {t('accounts.no_accounts')}
            </span>
          </DropdownMenuItem>
        ) : (
          snapshot.entries.map(({ key, entry }) => {
            const isActive = key === activeKey;
            return (
              <DropdownMenuItem
                key={key}
                data-testid="account-switcher-entry"
                data-account-key={key}
                data-account-active={isActive ? '1' : '0'}
                onSelect={() => {
                  if (!isActive) onSelectAccount(key);
                }}
                className={cn(
                  'flex items-center justify-between gap-2',
                  isActive && 'bg-accent/40',
                )}
              >
                <span className="flex flex-col min-w-0">
                  <span className="truncate text-sm">
                    {accountDisplayName(entry)}
                  </span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    #{entry.user_id}
                  </span>
                </span>
                {isActive && <Check className="h-4 w-4 shrink-0" />}
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="account-switcher-add"
          onSelect={() => onAddAccount()}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          <span className="text-sm">{t('accounts.add_account')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
