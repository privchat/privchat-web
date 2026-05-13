// ConversationPanel — first-class headless-friendly chat surface.
//
// This component is the architectural commitment from R1: a single,
// self-contained conversation view that works in any context where the host
// already knows (channelId, channelType) — Telegram-style apps, customer
// support widgets, in-game chat, robot dialogs, etc. It does NOT depend on a
// channel list. Mounting it auto-opens the channel and wires the composer.
//
// Visual concerns (timeline rendering, virtualization, theming) live here in
// the web app — `@privchat/react` only ships hooks/VMs.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageIcon, Info, Paperclip, Video, X as XIcon } from 'lucide-react';
import {
  resolveConversationTitle,
  useChannelList,
  useConversation,
  useFriendship,
  useGroupProfile,
  usePresence,
  usePrivchatClient,
  useSendFile,
  useSendImage,
  useSendVideo,
  useTyping,
  useUserProfile,
} from '@privchat/react';
import type { MessageItemVM } from '@privchat/react';
import { stopAll as stopVoicePlayback } from './voice-playback';
import { useChannelUploads } from './use-channel-uploads';
import {
  markDone,
  markFailed,
  newTaskId,
  patchProgress,
  removeTask,
  startTask,
  type UploadTask,
} from './uploads-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useConversationTitleI18n } from './use-title-i18n';
import { ProfileCard } from './profile-card';
import { formatPresenceLine } from './format-last-seen';
import { useLastSeenI18n } from './use-presence-i18n';
import { useLazyMount } from '@/lib/use-lazy-mount';
import { MessageList } from './message-list';
import { BotMenuButton } from './bot-menu-button';

// Lazy-loaded — group info pulls roster data + admin actions, none
// of which is on the first-paint path. Only opens when the user
// taps the (i) button or the group title in the panel header.
const GroupInfoDialog = lazy(() =>
  import('./group-info-dialog').then((m) => ({
    default: m.GroupInfoDialog,
  })),
);

export interface ConversationPanelProps {
  channelId: string;
  channelType: number;
  /** Optional title for the panel header. */
  title?: string;
  /**
   * Optional back-navigation handler. When provided, a back button renders
   * in the panel header. Web layout uses this for H5's single-pane mode
   * to return to the list; PC layout omits it (keeps list always visible).
   */
  onBack?: () => void;
  className?: string;
}

export function ConversationPanel({
  channelId,
  channelType,
  title,
  onBack,
  className,
}: ConversationPanelProps) {
  const { t } = useTranslation();
  const titleI18n = useConversationTitleI18n();
  const {
    messages,
    pendingCount,
    reachedBeginning,
    isOpening,
    error,
    peerReadPts,
    loadOlder,
    send,
  } = useConversation(channelId, channelType);

  // Look up the underlying ChannelRecord so the resolver has the full
  // shape it needs (peer uid for direct, group_id for group). The
  // channel-list hook already keeps this snapshot live + sorted.
  const { records } = useChannelList({ skipAutoBootstrap: true });
  const record = useMemo(
    () =>
      records.find(
        (r) => r.channel_id === channelId && r.channel_type === channelType,
      ),
    [records, channelId, channelType],
  );
  const peerUid = record?.channel_type === 1 ? record.title : undefined;
  const userProfile = useUserProfile(peerUid ?? '');
  // BOT_INTERACTION_SPEC §3.1：DM 对端 user_type=2 (Bot) 时显示菜单按钮。
  // System (user_type=1) v1 不显示（系统用户没有 bot service binding）。
  const isBot = record?.channel_type === 1 && userProfile?.user_type === 2;
  const friendship = useFriendship(peerUid ?? '');
  const groupProfile = useGroupProfile(
    record?.channel_type === 2 ? record.channel_id : '',
  );
  const resolvedTitle = useMemo(() => {
    if (record === undefined) return undefined;
    return resolveConversationTitle({
      channel: record,
      user:
        peerUid !== undefined && peerUid !== '' ? userProfile : undefined,
      peerUid,
      friendship:
        peerUid !== undefined && peerUid !== '' ? friendship : undefined,
      group: record.channel_type === 2 ? groupProfile : undefined,
      i18n: titleI18n,
    });
  }, [record, userProfile, friendship, groupProfile, peerUid, titleI18n]);
  const headerTitle = title ?? resolvedTitle?.title ?? channelId;
  const isDirect = record?.channel_type === 1;
  // Pull presence for direct chats; the header subtitle and the
  // profile-card popover share this single fetch.
  const presence = usePresence(isDirect ? peerUid : undefined);
  const lastSeenI18n = useLastSeenI18n();
  const presenceLine = formatPresenceLine(presence, lastSeenI18n);
  // Typing: subscribes to the channel on mount and listens for inbound
  // typing pushes. When peer is typing we override the subtitle line.
  const { isPeerTyping, notify: notifyTyping } = useTyping(channelId, channelType);
  const subtitleLine = isPeerTyping ? t('panel.peer_typing') : presenceLine;

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [dragHover, setDragHover] = useState(false);
  // Reply target — set by clicking "Reply" in a row's menu, cleared
  // by sending or by the X in the composer header.
  const [replyTo, setReplyTo] = useState<MessageItemVM | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const imagePickerRef = useRef<HTMLInputElement | null>(null);
  const filePickerRef = useRef<HTMLInputElement | null>(null);

  const sendImage = useSendImage();
  const sendFile = useSendFile();
  const sendVideo = useSendVideo();
  const selfUid = usePrivchatClient().sessionSnapshot().user_id;

  // Voice playback is a single-active controller across the whole app.
  // When the user navigates to a different conversation (channelId
  // changes) or unmounts this panel, hard-stop whatever was playing
  // — otherwise audio keeps going from the previous chat.
  useEffect(() => {
    return () => {
      stopVoicePlayback();
    };
  }, [channelId]);

  const onSend = async () => {
    const text = draft.trim();
    if (text === '' || sending) return;
    setSending(true);
    try {
      await send(text, {
        reply_to_message_id: replyTo?.server_message_id,
      });
      setDraft('');
      setReplyTo(null);
      // Send stop-typing immediately so peer's "正在输入…" clears the
      // moment our message lands, not after the idle timeout.
      notifyTyping('');
    } catch {
      // error is surfaced via `useConversation().error`
    } finally {
      setSending(false);
      // Re-focus the composer so the next message can be typed without
      // reaching for the mouse — Enter-send + immediate refocus is the
      // standard chat-app idiom. We schedule via rAF so the focus call
      // runs AFTER React re-enables the input (the `disabled={sending}`
      // flip would otherwise blur an active focus).
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  };

  // Send a canned message from a bot-menu `message` action through the
  // same path as user-typed text (timeline / ack / reply identical).
  // metadata 暂时只透传名字——SDK 现有 `send()` 签名没暴露 metadata 字段，
  // 等 send-message-request metadata wiring 落地再补；v1 先吃文本即可。
  const sendBotMenuMessage = async (
    text: string,
    _metadata?: Record<string, unknown>,
  ) => {
    const t = text.trim();
    if (t === '' || sending) return;
    setSending(true);
    try {
      await send(t, {
        reply_to_message_id: replyTo?.server_message_id,
      });
      setReplyTo(null);
      notifyTyping('');
    } catch {
      // error surfaces via useConversation().error
    } finally {
      setSending(false);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  };

  // ---- media upload + send ----
  //
  // Each upload registers a task in the module-level uploads store so
  // the progress display survives panel remounts (channel switch +
  // back) and stays decoupled from per-component state. The panel-
  // local `uploading` flag is gone — concurrency control happens via
  // the per-task store, and N parallel uploads are now allowed.
  //
  // Progress bubble inside the timeline is a richer follow-up; this
  // round renders the active uploads as chips above the composer.
  const onSendImageBlob = async (file: Blob, filename: string, mime: string) => {
    const taskId = newTaskId();
    startTask({
      id: taskId,
      channel_id: channelId,
      filename,
      kind: 'image',
    });
    try {
      const dims = await readImageDimensions(file);
      await sendImage({
        channel_id: channelId,
        channel_type: channelType,
        file,
        filename,
        mime_type: mime,
        width: dims.width,
        height: dims.height,
        onProgress: (e) => patchProgress(taskId, e.loaded, e.total, e.percent),
      });
      markDone(taskId);
    } catch (err) {
      markFailed(taskId, (err as Error).message);
    }
  };

  const onSendFileBlob = async (file: Blob, filename: string, mime: string) => {
    const taskId = newTaskId();
    startTask({
      id: taskId,
      channel_id: channelId,
      filename,
      kind: 'file',
    });
    try {
      await sendFile({
        channel_id: channelId,
        channel_type: channelType,
        file,
        filename,
        mime_type: mime,
        onProgress: (e) => patchProgress(taskId, e.loaded, e.total, e.percent),
      });
      markDone(taskId);
    } catch (err) {
      markFailed(taskId, (err as Error).message);
    }
  };

  const onSendVideoBlob = async (file: Blob, filename: string, mime: string) => {
    const taskId = newTaskId();
    startTask({
      id: taskId,
      channel_id: channelId,
      filename,
      kind: 'video',
    });
    try {
      // Best-effort metadata probe via a hidden <video> element. If it
      // fails (codec the browser can't decode, broken file), we fall
      // back to width/height/duration = 0 — the server still accepts
      // the message; the receiver just renders a player with default
      // dims and no duration overlay.
      const meta = await readVideoMetadata(file).catch(() => ({
        width: 0,
        height: 0,
        duration: 0,
      }));
      await sendVideo({
        channel_id: channelId,
        channel_type: channelType,
        file,
        filename,
        mime_type: mime,
        width: meta.width,
        height: meta.height,
        duration: meta.duration,
        // No client-side poster frame generation. The receiver renders
        // controls without a thumbnail when this is absent.
        onProgress: (e) => patchProgress(taskId, e.loaded, e.total, e.percent),
      });
      markDone(taskId);
    } catch (err) {
      markFailed(taskId, (err as Error).message);
    }
  };

  /** Multi-file dispatcher used by both file pickers and the
   *  drag/paste handlers. Routes image / video / generic-file by MIME. */
  const onAttachFiles = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (f.type.startsWith('image/')) {
        await onSendImageBlob(f, f.name || 'image', f.type || 'image/jpeg');
      } else if (f.type.startsWith('video/')) {
        await onSendVideoBlob(f, f.name || 'video', f.type || 'video/mp4');
      } else {
        await onSendFileBlob(f, f.name || 'file', f.type || 'application/octet-stream');
      }
    }
  };

  const activeUploads = useChannelUploads(channelId);

  const onLoadOlder = async () => {
    if (loadingOlder || reachedBeginning) return;
    setLoadingOlder(true);
    try {
      await loadOlder();
    } catch {
      /* surfaced via error */
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <div
      className={cn(
        // No default border/rounded — visual chrome is the consumer's job.
        // ChatWorkspace uses the panel as the right pane (no extra frame
        // needed); embed scenarios wrap with their own <Card> if desired.
        // h-full requires the parent to constrain height (flex-1 + min-h-0).
        'relative flex h-full flex-col overflow-hidden bg-card',
        className,
      )}
      onDragOver={(e) => {
        // Block default browser file-drop (which navigates) and arm the
        // visual hint. dropEffect must be set in onDragOver, not onDragEnter.
        e.preventDefault();
        if (!dragHover) setDragHover(true);
      }}
      onDragLeave={(e) => {
        // Only clear when leaving the panel itself, not when crossing
        // into a child element.
        if (e.currentTarget === e.target) setDragHover(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragHover(false);
        if (e.dataTransfer.files.length > 0) {
          void onAttachFiles(e.dataTransfer.files);
        }
      }}
    >
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-3 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {onBack !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onBack}
              aria-label={t('panel.back')}
              // Hidden on md+ where the list is always visible; only the
              // single-pane H5 layout actually needs the back affordance.
              className="md:hidden -ml-2"
            >
              ←
            </Button>
          )}
          {isDirect ? (
            <ProfileCard
              user={userProfile}
              fallbackTitle={headerTitle}
              presence={presence}
            >
              <button
                type="button"
                className="flex min-w-0 flex-col items-start text-left rounded-md px-1 -mx-1 hover:bg-accent/50"
              >
                <span className="truncate text-sm font-semibold">
                  {headerTitle}
                </span>
                {subtitleLine !== undefined && (
                  <span
                    className={cn(
                      'truncate text-[11px]',
                      isPeerTyping
                        ? 'text-primary'
                        : presence?.is_online === true
                          ? 'text-emerald-600'
                          : 'text-muted-foreground',
                    )}
                  >
                    {subtitleLine}
                  </span>
                )}
              </button>
            </ProfileCard>
          ) : (
            <button
              type="button"
              className="flex min-w-0 flex-col items-start text-left rounded-md px-1 -mx-1 hover:bg-accent/50"
              onClick={() => setGroupInfoOpen(true)}
            >
              <span className="truncate text-sm font-semibold">{headerTitle}</span>
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {isOpening && <span>{t('panel.opening')}</span>}
          {pendingCount > 0 && <span>{t('panel.pending_count', { count: pendingCount })}</span>}
          {!isDirect && record !== undefined && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setGroupInfoOpen(true)}
              aria-label={t('groups.info_button')}
              title={t('groups.info_button')}
            >
              <Info className="h-4 w-4" />
            </Button>
          )}
        </div>
      </header>

      <MessageList
        messages={messages}
        channelId={channelId}
        selfUid={selfUid}
        peerReadPts={peerReadPts}
        peerName={isDirect ? headerTitle : undefined}
        isOpening={isOpening}
        reachedBeginning={reachedBeginning}
        loadingOlder={loadingOlder}
        onLoadOlder={onLoadOlder}
        onReply={(m) => setReplyTo(m)}
      />

      {error !== null && (
        <div className="shrink-0 border-t px-4 py-2 text-xs text-destructive">
          {error.message}
        </div>
      )}
      {activeUploads.length > 0 && (
        <div className="shrink-0 border-t bg-muted/30 px-3 py-2 space-y-1">
          {activeUploads.map((task) => (
            <UploadChip key={task.id} task={task} />
          ))}
        </div>
      )}
      {dragHover && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary text-sm font-medium text-primary pointer-events-none">
          {t('panel.drop_to_upload')}
        </div>
      )}

      {!isDirect && record !== undefined && (
        <LazyGroupInfoDialog
          open={groupInfoOpen}
          onOpenChange={setGroupInfoOpen}
          groupId={record.channel_id}
          title={headerTitle}
          onLeft={onBack}
        />
      )}

      {replyTo !== null && (
        <div className="shrink-0 border-t bg-muted/30 px-3 py-1.5 flex items-center gap-2 text-xs">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t('message_actions.replying_to')}
            </div>
            <div className="truncate text-muted-foreground">
              {replyTo.content !== ''
                ? replyTo.content
                : `[${replyTo.content_type}]`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            className="shrink-0 rounded p-1 hover:bg-accent"
            aria-label={t('message_actions.cancel_reply')}
            title={t('message_actions.cancel_reply')}
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <footer className="shrink-0 border-t p-3 flex items-center gap-2">
        <input
          ref={imagePickerRef}
          type="file"
          // The "image" picker button accepts both images and videos —
          // `onAttachFiles` routes each by MIME type to the right
          // sender. Visually we keep it labelled as the image button
          // (camera icon) since "图片/视频" is the standard chat-app
          // grouping (Telegram, WeChat, WhatsApp all do this).
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const fs = e.currentTarget.files;
            if (fs !== null && fs.length > 0) void onAttachFiles(fs);
            e.currentTarget.value = '';
          }}
        />
        <input
          ref={filePickerRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const fs = e.currentTarget.files;
            if (fs !== null && fs.length > 0) void onAttachFiles(fs);
            e.currentTarget.value = '';
          }}
        />
        {isBot && (
          <BotMenuButton
            channelId={channelId}
            onError={(msg) => {
              // 简单 toast：直接 alert 也行，但避免阻塞；这里 console + 屏幕上不展示
              // 沉默错误（菜单失败不该打断对话），用户重新点会再次拉取。
              console.warn('[bot-menu]', msg);
            }}
            onSendMessage={(text, metadata) => {
              void sendBotMenuMessage(text, metadata);
            }}
          />
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => imagePickerRef.current?.click()}
          aria-label={t('panel.upload_image')}
          title={t('panel.upload_image')}
        >
          <ImageIcon className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => filePickerRef.current?.click()}
          aria-label={t('panel.upload_file')}
          title={t('panel.upload_file')}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Input
          ref={inputRef}
          autoFocus
          value={draft}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setDraft(v);
            notifyTyping(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void onSend();
            }
          }}
          onPaste={(e) => {
            // Pasted image from clipboard → upload as image. Skip if
            // the paste is text only (let the default text-paste run).
            const items = e.clipboardData.items;
            const files: File[] = [];
            for (let i = 0; i < items.length; i++) {
              const it = items[i];
              if (it && it.kind === 'file') {
                const f = it.getAsFile();
                if (f !== null) files.push(f);
              }
            }
            if (files.length > 0) {
              e.preventDefault();
              void onAttachFiles(files);
            }
          }}
          placeholder={t('panel.type_message')}
          disabled={sending}
        />
        <Button onClick={onSend} disabled={sending || draft.trim() === ''}>
          {sending ? t('panel.sending') : t('panel.send')}
        </Button>
      </footer>
    </div>
  );
}

/** Lazy wrapper for `GroupInfoDialog`. Mounts on first open and stays
 *  mounted afterwards so the Radix close-state animation can play. */
function LazyGroupInfoDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  title: string;
  onLeft?: () => void;
}) {
  const mounted = useLazyMount(props.open);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <GroupInfoDialog {...props} />
    </Suspense>
  );
}


/** A single line in the active-uploads row above the composer.
 *  Renders filename + percent + status. Failed tasks expose an
 *  inline X to dismiss; uploading / done tasks hide it (done tasks
 *  are removed from the store automatically, so this is a guard).
 *
 *  We deliberately render above the composer rather than in-bubble:
 *  in-bubble progress requires pre-creating the cache row before
 *  the upload finishes (so the row identity is stable as bytes
 *  flow), which is a bigger refactor than this round wants. */
function UploadChip({ task }: { task: UploadTask }) {
  const { t } = useTranslation();
  const percentLabel =
    task.percent !== undefined
      ? `${task.percent}%`
      : task.total > 0
        ? `${Math.round(task.loaded / 1024)} KB`
        : '…';
  return (
    <div className="flex items-center gap-2 text-xs">
      {task.kind === 'image' ? (
        <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : task.kind === 'video' ? (
        <Video className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{task.filename}</span>
          <span
            className={cn(
              'shrink-0 font-mono text-[10px]',
              task.status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {task.status === 'failed' ? t('panel.upload_failed') : percentLabel}
          </span>
        </div>
        {task.status === 'uploading' && (
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width] duration-150"
              style={{
                width:
                  task.percent !== undefined
                    ? `${task.percent}%`
                    : task.total > 0
                      ? `${Math.min(95, (task.loaded / Math.max(1, task.total)) * 100)}%`
                      : '40%',
              }}
            />
          </div>
        )}
      </div>
      {task.status === 'failed' && (
        <button
          type="button"
          onClick={() => removeTask(task.id)}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent"
          aria-label={t('status.discard')}
        >
          <XIcon className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/** Probe an image blob for its natural dimensions in the browser
 *  using `createImageBitmap` (decodes via the GPU when available),
 *  falling back to an Image object for older browsers. Used by the
 *  upload flow so the receiver can render the bubble at the right
 *  aspect ratio without waiting for the network image to load. */
async function readImageDimensions(file: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const bmp = await createImageBitmap(file);
      const dims = { width: bmp.width, height: bmp.height };
      bmp.close?.();
      return dims;
    } catch {
      // fall through to <img> path
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image probe failed'));
    };
    img.src = url;
  });
}

/** Probe a video blob for `videoWidth` / `videoHeight` / `duration`
 *  using a detached `<video>` element. Loads metadata only — never
 *  fetches the body. Rejects on decode error / unknown codec; callers
 *  fall back to `0/0/0` and let the receiver render default chrome. */
async function readVideoMetadata(
  file: Blob,
): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.src = '';
    };
    video.onloadedmetadata = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      // Some browsers report duration as Infinity for streamed / chunked
      // sources before a seek; treat that as "unknown" rather than
      // poisoning the receiver with a bogus value.
      const rawDuration = video.duration;
      const duration =
        Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
      cleanup();
      resolve({ width, height, duration });
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('video probe failed'));
    };
    video.src = url;
  });
}
