// Avatar — first-letter placeholder with a hue derived from the seed.
//
// Renders `src` as an <img> when provided (falling back to the colored
// circle on load failure). Otherwise we render a colored circle with the
// first character of the label (or seed). Two avatars for the SAME seed
// always look the same; different seeds get visibly different hues so
// eyes can scan a list quickly.

import { useState } from 'react';
import { cn } from '@/lib/utils';

export interface AvatarProps {
  /** Identity used to derive the hue. Pick something stable per entity
   *  (e.g. "u:500" for user 500, "g:42" for group 42). */
  seed: string;
  /** Display label — first non-whitespace character is used as the
   *  glyph. Falls back to the first char of the seed if empty. */
  label?: string;
  /** 头像图片地址；加载失败时回退到色块首字。 */
  src?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLS: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-xl',
};

export function Avatar({ seed, label, src, size = 'md', className }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  if (typeof src === 'string' && src !== '' && !imgFailed) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setImgFailed(true)}
        className={cn(
          'inline-block shrink-0 select-none rounded-[22%] object-cover shadow-sm',
          SIZE_CLS[size],
          className,
        )}
        aria-hidden="true"
      />
    );
  }
  const glyph = pickGlyph(label ?? seed);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-[22%] font-semibold text-white shadow-sm',
        SIZE_CLS[size],
        className,
      )}
      style={{ backgroundColor: avatarBgColor(seed) }}
      aria-hidden="true"
    >
      {glyph}
    </span>
  );
}

export function pickGlyph(s: string): string {
  const trimmed = s.trim();
  if (trimmed === '') return '?';
  // Use Array.from so emoji / surrogate pairs / wide CJK render as one glyph.
  const first = Array.from(trimmed)[0] ?? '?';
  return first.toUpperCase();
}

const utf8 = new TextEncoder();

/**
 * The single source of truth for an avatar's placeholder background color.
 * Both the standalone [Avatar] and the group-collage member cells call
 * this so the SAME seed always yields the SAME color (三端统一：FNV-1a hue
 * + 62% 36% 白字). Seed convention: `u:{uid}` for users, `g:{id}` for groups.
 */
export function avatarBgColor(seed: string): string {
  return `hsl(${hashHue(seed)} 62% 36%)`;
}

export function hashHue(seed: string): number {
  // FNV-1a 32-bit over UTF-8 bytes → mapped to 0..359.
  // 三端统一算法（62% 36% 白字配套），参数勿改。
  const bytes = utf8.encode(seed);
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 360;
}
