// In-memory ring buffer of recent console output. Installed once at
// module load time by patching `console.{log,warn,error,debug,info}`
// — every call gets recorded AND forwarded to the original method
// (transparency: devtools console keeps working). Bounded to
// `MAX_ENTRIES` so a noisy session can't OOM the page.
//
// Subscribe via `subscribeLogs(cb)` — callbacks fire on every new
// entry. Used by the in-app logs window so dogfooding without devtools
// open (mobile Safari, etc) still has something to look at.
//
// R7.1 — each entry is tagged with the current active account
// (`accountKey`) at capture time. Today the value is always the
// legacy-default sentinel; multi-account dogfood (R7.3+) lets the
// log filter / triage by account.

import { getActiveAccountKey } from '@/lib/active-account';
import type { AccountKey } from '@/lib/account-key';

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  /** Best-effort string serialisation of the original args list. */
  text: string;
  /** Active-account tag at capture time. R7.1 reserves the field
   *  so consumers (logs dialog filters, exporters) can split the
   *  buffer without a future migration. */
  accountKey: AccountKey;
}

const MAX_ENTRIES = 1000;
const buffer: LogEntry[] = [];
const listeners = new Set<(entries: LogEntry[]) => void>();
let installed = false;

function record(level: LogLevel, args: unknown[]): void {
  const text = args
    .map((a) => {
      if (a instanceof Error) return a.stack ?? a.message;
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
  const entry: LogEntry = {
    ts: Date.now(),
    level,
    text,
    accountKey: getActiveAccountKey(),
  };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
  for (const l of listeners) l(buffer);
}

function installOnce(): void {
  if (installed) return;
  installed = true;
  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };
  console.log = (...args: unknown[]) => {
    record('log', args);
    orig.log(...args);
  };
  console.info = (...args: unknown[]) => {
    record('info', args);
    orig.info(...args);
  };
  console.warn = (...args: unknown[]) => {
    record('warn', args);
    orig.warn(...args);
  };
  console.error = (...args: unknown[]) => {
    record('error', args);
    orig.error(...args);
  };
  console.debug = (...args: unknown[]) => {
    record('debug', args);
    orig.debug(...args);
  };
}

// Auto-install at module load — apps just import for its side effect.
if (typeof window !== 'undefined') installOnce();

export function getLogs(): LogEntry[] {
  return [...buffer];
}

export function clearLogs(): void {
  buffer.length = 0;
  for (const l of listeners) l(buffer);
}

export function subscribeLogs(cb: (entries: LogEntry[]) => void): () => void {
  listeners.add(cb);
  cb(buffer);
  return () => {
    listeners.delete(cb);
  };
}
