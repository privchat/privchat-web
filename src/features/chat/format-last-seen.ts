// Human-readable "last seen" formatter. Server emits `last_seen_at` as a
// unix-seconds timestamp on `PresenceStatusItem`. We bucket the elapsed
// duration into rough rungs: just-now, minutes, hours, days, then a
// month-day fallback for anything older. Locale-aware: uses i18n
// templates passed in by the caller (so the same logic powers en, zh,
// vi). Caller decides whether to render (e.g. only for direct chats).
//
// Server occasionally hands out 0 or values in milliseconds when bugs
// land; we sniff and normalise to seconds so we never display "53 years
// ago" or "in the future".

export interface LastSeenI18n {
  online: string;
  offline: string;
  /** "刚刚" / "just now" — used for elapsed < 60s */
  just_now: string;
  /** Template for "X 分钟前". Receives the count (>=1). */
  minutes_ago: (n: number) => string;
  hours_ago: (n: number) => string;
  days_ago: (n: number) => string;
  /** Used when older than ~30 days; receives a localised date string. */
  long_ago: (date: string) => string;
}

export interface PresenceLike {
  is_online: boolean;
  /** Unix seconds (per server contract). */
  last_seen_at: number;
}

export function formatPresenceLine(
  presence: PresenceLike | undefined,
  i18n: LastSeenI18n,
  now: Date = new Date(),
): string | undefined {
  if (presence === undefined) return undefined;
  if (presence.is_online) return i18n.online;
  if (presence.last_seen_at <= 0) return i18n.offline;

  // Server's contract is unix seconds, but defensive normalisation: if
  // the value looks like ms (>= year 2200 in seconds, ~7e9), treat as ms.
  const seconds =
    presence.last_seen_at > 7e9
      ? Math.floor(presence.last_seen_at / 1000)
      : presence.last_seen_at;
  const lastSeenMs = seconds * 1000;
  const elapsedMs = now.getTime() - lastSeenMs;

  // Future timestamps (clock skew) collapse to "just now".
  if (elapsedMs < 60_000) return i18n.just_now;
  if (elapsedMs < 60 * 60_000) {
    return i18n.minutes_ago(Math.floor(elapsedMs / 60_000));
  }
  if (elapsedMs < 24 * 60 * 60_000) {
    return i18n.hours_ago(Math.floor(elapsedMs / (60 * 60_000)));
  }
  if (elapsedMs < 30 * 24 * 60 * 60_000) {
    return i18n.days_ago(Math.floor(elapsedMs / (24 * 60 * 60_000)));
  }
  return i18n.long_ago(
    new Date(lastSeenMs).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }),
  );
}
