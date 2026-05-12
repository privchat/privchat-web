// Avatar — first-letter placeholder with a hue derived from the seed.
//
// Real avatar URLs land in a later phase; for now we render a colored
// circle with the first character of the label (or seed). Two avatars
// for the SAME seed always look the same; different seeds get visibly
// different hues so eyes can scan a list quickly.

import { cn } from '@/lib/utils';

export interface AvatarProps {
  /** Identity used to derive the hue. Pick something stable per entity
   *  (e.g. "u:500" for user 500, "g:42" for group 42). */
  seed: string;
  /** Display label — first non-whitespace character is used as the
   *  glyph. Falls back to the first char of the seed if empty. */
  label?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLS: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-xl',
};

export function Avatar({ seed, label, size = 'md', className }: AvatarProps) {
  const glyph = pickGlyph(label ?? seed);
  const hue = hashHue(seed);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white shadow-sm',
        SIZE_CLS[size],
        className,
      )}
      style={{ backgroundColor: `hsl(${hue} 60% 50%)` }}
      aria-hidden="true"
    >
      {glyph}
    </span>
  );
}

function pickGlyph(s: string): string {
  const trimmed = s.trim();
  if (trimmed === '') return '?';
  // Use Array.from so emoji / surrogate pairs / wide CJK render as one glyph.
  const first = Array.from(trimmed)[0] ?? '?';
  return first.toUpperCase();
}

function hashHue(seed: string): number {
  // Deterministic FNV-1a 32-bit hash → mapped to 0..359.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h) % 360;
}
