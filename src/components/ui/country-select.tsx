// Country dial-code picker for the login phone form.
//
// Telegram-style minimum: trigger button shows `<flag> <name>`, click
// opens a scrollable list keyed off the curated `COUNTRIES` catalog.
// Each row shows the flag, full name, and dial code right-aligned.
//
// Searchable: a single input at the top filters on country name (case-
// insensitive substring) AND dial code (with or without leading `+`).
// Search is local (~30 entries) — no debounce, no fuzzy. Pressing
// Enter on a filtered list selects the first remaining row.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { COUNTRIES, type CountryEntry } from '@/lib/country-codes';

export interface CountrySelectProps {
  value: CountryEntry;
  onChange: (next: CountryEntry) => void;
  disabled?: boolean;
  'data-testid'?: string;
}

export function CountrySelect({
  value,
  onChange,
  disabled,
  'data-testid': testId,
}: CountrySelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on outside click + on Escape, focus search on open.
  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    // Defer so the input is in the DOM.
    queueMicrotask(() => searchRef.current?.focus());
    const onDocPointerDown = (e: PointerEvent) => {
      const root = containerRef.current;
      if (root !== null && !root.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = useMemo<ReadonlyArray<CountryEntry>>(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return COUNTRIES;
    const qDigits = q.replace(/[^0-9]/g, '');
    return COUNTRIES.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      if (qDigits !== '' && c.dial.includes(qDigits)) return true;
      return false;
    });
  }, [query]);

  const select = (entry: CountryEntry) => {
    onChange(entry);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={testId ?? 'country-select-trigger'}
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm',
          'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <span className="flex items-center gap-2 truncate">
          <span className="text-lg leading-none" aria-hidden>
            {value.flag}
          </span>
          <span className="truncate">{value.name}</span>
        </span>
        <span className="flex items-center gap-2 text-muted-foreground">
          <span>+{value.dial}</span>
          <ChevronDown className="h-4 w-4" />
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          className={cn(
            'absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md',
            'flex flex-col',
          )}
          data-testid="country-select-popover"
        >
          <div className="border-b p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                className="pl-8"
                placeholder="Search country or +code"
                data-testid="country-select-search"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filtered.length > 0) {
                    e.preventDefault();
                    select(filtered[0]!);
                  }
                }}
              />
            </div>
          </div>
          <ul className="flex-1 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                No matches
              </li>
            ) : (
              filtered.map((c) => {
                const isActive = c.code === value.code;
                return (
                  <li key={c.code}>
                    <button
                      type="button"
                      onClick={() => select(c)}
                      role="option"
                      aria-selected={isActive}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-sm px-3 py-2 text-sm',
                        'hover:bg-accent hover:text-accent-foreground',
                        isActive && 'bg-accent/50',
                      )}
                      data-testid={`country-select-item-${c.code}`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <span className="text-lg leading-none" aria-hidden>
                          {c.flag}
                        </span>
                        <span className="truncate">{c.name}</span>
                      </span>
                      <span className="text-muted-foreground">+{c.dial}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
