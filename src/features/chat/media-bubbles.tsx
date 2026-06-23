// Media bubble renderers for the rich content types. Selected in
// `MessageRow` based on `vm.content_type` + `vm.metadata`. Each
// component owns a small amount of UX (image click to fullscreen,
// file download chip, etc).
//
// `pickMediaBubble` is the single dispatch point and never returns
// the raw `vm.content` — text is the only case it returns null for.
// All other recognized types render their typed bubble; unrecognized
// or malformed metadata renders an `UnsupportedBubble` placeholder
// instead of an empty / cryptic text bubble.

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Download,
  ExternalLink,
  FileText,
  ImageIcon,
  Link as LinkIcon,
  Loader2,
  MapPin,
  Pause,
  Play,
  Video as VideoIcon,
} from 'lucide-react';
import type {
  FileMetadataVM,
  ImageMetadataVM,
  LinkMetadataVM,
  LocationMetadataVM,
  MessageItemVM,
  StickerMetadataVM,
  VideoMetadataVM,
  VoiceMetadataVM,
} from '@privchat/react';
import { usePrivchatClient } from '@privchat/react';
import { cn } from '@/lib/utils';
import { toggle as togglePlayback } from './voice-playback';
import { useVoicePlayback } from './use-voice-playback';

// Max bubble dimensions in the timeline. Both axes are capped — width
// keeps panoramas from dominating the row, height keeps portraits
// (e.g. 9:16 phone photos) from pushing the rest of the timeline out
// of view. Click opens the original at full size in a modal.
const MAX_IMG_WIDTH = 280;
const MAX_IMG_HEIGHT = 360;

/**
 * 附件加密 v1：`file_id -> downloadAttachmentBlob（get_url + WebCrypto 解密）-> objectURL`。
 * 服务端存的是密文，不能 `img.src = file_url`。卸载 / file_id 变化时 revoke 防泄漏。
 * downloadAttachmentBlob 对 v0 legacy 明文也透明（直接 fetch 返回），故两类都走它。
 */
function useDecryptedAttachment(fileId: string | undefined): {
  url: string | undefined;
  loading: boolean;
  failed: boolean;
} {
  const adapter = usePrivchatClient();
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (fileId === undefined || fileId === '') return;
    let cancelled = false;
    let objectUrl: string | undefined;
    setLoading(true);
    setFailed(false);
    adapter
      .downloadAttachmentBlob(fileId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // 解密失败绝不退回密文 URL：宁可显示失败也不渲染坏图。
        setFailed(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
    };
  }, [adapter, fileId]);
  return { url, loading, failed };
}

export function ImageBubble({
  meta,
  isSelf,
}: {
  meta: ImageMetadataVM;
  isSelf: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dec = useDecryptedAttachment(meta.file_id);
  // 优先解密后的 objectURL；无 file_id 的极老消息退回 legacy 明文 url。
  const legacyUrl =
    (meta.file_id === undefined || meta.file_id === '') && meta.url !== undefined && meta.url !== ''
      ? meta.url
      : undefined;
  const src = dec.url ?? legacyUrl;
  if (src === undefined) {
    if (dec.failed) {
      return <FallbackBubble label="[图片·解密失败]" isSelf={isSelf} icon={AlertTriangle} />;
    }
    if (dec.loading || (meta.file_id !== undefined && meta.file_id !== '')) {
      return (
        <div
          className={cn(
            'flex items-center justify-center rounded-lg bg-muted',
            isSelf ? 'ml-auto' : 'mr-auto',
          )}
          style={{ width: 160, height: 200 }}
        >
          <Loader2 className="h-5 w-5 animate-spin opacity-60" />
        </div>
      );
    }
    return <FallbackBubble label="[图片]" isSelf={isSelf} icon={ImageIcon} />;
  }
  // Compute display dims by fitting the image's aspect ratio inside
  // the (MAX_W, MAX_H) box. If meta.width/height are both known,
  // pick the dimension that hits its cap first; otherwise fall back
  // to the box and rely on `object-cover` to crop tastefully. Don't
  // up-scale tiny images: a 100x100 thumbnail stays at 100x100.
  const knownDims = meta.width > 0 && meta.height > 0;
  const naturalW = knownDims ? meta.width : MAX_IMG_WIDTH;
  const naturalH = knownDims ? meta.height : MAX_IMG_HEIGHT;
  const scale = Math.min(
    1,
    MAX_IMG_WIDTH / naturalW,
    MAX_IMG_HEIGHT / naturalH,
  );
  const w = Math.round(naturalW * scale);
  const h = Math.round(naturalH * scale);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'overflow-hidden rounded-lg shrink-0 bg-muted',
          isSelf ? 'ml-auto' : 'mr-auto',
        )}
        style={{
          width: w,
          height: h,
          // CSS aspect-ratio reserves the box BEFORE the image decodes,
          // preventing the timeline below from jumping when lazy-loaded
          // images finish decoding off-screen and then pop in.
          aspectRatio: knownDims ? `${naturalW} / ${naturalH}` : undefined,
        }}
      >
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          width={w}
          height={h}
          className="h-full w-full object-cover"
        />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setOpen(false)}
        >
          <img
            src={src}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
        </div>
      )}
    </>
  );
}

export function FileBubble({
  meta,
  isSelf,
}: {
  meta: FileMetadataVM;
  isSelf: boolean;
}) {
  const adapter = usePrivchatClient();
  // 文件名/大小随消息 typed metadata 传输（file_name/file_size），直接展示，不再额外
  // 调 file/get_url 异步查（避免列表渲染闪烁 + 离线/历史拿不到名字）。
  const filename = meta.filename ?? meta.file_id;
  const size = meta.size;
  const [busy, setBusy] = useState(false);
  // 附件加密 v1：file_url 是密文，不能 <a href> 直下。点击时 file_id -> get_url + 解密
  // -> 明文 Blob -> objectURL -> 触发下载（用户主动导出明文）。
  const onDownload = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob =
        meta.file_id !== undefined && meta.file_id !== ''
          ? await adapter.downloadAttachmentBlob(meta.file_id)
          : meta.url !== undefined
            ? await (await fetch(meta.url)).blob()
            : undefined;
      if (blob === undefined) return;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 给浏览器一帧抓取下载流再 revoke。
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } finally {
      setBusy(false);
    }
  }, [adapter, busy, filename, meta.file_id, meta.url]);
  return (
    <button
      type="button"
      onClick={onDownload}
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2 text-sm max-w-[280px] text-left',
        isSelf ? 'ml-auto bg-primary text-primary-foreground' : 'mr-auto bg-muted',
      )}
    >
      <FileText className="h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate">{filename}</div>
        {size !== undefined && (
          <div
            className={cn(
              'text-[10px] opacity-80',
              isSelf ? 'text-primary-foreground' : 'text-muted-foreground',
            )}
          >
            {formatSize(size)}
          </div>
        )}
      </div>
      {busy ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-70" />
      ) : (
        <Download className="h-4 w-4 shrink-0 opacity-70" />
      )}
    </button>
  );
}

export function VoiceBubble({
  messageId,
  meta,
  isSelf,
}: {
  messageId: string;
  meta: VoiceMetadataVM;
  isSelf: boolean;
}) {
  const adapter = usePrivchatClient();
  const playback = useVoicePlayback(messageId);

  // Lazy URL: prefer the URL baked into the metadata (fast path when
  // the SDK already cached one); otherwise resolve via the adapter on
  // first tap. Avoid pre-fetching every voice URL on conversation
  // open — that's one HTTP per row, mostly wasted.
  const resolveUrl = useCallback(async () => {
    if (meta.url !== undefined && meta.url !== '') return meta.url;
    const resp = await adapter.fileGetUrl(meta.file_id);
    return resp.file_url;
  }, [adapter, meta.url, meta.file_id]);

  const playable =
    (meta.url !== undefined && meta.url !== '') ||
    (meta.file_id !== undefined && meta.file_id !== '');

  // Voice messages with no playable handle (no URL AND no file_id —
  // shouldn't normally happen but tolerate cross-version SDK records)
  // fall back to the placeholder chip with no [▶].
  if (!playable) {
    return <FallbackBubble label="[语音]" isSelf={isSelf} />;
  }

  const onClick = () => {
    void togglePlayback(messageId, resolveUrl);
  };

  const isLoading = playback?.status === 'loading';
  const isPlaying = playback?.status === 'playing';
  const isError = playback?.status === 'error';
  // Treat undefined / 0 metadata-duration as "unknown" until playback
  // loads the audio header. Media bubbles for old messages may not
  // carry a baked duration.
  const headerDurationMs =
    meta.duration > 0 ? Math.round(meta.duration * 1000) : 0;
  const liveDurationMs = playback?.durationMs ?? 0;
  const durationMs = liveDurationMs > 0 ? liveDurationMs : headerDurationMs;
  const showProgress = playback !== null && !isError;
  const currentMs = playback?.currentTimeMs ?? 0;

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="voice-bubble"
      data-message-id={messageId}
      data-state={playback?.status ?? 'idle'}
      aria-label={
        isPlaying ? 'Pause voice message' : 'Play voice message'
      }
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2 text-sm min-w-[120px] max-w-[280px]',
        isSelf
          ? 'ml-auto bg-primary text-primary-foreground'
          : 'mr-auto bg-muted',
      )}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      ) : isError ? (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      ) : isPlaying ? (
        <Pause className="h-4 w-4 shrink-0" />
      ) : (
        <Play className="h-4 w-4 shrink-0" />
      )}
      <span className="font-mono tabular-nums">
        {showProgress
          ? `${formatMs(currentMs)} / ${formatMs(durationMs)}`
          : durationMs > 0
            ? formatMs(durationMs)
            : '--:--'}
      </span>
      {isError && (
        <span className="ml-auto text-[10px] opacity-80">!</span>
      )}
    </button>
  );
}

function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ─────────── Video ────────────────────────────────────────────────

const MAX_VIDEO_WIDTH = 280;
const MAX_VIDEO_HEIGHT = 360;

export function VideoBubble({
  meta,
  isSelf,
}: {
  meta: VideoMetadataVM;
  isSelf: boolean;
}) {
  // 视频 v1：整文件加密，需下完整密文 → 解密 → Blob URL 才能播放（不能边下边播）。
  const dec = useDecryptedAttachment(meta.file_id);
  const legacyUrl =
    (meta.file_id === undefined || meta.file_id === '') && meta.url !== undefined && meta.url !== ''
      ? meta.url
      : undefined;
  const videoSrc = dec.url ?? legacyUrl;
  if (videoSrc === undefined) {
    if (dec.failed) return <FallbackBubble label="[视频·解密失败]" isSelf={isSelf} icon={AlertTriangle} />;
    if (dec.loading || (meta.file_id !== undefined && meta.file_id !== '')) {
      return (
        <div
          className={cn('flex items-center justify-center rounded-lg bg-black', isSelf ? 'ml-auto' : 'mr-auto')}
          style={{ width: 200, height: 200 }}
        >
          <Loader2 className="h-5 w-5 animate-spin text-white/70" />
        </div>
      );
    }
    return <FallbackBubble label="[视频]" isSelf={isSelf} icon={VideoIcon} />;
  }
  // Match ImageBubble's aspect-ratio fit so a 9:16 phone video doesn't
  // dominate the timeline. Use natural dims when known; otherwise fall
  // back to the bounding box and let object-cover handle layout.
  const knownDims = meta.width > 0 && meta.height > 0;
  const naturalW = knownDims ? meta.width : MAX_VIDEO_WIDTH;
  const naturalH = knownDims ? meta.height : MAX_VIDEO_HEIGHT;
  const scale = Math.min(
    1,
    MAX_VIDEO_WIDTH / naturalW,
    MAX_VIDEO_HEIGHT / naturalH,
  );
  const w = Math.round(naturalW * scale);
  const h = Math.round(naturalH * scale);
  // Native <video> controls give playback / volume / fullscreen for
  // free — building a custom player here would just duplicate browser
  // chrome. `preload="metadata"` keeps cold scroll cheap (no body
  // download on mount) but still surfaces the poster frame.
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg shrink-0 bg-black',
        isSelf ? 'ml-auto' : 'mr-auto',
      )}
      style={{
        width: w,
        height: h,
        aspectRatio: knownDims ? `${naturalW} / ${naturalH}` : undefined,
      }}
    >
      <video
        src={videoSrc}
        poster={meta.thumbnail_url}
        controls
        preload="metadata"
        playsInline
        className="h-full w-full object-cover bg-black"
      />
    </div>
  );
}

// ─────────── Sticker ──────────────────────────────────────────────

const STICKER_SIZE = 140;

export function StickerBubble({
  meta,
  isSelf,
}: {
  meta: StickerMetadataVM;
  isSelf: boolean;
}) {
  // Stickers render WITHOUT a chat-bubble background — they ARE the
  // message visually, like Telegram / WhatsApp / iMessage. The
  // `transparent` BG also makes PNGs with transparency look right.
  return (
    <img
      src={meta.image_url}
      alt={`sticker:${meta.sticker_id}`}
      width={STICKER_SIZE}
      height={STICKER_SIZE}
      loading="lazy"
      decoding="async"
      className={cn(
        'rounded-md shrink-0 object-contain',
        isSelf ? 'ml-auto' : 'mr-auto',
      )}
      style={{ width: STICKER_SIZE, height: STICKER_SIZE }}
    />
  );
}

// ─────────── Location ─────────────────────────────────────────────

export function LocationBubble({
  meta,
  isSelf,
}: {
  meta: LocationMetadataVM;
  isSelf: boolean;
}) {
  // Minimum-viable: show coords + a tap target that opens the platform
  // map app. Embedding a real map (Leaflet / Mapbox) adds 100+ KB and
  // brings a tiles-API dependency — not worth it for a row that
  // someone glances at once. Two decimal places ≈ 1.1 km precision,
  // which keeps the chip narrow; the maps deep-link uses full
  // precision so accuracy isn't lost.
  const href = `https://www.google.com/maps?q=${meta.latitude},${meta.longitude}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2 text-sm max-w-[280px]',
        'transition-colors',
        isSelf
          ? 'ml-auto bg-primary text-primary-foreground hover:bg-primary/90'
          : 'mr-auto bg-muted hover:bg-muted/80',
      )}
    >
      <MapPin className="h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">位置</div>
        <div
          className={cn(
            'text-[10px] opacity-80 font-mono tabular-nums',
            isSelf ? 'text-primary-foreground' : 'text-muted-foreground',
          )}
        >
          {meta.latitude.toFixed(4)}, {meta.longitude.toFixed(4)}
        </div>
      </div>
      <ExternalLink className="h-4 w-4 shrink-0 opacity-70" />
    </a>
  );
}

// ─────────── Link preview ─────────────────────────────────────────

export function LinkBubble({
  meta,
  isSelf,
}: {
  meta: LinkMetadataVM;
  isSelf: boolean;
}) {
  // Defensive hostname display — `new URL` throws on malformed values
  // (e.g. `not a url`), in which case we just show the raw string.
  let host: string;
  try {
    host = new URL(meta.url).hostname;
  } catch {
    host = meta.url;
  }
  return (
    <a
      href={meta.url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'flex max-w-[320px] flex-col overflow-hidden rounded-lg text-sm transition-colors',
        isSelf
          ? 'ml-auto bg-primary text-primary-foreground hover:bg-primary/90'
          : 'mr-auto bg-muted hover:bg-muted/80',
      )}
    >
      {meta.thumbnail_url !== undefined && meta.thumbnail_url !== '' && (
        <img
          src={meta.thumbnail_url}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-32 w-full object-cover"
        />
      )}
      <div className="flex flex-col gap-1 px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] opacity-80">
          <LinkIcon className="h-3 w-3 shrink-0" />
          <span className="truncate">{host}</span>
        </div>
        {meta.title !== undefined && meta.title !== '' && (
          <div className="line-clamp-2 font-medium">{meta.title}</div>
        )}
        {meta.description !== undefined && meta.description !== '' && (
          <div
            className={cn(
              'line-clamp-2 text-xs',
              isSelf ? 'text-primary-foreground/80' : 'text-muted-foreground',
            )}
          >
            {meta.description}
          </div>
        )}
      </div>
    </a>
  );
}

// ─────────── Fallbacks ────────────────────────────────────────────

export function FallbackBubble({
  label,
  isSelf,
  icon: Icon,
}: {
  label: string;
  isSelf: boolean;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
        isSelf ? 'ml-auto bg-primary text-primary-foreground' : 'mr-auto bg-muted',
      )}
    >
      {Icon !== undefined && <Icon className="h-4 w-4" />}
      <span>{label}</span>
    </div>
  );
}

/**
 * Catch-all bubble for `content_type` values the web client doesn't
 * specifically render (`forward`, `contact_card`, unknown future
 * types). Shows a generic "unsupported" label instead of either
 * crashing or rendering an empty text bubble.
 *
 * Distinct from FallbackBubble (which assumes the type IS known but
 * metadata happened to be malformed and uses a type-specific label
 * like "[图片]"). This one acknowledges the type isn't handled at all.
 */
function UnsupportedBubble({ isSelf }: { isSelf: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2 text-sm italic',
        isSelf
          ? 'ml-auto bg-primary/80 text-primary-foreground'
          : 'mr-auto bg-muted text-muted-foreground',
      )}
    >
      <AlertTriangle className="h-4 w-4" />
      <span>该消息类型暂不支持</span>
    </div>
  );
}

/**
 * Decide which bubble renderer applies to a message.
 *
 * - Returns `null` ONLY for `text` (caller renders the default text
 *   bubble using `vm.content`).
 * - All recognized media types return their typed bubble.
 * - Unrecognized `content_type` (forward / contact_card / unknown /
 *   future additions) returns the `UnsupportedBubble` placeholder
 *   instead of falling through to a possibly-empty text bubble.
 */
export function pickMediaBubble(vm: MessageItemVM): React.ReactNode | null {
  if (vm.content_type === 'text') return null;
  if (vm.content_type === 'system') {
    // System rows fall through to text rendering for now; centered /
    // italic styling is a separate concern handled at MessageRow level
    // if/when it's needed. Returning null preserves existing behavior.
    return null;
  }
  if (vm.content_type === 'image' && vm.metadata?.type === 'image') {
    return <ImageBubble meta={vm.metadata} isSelf={vm.is_self} />;
  }
  if (vm.content_type === 'file' && vm.metadata?.type === 'file') {
    return <FileBubble meta={vm.metadata} isSelf={vm.is_self} />;
  }
  if (vm.content_type === 'voice' && vm.metadata?.type === 'voice') {
    return (
      <VoiceBubble
        messageId={vm.record_key}
        meta={vm.metadata}
        isSelf={vm.is_self}
      />
    );
  }
  if (vm.content_type === 'video' && vm.metadata?.type === 'video') {
    return <VideoBubble meta={vm.metadata} isSelf={vm.is_self} />;
  }
  if (vm.content_type === 'sticker' && vm.metadata?.type === 'sticker') {
    return <StickerBubble meta={vm.metadata} isSelf={vm.is_self} />;
  }
  if (vm.content_type === 'location' && vm.metadata?.type === 'location') {
    return <LocationBubble meta={vm.metadata} isSelf={vm.is_self} />;
  }
  if (vm.content_type === 'link' && vm.metadata?.type === 'link') {
    return <LinkBubble meta={vm.metadata} isSelf={vm.is_self} />;
  }
  // Recognized-but-metadata-mismatched (e.g. image content_type with no
  // metadata): show a type-labelled fallback chip rather than the
  // generic unsupported placeholder, so the user can tell what kind of
  // message it was.
  if (vm.content_type === 'image') {
    return <FallbackBubble label="[图片]" isSelf={vm.is_self} icon={ImageIcon} />;
  }
  if (vm.content_type === 'file') {
    return <FallbackBubble label="[文件]" isSelf={vm.is_self} icon={FileText} />;
  }
  if (vm.content_type === 'voice') {
    return <FallbackBubble label="[语音]" isSelf={vm.is_self} />;
  }
  if (vm.content_type === 'video') {
    return <FallbackBubble label="[视频]" isSelf={vm.is_self} icon={VideoIcon} />;
  }
  if (vm.content_type === 'sticker') {
    return <FallbackBubble label="[表情]" isSelf={vm.is_self} />;
  }
  if (vm.content_type === 'location') {
    return <FallbackBubble label="[位置]" isSelf={vm.is_self} icon={MapPin} />;
  }
  if (vm.content_type === 'link') {
    return <FallbackBubble label="[链接]" isSelf={vm.is_self} icon={LinkIcon} />;
  }
  // forward / contact_card / unknown — show the generic placeholder.
  return <UnsupportedBubble isSelf={vm.is_self} />;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
