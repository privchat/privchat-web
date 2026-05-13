// Segmented one-time-password input.
//
// Telegram-style: one box per digit, auto-focus advances on input,
// Backspace returns focus to the previous box, paste distributes
// digits across boxes, and `onComplete` fires the moment every box
// has a digit. Numeric-only by design — `inputMode="numeric"` opens
// the mobile number pad; non-digit keys are rejected at the keystroke.
//
// The component is fully controlled: the parent owns the full string
// (`value` prop), and `onChange` reports the joined digits. Per-box
// state is internal to keep the parent API a single string.

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  forwardRef,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { cn } from '@/lib/utils';

export interface OtpInputProps {
  /** Current value — a string of 0..length digits. Anything non-numeric
   *  in the prop is silently coerced (consumer can rely on what gets
   *  reported via `onChange` to be clean). */
  value: string;
  /** Reports the joined digit string after each keystroke / paste. */
  onChange: (next: string) => void;
  /** Box count. Default 6. */
  length?: number;
  /** Disable all boxes (e.g. while the submit RPC is in flight). */
  disabled?: boolean;
  /** Fired exactly when `value.length === length` and all digits filled.
   *  Re-fires if the user clears + re-fills (each completion cycle is
   *  independent). */
  onComplete?: (code: string) => void;
  /** Stable test handle for the wrapper; individual boxes are also
   *  marked with `data-testid="<prefix>-<index>"`. */
  'data-testid'?: string;
  /** Focus the first box on mount. Default true. */
  autoFocus?: boolean;
}

export interface OtpInputHandle {
  /** Imperative focus for callers that own a ref (e.g. autofocus
   *  after a step transition). */
  focus: () => void;
  /** Imperative clear — sets value to "" and refocuses first box.
   *  Convenience for "wrong code" resets. */
  clear: () => void;
}

function sanitize(input: string, max: number): string {
  // Keep only digits; cap at `max`. Strings of any source (manual type,
  // paste, autofill) go through this single funnel.
  return input.replace(/[^0-9]/g, '').slice(0, max);
}

export const OtpInput = forwardRef<OtpInputHandle, OtpInputProps>(
  function OtpInput(
    {
      value,
      onChange,
      length = 6,
      disabled,
      onComplete,
      'data-testid': testId,
      autoFocus = true,
    },
    ref,
  ) {
    const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
    // We need a stable ref to the last completion value so we don't
    // re-fire onComplete on every re-render when the value happens
    // to already be full. It re-fires only when transitioning into
    // "full" again (i.e. went non-full at least once).
    const lastFiredRef = useRef<string | null>(null);

    // Normalize value just for rendering — the *source* of truth stays
    // the parent's `value`. If the parent passes "1a2", we render "12".
    const digits = useMemo(() => {
      const sane = sanitize(value, length);
      return Array.from({ length }, (_, i) => sane[i] ?? '');
    }, [value, length]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => inputsRef.current[0]?.focus(),
        clear: () => {
          onChange('');
          lastFiredRef.current = null;
          inputsRef.current[0]?.focus();
        },
      }),
      [onChange],
    );

    useEffect(() => {
      if (autoFocus) inputsRef.current[0]?.focus();
      // autoFocus only meaningful at mount; don't re-fire on re-render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Completion edge-trigger. Fires when value transitions to full.
    useEffect(() => {
      const sane = sanitize(value, length);
      if (sane.length === length) {
        if (lastFiredRef.current !== sane && onComplete !== undefined) {
          lastFiredRef.current = sane;
          onComplete(sane);
        }
      } else {
        // Not full anymore — re-arm so the next completion fires.
        lastFiredRef.current = null;
      }
    }, [value, length, onComplete]);

    const writeAt = useCallback(
      (index: number, ch: string, advance: boolean) => {
        const sane = sanitize(value, length);
        const arr = Array.from({ length }, (_, i) => sane[i] ?? '');
        arr[index] = ch;
        const next = arr.join('').replace(/[^0-9]/g, '');
        onChange(next);
        if (advance && ch !== '' && index < length - 1) {
          // Defer focus to the next paint so the parent's controlled
          // re-render lands first (otherwise we focus an input the
          // browser may still be repainting).
          queueMicrotask(() => inputsRef.current[index + 1]?.focus());
        }
      },
      [value, length, onChange],
    );

    const handleKeyDown = (
      index: number,
      e: KeyboardEvent<HTMLInputElement>,
    ) => {
      if (e.key === 'Backspace') {
        if (digits[index] !== '') {
          // Clear current box; stay focused.
          e.preventDefault();
          writeAt(index, '', false);
          return;
        }
        // Empty: jump back and clear previous.
        if (index > 0) {
          e.preventDefault();
          writeAt(index - 1, '', false);
          queueMicrotask(() => inputsRef.current[index - 1]?.focus());
        }
        return;
      }
      if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        inputsRef.current[index - 1]?.focus();
        return;
      }
      if (e.key === 'ArrowRight' && index < length - 1) {
        e.preventDefault();
        inputsRef.current[index + 1]?.focus();
        return;
      }
    };

    const handleChange = (
      index: number,
      newValue: string,
    ) => {
      // Browsers can fire `onChange` with a multi-char value when the
      // user uses autofill (iOS SMS OTP suggestion) — handle that
      // identically to a paste.
      const sane = sanitize(newValue, length);
      if (sane.length <= 1) {
        writeAt(index, sane, true);
        return;
      }
      // Distribute starting at the current index.
      const merged = sanitize(value, length).slice(0, index) + sane;
      const trimmed = sanitize(merged, length);
      onChange(trimmed);
      const focusTarget = Math.min(trimmed.length, length - 1);
      queueMicrotask(() => inputsRef.current[focusTarget]?.focus());
    };

    const handlePaste = (
      index: number,
      e: ClipboardEvent<HTMLInputElement>,
    ) => {
      const text = e.clipboardData.getData('text');
      if (text === '') return;
      e.preventDefault();
      const sane = sanitize(text, length);
      const merged = sanitize(value, length).slice(0, index) + sane;
      const trimmed = sanitize(merged, length);
      onChange(trimmed);
      const focusTarget = Math.min(trimmed.length, length - 1);
      queueMicrotask(() => inputsRef.current[focusTarget]?.focus());
    };

    return (
      <div
        className="flex items-center justify-center gap-2"
        data-testid={testId ?? 'otp-input'}
      >
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              inputsRef.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            // `one-time-code` opens the iOS SMS autofill suggestion bar.
            // Browsers that don't know it ignore it.
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={length /* allow paste; we sanitize anyway */}
            value={d}
            disabled={disabled}
            data-testid={`${testId ?? 'otp-input'}-${i}`}
            aria-label={`Digit ${i + 1} of ${length}`}
            className={cn(
              'h-12 w-10 rounded-md border border-input bg-background text-center text-lg font-medium',
              'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
            onChange={(e) => handleChange(i, e.currentTarget.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={(e) => handlePaste(i, e)}
            onFocus={(e) => e.currentTarget.select()}
          />
        ))}
      </div>
    );
  },
);
