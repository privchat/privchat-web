// Media bubble renderers for image / file / voice / video. Selected
// in `MessageRow` based on `vm.content_type` + `vm.metadata`. Each
// component owns a small amount of UX (image click to fullscreen,
// file download chip, etc) and falls through to a plain text bubble
// when metadata is missing or malformed (cross-version safety).

import { useCallback, useState } from 'react';
import {
  AlertTriangle,
  Download,
  FileText,
  ImageIcon,
  Loader2,
  Pause,
  Play,
} from 'lucide-react';
import type {
  FileMetadataVM,
  ImageMetadataVM,
  MessageItemVM,
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

export function ImageBubble({
  meta,
  isSelf,
}: {
  meta: ImageMetadataVM;
  isSelf: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (meta.url === undefined || meta.url === '') {
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
          src={meta.url}
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
            src={meta.url}
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
  const filename = meta.filename ?? meta.file_id;
  return (
    <a
      href={meta.url ?? '#'}
      download={filename}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2 text-sm max-w-[280px]',
        isSelf ? 'ml-auto bg-primary text-primary-foreground' : 'mr-auto bg-muted',
      )}
    >
      <FileText className="h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate">{filename}</div>
        {meta.size !== undefined && (
          <div
            className={cn(
              'text-[10px] opacity-80',
              isSelf ? 'text-primary-foreground' : 'text-muted-foreground',
            )}
          >
            {formatSize(meta.size)}
          </div>
        )}
      </div>
      {meta.url !== undefined && <Download className="h-4 w-4 shrink-0 opacity-70" />}
    </a>
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

/** Decide which bubble renderer applies to a message. Returns
 *  `null` when the row is plain text (caller renders the default
 *  text bubble). */
export function pickMediaBubble(vm: MessageItemVM): React.ReactNode | null {
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
  return null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
