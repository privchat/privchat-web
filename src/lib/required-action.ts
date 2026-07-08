// R8.4b — Post-login Required Action shapes + decoding helpers.
//
// See `docs/PLATFORM_REQUIRED_ACTIONS_CONTRACT.md` §4 for full contract.
// Key wire-defense rules implemented here:
//
//   - Open `interface` (not discriminated union) so unknown action types
//     parse without throwing — they're handled at the dispatch layer.
//   - `required` defaults to `true` when missing (fail-closed).
//   - `actionTitle()` resolves titleKey → title → action fallback chain;
//     `action` is the ONLY field allowed for business-logic dispatch.
//
// v1 only handles `complete_profile`. Other action types are reserved
// in the type doc for forward compatibility; R8.5+ will add them.

export interface RequiredAction {
  /** Stable machine name. ONLY field used for dispatch. v1 known
   *  value: `"complete_profile"`. */
  action: string;
  /** Missing / null on wire → treat as `true` (fail-closed default). */
  required?: boolean;
  /** UI-only. Display text from server (defaults to zh-CN). */
  title?: string;
  /** UI-only. i18n lookup key for localized rendering. */
  titleKey?: string;
  /** For `complete_profile`. v1 only includes `"nickname"`. */
  fields?: string[];
  /** For `accept_terms`. */
  version?: string;
  /** For `acknowledge_notice`. */
  noticeId?: string;
  /** For `bind_mobile` / `reset_password` / etc. */
  reason?: string;
  /** Forward-compat catch-all for fields we don't model yet. */
  [extra: string]: unknown;
}

/** v1 known action types this client knows how to handle. R8.5+ extends. */
const HANDLABLE_ACTIONS = new Set<string>(['complete_profile', 'bind_invite_code']);

/** True iff this build can dispatch to a concrete handler component. */
export function isHandlableAction(action: string): boolean {
  return HANDLABLE_ACTIONS.has(action);
}

/** Wire-defense: missing/null → true. Required actions an unknown handler
 *  can't process must NOT silently slip past the gate (§4.3). */
export function isRequired(a: RequiredAction): boolean {
  return a.required ?? true;
}

/** Resolve a user-readable label for the action.
 *
 *  Priority: i18n via titleKey → server-provided title → action machine
 *  name. The machine-name fallback ensures the UI never renders blank,
 *  even when both `title` and `titleKey` are missing (defensive against
 *  malformed server payloads).
 *
 *  `t` matches react-i18next's signature: when no translation is found,
 *  i18next returns the key unchanged. We detect that case to fall back. */
export function actionTitle(
  a: RequiredAction,
  t: (key: string) => string,
): string {
  if (typeof a.titleKey === 'string' && a.titleKey !== '') {
    const translated = t(a.titleKey);
    // i18next missing-key behaviour: returns the key itself.
    if (translated !== a.titleKey) return translated;
  }
  if (typeof a.title === 'string' && a.title !== '') return a.title;
  return a.action;
}
