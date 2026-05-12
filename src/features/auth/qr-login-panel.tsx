// R8.5c — QR login panel (PLATFORM-only).
//
// Drives the `startQrLogin()` session lifecycle inside a React 19
// component. The provider returns a `QrLoginSession` after the
// unauth WS connect + `qr_login/create_scene` RPC (see
// PLATFORM_QR_LOGIN_CONTRACT §3 / §5); this component subscribes to
// its 4-event stream and maps them onto the 8 UI states. Cleanup on
// unmount / regenerate / authorized cancels the session so the
// underlying WS doesn't leak.
//
// Authorized success calls `onLoggedIn(credentials, requiredActions)`
// in the same shape the SMS form uses, so App.tsx's onLoggedIn chain
// (persist → connect → authenticate → RequiredActionsGate) is
// reached unchanged.

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { getAuthProvider } from '@/lib/account-auth-provider';
import { getPlatformBaseUrl } from '@/lib/account-mode';
import { getLoginErrorMessage } from '@/lib/login-error-message';
import type { LoginResult } from '@/lib/account-auth-provider';
import type {
  QrLoginEvent,
  QrLoginScene,
  QrLoginSession,
} from '@/lib/platform-qr-login';
import type { RequiredAction } from '@/lib/required-action';
import type { PersistedSession } from '@/lib/session-storage';

// ─────────────────── 8-state UI machine ───────────────────

type QrUiState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'waiting'; scene: QrLoginScene; secondsLeft: number }
  | { kind: 'scanned'; scene: QrLoginScene }
  | { kind: 'authorizing'; scene: QrLoginScene }
  | { kind: 'rejected'; scene: QrLoginScene }
  | { kind: 'expired'; scene: QrLoginScene | null }
  | { kind: 'error'; message: string };

type QrUiAction =
  | { type: 'starting' }
  | { type: 'scene'; scene: QrLoginScene }
  | { type: 'event'; event: QrLoginEvent }
  | { type: 'tick'; secondsLeft: number }
  | { type: 'error'; message: string }
  | { type: 'reset' };

function reduce(state: QrUiState, action: QrUiAction): QrUiState {
  switch (action.type) {
    case 'starting':
      return { kind: 'creating' };
    case 'scene':
      return {
        kind: 'waiting',
        scene: action.scene,
        secondsLeft: action.scene.expiresInSeconds,
      };
    case 'tick': {
      if (state.kind !== 'waiting') return state;
      if (action.secondsLeft <= 0) {
        // Local TTL expired before any server push — surface as
        // expired so UI shows the regenerate button. The session's
        // own cleanup runs from the wrapping effect; reducer here
        // only manages UI shape.
        return { kind: 'expired', scene: state.scene };
      }
      return { ...state, secondsLeft: action.secondsLeft };
    }
    case 'event': {
      const e = action.event;
      // Once we're in a terminal client state, ignore stale pushes.
      if (
        state.kind === 'rejected' ||
        state.kind === 'expired' ||
        state.kind === 'error'
      ) {
        return state;
      }
      const scene =
        state.kind === 'waiting' || state.kind === 'scanned' || state.kind === 'authorizing'
          ? state.scene
          : null;
      switch (e.type) {
        case 'scanned':
          return scene !== null ? { kind: 'scanned', scene } : state;
        case 'rejected':
          return scene !== null ? { kind: 'rejected', scene } : state;
        case 'expired':
          return { kind: 'expired', scene };
        case 'authorized':
          // authorizing is a 1-frame transition; the wrapping effect
          // calls onLoggedIn immediately so the LoginPage unmounts
          // before any user-perceptible delay. We still set it for
          // tests / strict-mode re-renders that snapshot mid-frame.
          return scene !== null ? { kind: 'authorizing', scene } : state;
      }
      return state;
    }
    case 'error':
      return { kind: 'error', message: action.message };
    case 'reset':
      return { kind: 'idle' };
  }
}

// ─────────────────── Component ───────────────────

export interface QrLoginPanelProps {
  serverUrl: string;
  /** Matches the LoginPage `onLoggedIn` signature so the parent can
   *  hand a single thunk to both SMS and QR panels. */
  onLoggedIn: (
    credentials: Omit<PersistedSession, 'saved_at'>,
    requiredActions: RequiredAction[],
  ) => void;
  /** Bumped by the parent when switching to the QR tab so the
   *  effect restarts even if the panel was previously mounted (the
   *  parent keeps both panels mounted to preserve form state, so
   *  we can't rely on unmount/remount for restart). When unspecified,
   *  the effect runs once on mount. */
  sessionEpoch?: number;
}

export function QrLoginPanel({
  serverUrl,
  onLoggedIn,
  sessionEpoch,
}: QrLoginPanelProps) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(reduce, { kind: 'idle' } as QrUiState);
  const sessionRef = useRef<QrLoginSession | null>(null);
  const [regenerateNonce, setRegenerateNonce] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // ----- effect: start (and restart) the QR session -----
  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;

    dispatch({ type: 'starting' });

    void (async () => {
      try {
        const provider = await getAuthProvider();
        if (provider.startQrLogin === undefined) {
          // Capability gate: this panel should only be mounted when
          // `capabilities.qrLogin` is true. Surface a config error if
          // wired incorrectly so the bug is loud, not silent.
          dispatch({ type: 'error', message: t('login.error_config') });
          return;
        }
        const platformBaseUrl = getPlatformBaseUrl();
        if (platformBaseUrl === null) {
          dispatch({ type: 'error', message: t('login.error_config') });
          return;
        }
        const session = await provider.startQrLogin({
          serverUrl,
          platformBaseUrl,
          device: makeDevice(),
        });
        if (cancelled) {
          // Component unmounted (or epoch bumped) before the RPC
          // returned — dispose immediately so we don't leak a WS.
          await session.cancel();
          return;
        }
        sessionRef.current = session;
        dispatch({ type: 'scene', scene: session.scene });
        unsub = session.subscribe((event) => {
          if (cancelled) return;
          dispatch({ type: 'event', event });
          if (event.type === 'authorized') {
            // Authorized: hand credentials to the parent in the
            // SMS-equivalent shape; parent unmounts the LoginPage
            // and the cleanup function disposes the session.
            handleAuthorized(event.result, onLoggedIn);
          }
        });
      } catch (e) {
        if (cancelled) return;
        dispatch({
          type: 'error',
          message: getLoginErrorMessage(e, 'sms-login', t),
        });
      }
    })();

    return () => {
      cancelled = true;
      if (unsub !== null) unsub();
      const s = sessionRef.current;
      if (s !== null) {
        sessionRef.current = null;
        // Fire-and-forget — cleanup must not block re-renders, and
        // dispose() swallows internal errors.
        void s.cancel();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl, sessionEpoch, regenerateNonce]);

  // ----- effect: countdown while waiting -----
  useEffect(() => {
    if (state.kind !== 'waiting') return;
    if (state.secondsLeft <= 0) return;
    const id = setInterval(() => {
      dispatch({
        type: 'tick',
        secondsLeft: Math.max(0, state.secondsLeft - 1),
      });
    }, 1000);
    return () => clearInterval(id);
    // Re-arm whenever secondsLeft changes so we naturally tick down.
  }, [state]);

  // ----- effect: render QR canvas when waiting -----
  useEffect(() => {
    if (state.kind !== 'waiting') return;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    // QRCode.toCanvas is async — fire and forget. Errors are
    // benign rendering issues; we log to console and let the UI
    // show whatever blank canvas it has.
    QRCode.toCanvas(canvas, state.scene.qrPayload, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: 'M',
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[qr-login] canvas render failed', err);
    });
  }, [state]);

  const regenerate = useCallback(() => {
    // Drop the old session before kicking the effect — the cleanup
    // function inside the start effect will run again on re-arm.
    const old = sessionRef.current;
    sessionRef.current = null;
    if (old !== null) void old.cancel();
    setRegenerateNonce((n) => n + 1);
  }, []);

  // ─── Render ───────────────────────────────────────────────────
  return (
    <div className="space-y-4" data-testid="login-qr-panel">
      {state.kind === 'idle' || state.kind === 'creating' ? (
        <Centered>
          <p className="text-sm text-muted-foreground" data-testid="qr-status">
            {t('login.qr_loading')}
          </p>
        </Centered>
      ) : null}

      {state.kind === 'waiting' ? (
        <Centered>
          <h3 className="text-base font-medium">{t('login.qr_waiting_title')}</h3>
          <canvas
            ref={canvasRef}
            width={220}
            height={220}
            aria-label={t('login.qr_canvas_alt')}
            className="rounded-md border border-border bg-white p-2"
            data-testid="qr-canvas"
          />
          <p className="text-xs text-muted-foreground" data-testid="qr-status">
            {t('login.qr_waiting_subtitle')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('login.qr_expires_in', { seconds: state.secondsLeft })}
          </p>
        </Centered>
      ) : null}

      {state.kind === 'scanned' ? (
        <Centered>
          <h3 className="text-base font-medium">{t('login.qr_scanned_title')}</h3>
          <p className="text-sm text-muted-foreground" data-testid="qr-status">
            {t('login.qr_scanned_subtitle')}
          </p>
        </Centered>
      ) : null}

      {state.kind === 'authorizing' ? (
        <Centered>
          <p className="text-sm text-muted-foreground" data-testid="qr-status">
            {t('login.qr_authorizing')}
          </p>
        </Centered>
      ) : null}

      {state.kind === 'rejected' ? (
        <Centered>
          <h3 className="text-base font-medium">{t('login.qr_rejected_title')}</h3>
          <p className="text-sm text-muted-foreground" data-testid="qr-status">
            {t('login.qr_rejected_subtitle')}
          </p>
          <Button
            variant="default"
            onClick={regenerate}
            data-testid="qr-regenerate"
          >
            {t('login.qr_regenerate')}
          </Button>
        </Centered>
      ) : null}

      {state.kind === 'expired' ? (
        <Centered>
          <h3 className="text-base font-medium">{t('login.qr_expired_title')}</h3>
          <p className="text-sm text-muted-foreground" data-testid="qr-status">
            {t('login.qr_expired_subtitle')}
          </p>
          <Button
            variant="default"
            onClick={regenerate}
            data-testid="qr-regenerate"
          >
            {t('login.qr_regenerate')}
          </Button>
        </Centered>
      ) : null}

      {state.kind === 'error' ? (
        <Centered>
          <h3 className="text-base font-medium text-destructive">
            {t('login.qr_error_title')}
          </h3>
          <p className="text-sm text-destructive" data-testid="qr-status">
            {state.message}
          </p>
          <Button
            variant="default"
            onClick={regenerate}
            data-testid="qr-regenerate"
          >
            {t('login.qr_regenerate')}
          </Button>
        </Centered>
      ) : null}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-2">
      {children}
    </div>
  );
}

function handleAuthorized(
  result: LoginResult,
  onLoggedIn: QrLoginPanelProps['onLoggedIn'],
): void {
  onLoggedIn(
    {
      url: result.serverUrl,
      user_id: result.userId,
      access_token: result.accessToken,
      device_id: result.deviceId,
      account_mode: result.accountMode,
      ...(result.platformBaseUrl !== undefined
        ? { platform_base_url: result.platformBaseUrl }
        : {}),
      ...(result.refreshToken !== undefined
        ? { refresh_token: result.refreshToken }
        : {}),
    },
    result.requiredActions,
  );
}

function makeDevice(): {
  device_id: string;
  device_type: string;
  app_id: string;
  device_name: string;
  app_version: string;
} {
  return {
    device_id: pseudoUuidV4(),
    device_type: 'web',
    app_id: 'privchat-web',
    device_name: 'privchat-web',
    app_version: '0.0.0',
  };
}

function pseudoUuidV4(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
