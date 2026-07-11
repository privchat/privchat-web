// Avatar — first-letter placeholder with a hue derived from the seed.
//
// Renders `src` as an <img> when provided (falling back to the colored
// circle on load failure). Otherwise we render a colored circle with the
// first character of the label (or seed). Two avatars for the SAME seed
// always look the same; different seeds get visibly different hues so
// eyes can scan a list quickly.
//
// P4.2 local-first: when `userId` is provided the image source resolves
// through `useAvatarModel` — the Cache Storage copy is the display source
// of truth, the remote URL is only the download source, and a stale local
// copy keeps rendering while a background refresh runs. Without `userId`
// behavior is unchanged (plain `src`, remote-first) so group avatars and
// other non-user surfaces are unaffected.

import { useState } from 'react';
import { useAvatarModel } from '@privchat/react';
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
  /** P4.2:提供用户 uid 时走 local-first(useAvatarModel,缓存优先)。 */
  userId?: string;
  /** local-first 模式的远端下载源;缺省沿用 `src`。 */
  remoteUrl?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLS: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-xl',
};

export function Avatar({ seed, label, src, userId, remoteUrl, size = 'md', className }: AvatarProps) {
  // Track the exact URL that failed so a later source switch (e.g. the
  // local-first background refresh swapping remote → blob URL) retries
  // cleanly instead of being stuck on the initials fallback.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // Unconditional hook call (rules of hooks). With `userId` undefined the
  // hook resolves a pure fallback model and performs no caching work.
  const model = useAvatarModel({
    userId,
    remoteUrl: remoteUrl ?? src,
    displayName: label,
  });
  const resolvedSrc =
    userId !== undefined && userId !== ''
      ? (model.localUrl ?? model.remoteUrl ?? undefined)
      : src;
  if (typeof resolvedSrc === 'string' && resolvedSrc !== '' && failedSrc !== resolvedSrc) {
    return (
      <img
        src={resolvedSrc}
        alt=""
        onError={() => setFailedSrc(resolvedSrc)}
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
