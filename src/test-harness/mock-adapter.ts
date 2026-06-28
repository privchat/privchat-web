// Mock adapter for the Playwright smoke harness. NOT shipped in
// production: imported only when `VITE_PRIVCHAT_TEST_MODE === 'mock'`,
// which is set by the Playwright runner via the test build script.
//
// Two design constraints:
//
//   1. Realistic — UI needs to render. Channels need titles, friends
//      need usernames, messages need from_uid / pts / timestamp, etc.
//      We seed defaults that exercise the panel + sidebar without
//      requiring per-test setup.
//
//   2. Programmable — Playwright tests need to push specific scenarios
//      (a failed outbox row, a reply chain). We expose a tiny seed
//      API on `window.__privchatTest` so specs can override state
//      synchronously before asserting on the rendered UI.
//
// The unit-test `tests/helpers/mock-adapter.ts` in @privchat/react is
// for hook-level contract tests with throw-on-call defaults; this is
// a *fully behavioural* mock for end-to-end UI smoke. They serve
// different roles and intentionally don't share code.

import { CacheDB } from '@privchat/sdk';
import { migrateLegacySessionToRegistryOfOne } from '@/lib/migrate-single-account-session';
import {
  migrateLegacyDbToAccountDb,
  type DbMigrationOutcome,
} from '@/lib/migrate-legacy-db';
import type { AccountKey } from '@/lib/account-key';
import {
  switchAccountSafely,
  type SwitchOutcome,
} from '@/lib/switch-account';
import {
  loadRegistry,
  saveRegistry,
  withActive,
} from '@/lib/account-registry-store';
import {
  loadAccountSession,
  saveAccountSession,
} from '@/lib/account-session';
import { setActiveAccountKey } from '@/lib/active-account';
import { upsertEntry } from '@/lib/account-registry-store';
import {
  capabilitiesFor,
  type AccountCapabilities,
} from '@/lib/account-capabilities';
import {
  assertAccountModeConfig,
  getConfiguredAccountMode,
  getPlatformBaseUrl,
  type AccountMode,
} from '@/lib/account-mode';
import { sessionAccountMode } from '@/lib/session-storage';
import { entryAccountMode } from '@/lib/account-registry';
import type {
  ChannelRecord,
  ConnectionState,
  ConversationPatch,
  ConversationSnapshot,
  FriendshipRecord,
  GroupRecord,
  MessageRecord,
  OutboxEntry,
  OutboxStatus,
  SendTextOperationResult,
  SequencedSdkEvent,
  SessionSnapshot,
  UserRecord,
} from '@privchat/sdk';
import type {
  PrivchatClientAdapter,
  Unsubscribe,
} from '@privchat/react';
import type { PushMessageRequest } from '@privchat/sdk';
import type {
  QrLoginEvent,
  QrLoginSession,
  QrUnauthClient,
  QrUnauthClientFactory,
} from '@/lib/platform-qr-login';
import { __setQrUnauthClientFactoryForTests } from '@/lib/platform-qr-login';

/** R8.3a — discriminated union returned by platform-provider test
 *  controls. `errorName` carries the thrown class's `.name` so
 *  specs can assert on the error taxonomy
 *  (`PlatformConfigError` / `PlatformHttpError` / `PlatformProtocolError`
 *  / `PlatformApiError`). `errorCode` / `errorStatus` are populated
 *  for `PlatformApiError` / `PlatformHttpError` respectively. */
type PlatformInvokeResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      errorName: string;
      errorMessage: string;
      errorCode?: number;
      errorStatus?: number;
    };

/** R8.3a — wrap a provider call into a test-friendly discriminated
 *  union. Reads the optional `code` / `status` fields off the
 *  thrown error to expose `PlatformApiError.code` and
 *  `PlatformHttpError.status` to specs without a separate
 *  `instanceof` check. */
async function runPlatformInvoke<T>(
  fn: () => Promise<T>,
): Promise<PlatformInvokeResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    const e = err as {
      name?: string;
      message?: string;
      code?: unknown;
      status?: unknown;
    };
    return {
      ok: false,
      errorName: typeof e.name === 'string' ? e.name : 'Error',
      errorMessage:
        typeof e.message === 'string' ? e.message : String(err),
      ...(typeof e.code === 'number' ? { errorCode: e.code } : {}),
      ...(typeof e.status === 'number' ? { errorStatus: e.status } : {}),
    };
  }
}

// ---- Seedable state container ----

interface MockState {
  selfUid: string;
  channels: ChannelRecord[];
  /** Keyed by channel_id. */
  messages: Map<string, MessageRecord[]>;
  users: UserRecord[];
  groups: GroupRecord[];
  friendships: FriendshipRecord[];
  outbox: OutboxEntry[];
  /** Controls how `sendImage`/`sendFile`/`sendVideo` resolve. `'fail'`
   *  (default) throws — drives the media-send-failure bubble. `'ok'`
   *  resolves, letting specs exercise retry-to-success. */
  mediaSendOutcome: 'fail' | 'ok';
}

function defaultState(): MockState {
  // Two pre-seeded conversations: one direct with peer alice, one
  // group "Engineering". Enough surface to drive smoke tests without
  // every spec needing to seed from scratch.
  const peer: UserRecord = {
    user_id: '101',
    username: 'alice',
    nickname: 'Alice',
    user_type: 0,
    is_friend: true,
    sync_version: 1,
  };
  const groupOwner: UserRecord = {
    user_id: '999',
    username: 'owner',
    nickname: 'Owner',
    user_type: 0,
    is_friend: false,
    sync_version: 1,
  };
  const friendBob: UserRecord = {
    user_id: '102',
    username: 'bob',
    user_type: 0,
    is_friend: true,
    sync_version: 1,
  };
  const directChannel: ChannelRecord = {
    channel_id: '1001',
    channel_type: 1,
    title: '101', // server emits peer uid as title for direct
    latest_pts: '5',
    read_pts: '5',
    unread_count: 0,
    last_message_preview: 'hello there',
    updated_at: 1_700_000_000_000,
    sync_version: 1,
  };
  const groupChannel: ChannelRecord = {
    channel_id: '900',
    channel_type: 2,
    title: 'Engineering',
    latest_pts: '3',
    read_pts: '3',
    unread_count: 0,
    last_message_preview: 'standup at 10',
    updated_at: 1_700_000_001_000,
    sync_version: 1,
  };
  const directMessages: MessageRecord[] = [
    {
      channel_id: '1001',
      channel_type: 1,
      server_message_id: 'sm-1',
      from_uid: '101',
      message_type: '0',
      content: 'hi from alice',
      payload: new Uint8Array(),
      timestamp: 1_700_000_000_000 - 60_000,
      pts: '4',
      status: 'received',
    },
    {
      channel_id: '1001',
      channel_type: 1,
      server_message_id: 'sm-2',
      from_uid: 'self',
      message_type: '0',
      content: 'hello there',
      payload: new Uint8Array(),
      timestamp: 1_700_000_000_000,
      pts: '5',
      status: 'sent',
    },
  ];
  return {
    selfUid: 'self',
    channels: [directChannel, groupChannel],
    messages: new Map([
      ['1001', directMessages],
      ['900', []],
    ]),
    users: [peer, groupOwner, friendBob, {
      user_id: 'self',
      username: 'me',
      nickname: 'Me',
      user_type: 0,
      is_friend: false,
      sync_version: 1,
    }],
    groups: [
      { group_id: '900', name: 'Engineering', member_count: 5, sync_version: 1 },
    ],
    friendships: [
      { user_id: '101', alias: undefined, created_at: 0, updated_at: 0, sync_version: 1 },
      { user_id: '102', alias: undefined, created_at: 0, updated_at: 0, sync_version: 1 },
    ],
    outbox: [],
    mediaSendOutcome: 'fail',
  };
}

let state: MockState = defaultState();

// Session-expired signal hub. TestApp subscribes (mirroring App.tsx's
// `client.observeEvents` → session_expired wiring); `fireSessionExpired`
// control drives it. Module-level so it survives `seed`/`reset` (these
// are component subscriptions, not seed state).
const sessionExpiredListeners = new Set<() => void>();
export function onTestSessionExpired(cb: () => void): () => void {
  sessionExpiredListeners.add(cb);
  return () => {
    sessionExpiredListeners.delete(cb);
  };
}

/** Shared media-send simulation. Throws when `mediaSendOutcome === 'fail'`
 *  (the default — drives the failure bubble), else resolves a queued
 *  result. The media-send store keys its overlay off the caller-supplied
 *  `local_message_id` and clears it on a resolved send, so a resolved
 *  return is enough to model retry-to-success without inserting a row. */
function mockMediaSend(
  localMessageId: string | undefined,
): Promise<SendTextOperationResult> {
  if (state.mediaSendOutcome === 'fail') {
    return Promise.reject(new Error('upload failed (smoke harness)'));
  }
  return Promise.resolve({
    status: 'queued',
    local_message_id: localMessageId ?? 'mock-media',
    outbox_id: localMessageId ?? 'mock-media',
  });
}

// Queued prepend pages, keyed by channelId. Each entry is a FIFO
// of pages that successive `scrollHistory` calls will consume.
// Tests use `__privchatTest.queuePrependPage(...)` to stash a page
// before clicking "Load older"; the next scrollHistory call pops
// the page and notifies the conversation observer.
const queuedPrependPages = new Map<string, MessageRecord[][]>();

// R8.5b — QR login harness state. Held module-level so the scripted
// fake unauth client closures + the active session reference survive
// across separate `__privchatTest` calls within one page lifetime.
// `gotoAppFresh` reloads the page → module re-evaluates → these reset.
//
// The real SDK's `onPushMessage` is multi-subscriber (it wraps the L1
// event bus). The fake mirrors that with a `Set<callback>` rather than
// a single slot, otherwise React StrictMode's double-mount can leave
// the slot pointing to the discarded first session's listener (or
// cleared by it post-hoc), which the production code's identity-checked
// unsubscribe can't repair when multiple sessions overlap.
interface QrHarnessFake {
  connectCalls: number;
  rpcCalls: number;
  disposeCalls: number;
  pushCbs: Set<(m: PushMessageRequest) => void>;
}

interface QrHarnessState {
  session: QrLoginSession | null;
  events: QrLoginEvent[];
  /** Captured from session.subscribe; non-null while subscribed. */
  unsubscribeEvents: (() => void) | null;
  fake: QrHarnessFake | null;
}

const qrHarness: QrHarnessState = {
  session: null,
  events: [],
  unsubscribeEvents: null,
  fake: null,
};

function resetQrHarness(): void {
  if (qrHarness.unsubscribeEvents !== null) {
    try {
      qrHarness.unsubscribeEvents();
    } catch {
      // ignore
    }
  }
  qrHarness.session = null;
  qrHarness.events = [];
  qrHarness.unsubscribeEvents = null;
  qrHarness.fake = null;
  // R8.5c — undo any factory override installed by a previous spec.
  // Synchronous so a follow-up `__setQrUnauthClientFactoryForTests`
  // call (from `qrInstallScriptedFactory`) can't race the unset.
  __setQrUnauthClientFactoryForTests(null);
}

// ---- Listener fan-out ----

type ChannelListener = (channels: ChannelRecord[]) => void;
type ConvListener = (s: ConversationSnapshot, p: ConversationPatch) => void;
type OutboxListener = (entries: OutboxEntry[]) => void;
type EventListener = (env: SequencedSdkEvent) => void;

const channelListeners = new Set<ChannelListener>();
const convListeners = new Map<string, Set<ConvListener>>();
const outboxListeners = new Set<OutboxListener>();
const eventListeners = new Set<EventListener>();

function notifyChannels() {
  for (const cb of channelListeners) cb([...state.channels]);
}
function notifyConv(channelId: string, patch: Partial<ConversationPatch> = {}) {
  const set = convListeners.get(channelId);
  if (!set) return;
  const messages = state.messages.get(channelId) ?? [];
  const channel = state.channels.find((c) => c.channel_id === channelId);
  const snapshot: ConversationSnapshot = {
    channel_id: channelId,
    channel_type: channel?.channel_type ?? 1,
    messages: [...messages],
    is_remote: true,
  };
  const fullPatch: ConversationPatch = {
    channel_id: channelId,
    channel_type: channel?.channel_type ?? 1,
    upserted: patch.upserted ?? [],
    removed: patch.removed ?? [],
    is_remote: patch.is_remote ?? true,
  };
  for (const cb of set) cb(snapshot, fullPatch);
}
function notifyOutbox() {
  for (const cb of outboxListeners) cb([...state.outbox]);
}

// ---- Adapter implementation ----

export function createTestAdapter(): PrivchatClientAdapter {
  return {
    connectionState(): ConnectionState {
      return 'authenticated';
    },
    observeEvents(cb: EventListener): Unsubscribe {
      eventListeners.add(cb);
      return () => {
        eventListeners.delete(cb);
      };
    },
    sessionSnapshot(): SessionSnapshot {
      return {
        user_id: state.selfUid,
        device_id: 'test-device',
        connection_state: 'authenticated',
        has_access_token: true,
        last_event_sequence_id: 0,
      };
    },

    // ---- Conversation ----
    async openConversation(channelId) {
      return [...(state.messages.get(channelId) ?? [])];
    },
    observeConversation(channelId, _ct, cb) {
      let set = convListeners.get(channelId);
      if (!set) {
        set = new Set();
        convListeners.set(channelId, set);
      }
      set.add(cb);
      return () => {
        set?.delete(cb);
      };
    },
    getCachedMessages(channelId) {
      // Fresh array per call — `useSyncExternalStore` consumers
      // expect identity-changes-on-mutation semantics. Returning the
      // same backing array ref would suppress re-renders.
      return [...(state.messages.get(channelId) ?? [])];
    },
    async scrollHistory(channelId: string): Promise<MessageRecord[]> {
      // Tests that exercise the load-older path queue a prepend page
      // via `__privchatTest.queuePrependPage(...)`. When invoked,
      // `scrollHistory` consumes the next queued page for this
      // channel: prepends the records to the cache, fires the
      // conversation observer (so the React hook re-projects), and
      // returns the page so `useConversation` knows the request was
      // non-empty. With no queued page, behaviour stays as before:
      // empty array → caller marks `reachedBeginning=true`.
      const queued = queuedPrependPages.get(channelId);
      if (queued !== undefined && queued.length > 0) {
        const page = queued.shift();
        if (page !== undefined && page.length > 0) {
          const existing = state.messages.get(channelId) ?? [];
          state.messages.set(channelId, [...page, ...existing]);
          notifyConv(channelId, { upserted: page });
          return page;
        }
      }
      return [];
    },
    async sendTextMessage(input): Promise<SendTextOperationResult> {
      const local_message_id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const channel = state.channels.find((c) => c.channel_id === input.channel_id);
      const nextPts = String(BigInt(channel?.latest_pts ?? '0') + 1n);
      const record: MessageRecord = {
        channel_id: input.channel_id,
        channel_type: input.channel_type,
        server_message_id: `sm-${Date.now()}`,
        local_message_id,
        from_uid: input.from_uid,
        message_type: String(input.message_type ?? 0),
        content: input.content,
        payload: input.payload ?? new Uint8Array(),
        timestamp: Date.now(),
        pts: nextPts,
        status: 'sent',
      };
      const arr = state.messages.get(input.channel_id) ?? [];
      arr.push(record);
      state.messages.set(input.channel_id, arr);
      if (channel) {
        channel.latest_pts = nextPts;
        channel.last_message_preview = input.content;
        channel.updated_at = record.timestamp;
        notifyChannels();
      }
      notifyConv(input.channel_id, { upserted: [record] });
      return {
        status: 'sent',
        local_message_id,
        response: {} as never,
      };
    },
    async channelDirectGetOrCreate(uid) {
      // Map peer uid → channel_id by convention `uid * 10` if no
      // pre-seeded channel exists. Tests can seed explicit ones.
      const existing = state.channels.find(
        (c) => c.channel_type === 1 && c.title === String(uid),
      );
      if (existing) {
        return { channel_id: Number(existing.channel_id), created: false };
      }
      return { channel_id: uid * 10, created: true };
    },
    async markRead() {
      return null;
    },

    // ---- Bot follow / transfer (spec SERVICE_ACCOUNT_FOLLOW_SPEC + CHANNEL_TRANSFER_SPEC) ----
    async botFollow(bot_user_id: number) {
      return {
        bot_user_id,
        channel_id: bot_user_id * 10,
        account_user_type: 2,
        followed: true,
        created: true,
      };
    },
    async botUnfollow(bot_user_id: number) {
      return { bot_user_id, channel_id: bot_user_id * 10, unfollowed: true };
    },
    async transfer(req) {
      // Mock: 默认返一个空菜单 schema 让 BotMenuButton 走 "empty" 分支；
      // 单测要看 menu 内容时另注入 stub 替换。
      const emptyMenu = new TextEncoder().encode(
        JSON.stringify({ version: 1, items: [] }),
      );
      return {
        request_id: req.request_id,
        channel_id: req.channel_id,
        code: 0,
        message: 'OK',
        data: emptyMenu,
      };
    },

    // ---- Channel list ----
    async bootstrapChannels() {
      return [...state.channels];
    },
    cachedChannels() {
      return [...state.channels];
    },
    observeChannelList(cb: ChannelListener): Unsubscribe {
      channelListeners.add(cb);
      // Initial snapshot, microtask-async (matches SDK semantics).
      Promise.resolve().then(() => cb([...state.channels]));
      return () => {
        channelListeners.delete(cb);
      };
    },

    // ---- Profile cache ----
    cachedUser(uid) {
      return state.users.find((u) => u.user_id === uid);
    },
    cachedUsers() {
      return [...state.users];
    },
    observeUserList(cb) {
      Promise.resolve().then(() => cb([...state.users]));
      return () => {};
    },
    cachedGroup(gid) {
      return state.groups.find((g) => g.group_id === gid);
    },
    cachedGroups() {
      return [...state.groups];
    },
    observeGroupList(cb) {
      Promise.resolve().then(() => cb([...state.groups]));
      return () => {};
    },
    cachedFriendship(uid) {
      return state.friendships.find((f) => f.user_id === uid);
    },
    cachedFriendships() {
      return [...state.friendships];
    },
    observeFriendshipList(cb) {
      Promise.resolve().then(() => cb([...state.friendships]));
      return () => {};
    },
    async refreshFriendships() {},

    // ---- Friend / group commands ----
    async accountSearch() {
      return { users: [], total: 0, query: '' };
    },
    async friendApply() {
      return { user_id: 0, username: '', status: 'ok', added_at: 0 };
    },
    async friendAccept() {
      return 0;
    },
    async friendPending() {
      return { requests: [], total: 0 };
    },
    async setFriendAlias() {
      return true;
    },
    async removeFriend() {
      return true;
    },
    async blockUser() {
      return true;
    },
    async unblockUser() {
      return true;
    },
    async groupCreate() {
      return {
        group_id: 0,
        name: '',
        description: '',
        member_count: 0,
        created_at: 0,
        creator_id: 0,
      };
    },

    // ---- Presence ----
    async batchGetPresence() {
      return { items: [], denied_user_ids: [] };
    },

    // ---- Revoke ----
    async revokeMessage() {
      return true;
    },

    // ---- Typing ----
    async subscribeChannel() {
      return undefined;
    },
    async unsubscribeChannel() {
      return undefined;
    },
    async sendTyping() {
      return undefined;
    },

    // ---- Channel ops ----
    async pinChannel() {
      return undefined;
    },
    async muteChannel() {
      return undefined;
    },
    async hideChannel() {
      return undefined;
    },

    // ---- Group ops ----
    async listGroupMembers() {
      return { members: [], total: 0 };
    },
    async leaveGroup() {
      return true;
    },
    async addGroupMember() {
      return true;
    },
    async removeGroupMember() {
      return true;
    },
    async muteGroupMember() {
      return true;
    },
    async unmuteGroupMember() {
      return true;
    },

    // ---- Media ----
    // `state.mediaSendOutcome` drives the outcome: 'fail' (default)
    // throws — exercising the upload-failure timeline bubble — and 'ok'
    // resolves so specs can test retry-to-success (the media-send store
    // clears the overlay entry on a resolved send).
    async sendImage(args: { local_message_id?: string }) {
      return mockMediaSend(args.local_message_id);
    },
    async sendFile(args: { local_message_id?: string }) {
      return mockMediaSend(args.local_message_id);
    },
    async sendVideo(args: { local_message_id?: string }) {
      return mockMediaSend(args.local_message_id);
    },
    async setGroupMemberRole() {
      throw new Error('setGroupMemberRole not implemented in smoke harness');
    },
    async transferGroupOwner() {
      throw new Error('transferGroupOwner not implemented in smoke harness');
    },
    async getGroupSettings() {
      throw new Error('getGroupSettings not implemented in smoke harness');
    },
    async updateGroupSettings() {
      throw new Error('updateGroupSettings not implemented in smoke harness');
    },
    async muteGroupAll() {
      throw new Error('muteGroupAll not implemented in smoke harness');
    },
    async pinGroupMessage() {
      throw new Error('pinGroupMessage not implemented in smoke harness');
    },
    async listGroupPinnedMessages() {
      throw new Error('listGroupPinnedMessages not implemented in smoke harness');
    },

    // ---- Reactions ----
    async addReaction() {
      return undefined;
    },
    async removeReaction() {
      return undefined;
    },
    async listReactions() {
      return { reactions: {}, total_count: 0 };
    },

    // ---- Outbox ----
    observeOutbox(cb: OutboxListener): Unsubscribe {
      outboxListeners.add(cb);
      Promise.resolve().then(() => cb([...state.outbox]));
      return () => {
        outboxListeners.delete(cb);
      };
    },
    async retryOutboxEntry(outboxId) {
      const entry = state.outbox.find((e) => e.outbox_id === outboxId);
      if (!entry) return;
      // Smoke contract: retry "succeeds" — drop the row + emit success
      // via outbox observers. Real engine would actually re-send.
      state.outbox = state.outbox.filter((e) => e.outbox_id !== outboxId);
      notifyOutbox();
    },
    async discardOutboxEntry(outboxId) {
      state.outbox = state.outbox.filter((e) => e.outbox_id !== outboxId);
      notifyOutbox();
    },
    async fileGetUrl(fileId) {
      // Smoke contract: produce a deterministic fake URL so VoiceBubble
      // can lazy-resolve and the spec can assert on the load path
      // without spinning up a media server.
      return {
        file_url: `blob:mock/${fileId}`,
        expires_at: Date.now() + 3600_000,
        file_size: 0,
        mime_type: 'audio/mpeg',
      };
    },

    async downloadAttachmentBlob(_fileId) {
      // Smoke contract: deterministic empty blob so media bubbles can mount
      // without a real media server / decryption.
      return new Blob([], { type: 'application/octet-stream' });
    },

    // QR Code v1.3 — minimal deterministic stubs so smoke tests can mount
    // the dialogs without a real backend. Hosts that want richer fixtures
    // can spread overrides on top.
    async userQrcodeGet() {
      return {
        qr_key: 'mockUserKey001',
        qr_code: 'https://privchat.app/privchat:protocol/user/get/mockUserKey001',
        user_id: state.selfUid,
      };
    },
    async userQrcodeRefresh() {
      return {
        old_qr_key: 'mockUserKey000',
        new_qr_key: 'mockUserKey002',
        qr_code: 'https://privchat.app/privchat:protocol/user/get/mockUserKey002',
        user_id: state.selfUid,
      };
    },
    async userQrcodeResolve(qrKey: string) {
      return {
        user_id: '999',
        username: 'mockuser',
        display_name: `Mock(${qrKey})`,
        avatar_url: undefined,
        user_type: 0,
        is_friend: false,
        is_self: false,
      };
    },
    async groupQrcodeGet(groupId: string) {
      return {
        qr_key: `mockGroupKey-${groupId}`,
        qr_code: `https://privchat.app/privchat:protocol/group/join/mockGroupKey-${groupId}`,
        group_id: groupId,
      };
    },
    async groupQrcodeRefresh(groupId: string) {
      return {
        old_qr_key: 'mockGroupOld',
        new_qr_key: `mockGroupKey-${groupId}-new`,
        qr_code: `https://privchat.app/privchat:protocol/group/join/mockGroupKey-${groupId}-new`,
        group_id: groupId,
      };
    },
    async groupJoinByQrcode(_qrKey: string, _message?: string) {
      return {
        status: 'joined',
        group_id: '1000',
        user_id: state.selfUid,
        joined_at: Date.now(),
      };
    },
  };
}

// ---- Public seed API (window.__privchatTest) ----

interface TestSeedInput {
  selfUid?: string;
  channels?: ChannelRecord[];
  /** Map of channel_id → message records. Replaces existing entries. */
  messages?: Record<string, MessageRecord[]>;
  users?: UserRecord[];
  groups?: GroupRecord[];
  friendships?: FriendshipRecord[];
  outbox?: OutboxEntry[];
}

/** R7.4 — outcome of a sequencer simulation. Mirrors the
 *  `SwitchOutcome` enum but flattens the handle field (which is
 *  a fake in test mode anyway) so it's JSON-serialisable across
 *  the Playwright `page.evaluate` boundary. */
export interface SimulatedSwitchOutcome {
  result:
    | 'committed'
    | 'rolled-back-current'
    | 'rolled-back-no-current'
    | 'rejected';
  reason?: string;
  /** The accountKey that's now active in the registry after the
   *  sequencer settled. `null` for `rolled-back-no-current` /
   *  `rejected` outcomes. */
  registryActive: string | null;
  /** The accountKey the active-account seam ended on. */
  seamActive: string;
  /** Side-effect log: which sequencer hooks fired and in which
   *  order. Specs assert on this to verify "runtime cleanup ran
   *  before disconnect" etc. */
  trace: string[];
}

export interface TestHarnessControls {
  /** Reset to defaults. */
  reset(): void;
  /** Patch state. Unspecified slices keep their current values. */
  seed(input: TestSeedInput): void;
  /** Add a single failed outbox row + matching cache message. Common
   *  retry-test fixture. */
  seedFailedMessage(args: {
    channelId: string;
    channelType?: number;
    content: string;
    fromUid?: string;
    localMessageId?: string;
  }): { local_message_id: string; outbox_id: string };
  /** Push an inbound message into a channel and notify observers. */
  pushIncomingMessage(record: MessageRecord): void;
  /** Control how media sends (`sendImage`/`sendFile`/`sendVideo`)
   *  resolve: `'fail'` throws (failure bubble), `'ok'` resolves
   *  (retry-to-success). Reset back to `'fail'` by `reset()`. */
  setMediaSendOutcome(outcome: 'fail' | 'ok'): void;
  /** Simulate the SDK's terminal `session_expired` signal. TestApp
   *  mirrors App.tsx's subscription → renders the "登录已过期" dialog.
   *  Lets smokes assert the dialog surface + confirm path. */
  fireSessionExpired(): void;
  /** Queue a page of older messages that the NEXT `scrollHistory`
   *  call for `channelId` will consume. The records are prepended
   *  to the channel's cache and the observer is notified, mirroring
   *  what a real server load-older roundtrip looks like. Used by
   *  R5.3.2 history-prepend smoke. */
  queuePrependPage(channelId: string, records: MessageRecord[]): void;
  /** Replace one row in a channel's cache (matched by
   *  `server_message_id` or `local_message_id`) with a patched copy
   *  and notify the conversation observer. Used by R5.3.4 dynamic-
   *  height smoke to grow / shrink an already-mounted row without
   *  touching its identity. */
  patchMessage(
    channelId: string,
    recordKey: string,
    patch: Partial<MessageRecord>,
  ): boolean;
  /** R7.2a — invoke the legacy → registry-of-one session migration
   *  runner directly. The production app calls this once at boot
   *  from `App.tsx`; the test harness exposes it so Playwright
   *  smokes can stage legacy localStorage with `addInitScript` and
   *  then verify the migration's outcome without spinning up the
   *  real login flow. Returns the active `AccountKey` (as a plain
   *  string) or `null` when nothing was migrated. */
  runLegacySessionMigration(): Promise<string | null>;
  /** R7.2b — invoke the legacy → account-DB copy runner directly.
   *  Tests must pass an `accountKey`; the production app gets it
   *  from the session migration's return value. Returns the
   *  outcome enum (`copied` / `skipped-marked` / `skipped-existing`
   *  / `no-legacy`) so specs can assert on the path taken. */
  runLegacyDbMigration(accountKey: string): Promise<DbMigrationOutcome>;
  /** R8.2 — return descriptive metadata about the active
   *  `AccountAuthProvider` so smokes can verify production code
   *  routes through it instead of inlining the RPC. The provider
   *  factory is module-cached; calling this is cheap. */
  describeAuthProvider(): Promise<{
    mode: AccountMode;
    hasLoginWithPassword: boolean;
    hasRegisterWithPassword: boolean;
    hasLoginWithSms: boolean;
    hasRefreshToken: boolean;
    hasLogout: boolean;
    hasStartQrLogin: boolean;
  }>;
  /** R8.2 — invoke the active `AccountAuthProvider`'s
   *  `loginWithPassword` against an obviously-bad URL. Used to
   *  prove the provider's temp-client lifecycle is reachable
   *  from production code (it must throw, and must not leak any
   *  half-connected websocket between attempts). */
  triggerBuiltinLoginAgainstBadUrl(): Promise<{
    threw: boolean;
    errorMessage: string;
  }>;
  /** R8.3a — exercise `normalizePlatformBaseUrl(input)` directly.
   *  Returns the normalized URL on success, or the thrown error's
   *  `name` + message on failure. Lets specs assert the lenient
   *  trim/strip vs strict /app behaviour without round-tripping
   *  through the provider constructor. */
  platformNormalizeBaseUrl(
    input: string,
  ): Promise<
    | { ok: true; result: string }
    | { ok: false; errorName: string; errorMessage: string }
  >;
  /** R8.3a — construct a fresh `PlatformAuthProvider(baseUrl)`,
   *  call `sendSmsCode`, and return a discriminated success/error
   *  shape. Specs use `page.route()` to mock the underlying
   *  `${baseUrl}/auth/send-sms-code` HTTP call. */
  platformSendSmsCode(args: {
    baseUrl: string;
    mobile: string;
  }): Promise<PlatformInvokeResult<{ cooldownSeconds: number }>>;
  /** R8.3a — construct a fresh `PlatformAuthProvider(baseUrl)`,
   *  call `loginWithSms`, and return the mapped `LoginResult` (or
   *  a discriminated error). Specs `page.route()` the underlying
   *  `${baseUrl}/auth/sms-login` to feed any envelope shape. */
  platformLoginWithSms(args: {
    baseUrl: string;
    serverUrl: string;
    mobile: string;
    smsCode: string;
  }): Promise<
    PlatformInvokeResult<{
      serverUrl: string;
      userId: string;
      accessToken: string;
      deviceId: string;
      accountMode: string;
      platformBaseUrl?: string;
      refreshToken?: string;
    }>
  >;
  /** R8.3a — construct a fresh `PlatformAuthProvider(baseUrl)`,
   *  call `refreshToken` against a synthetic PLATFORM
   *  `PersistedSession`, return the new session blob (or error). */
  platformRefreshToken(args: {
    baseUrl: string;
    url: string;
    userId: string;
    deviceId: string;
    accessToken: string;
    refreshToken: string;
  }): Promise<
    PlatformInvokeResult<{
      url: string;
      user_id: string;
      access_token: string;
      refresh_token?: string;
      device_id: string;
      account_mode?: string;
      platform_base_url?: string;
    }>
  >;
  /** R8.4b — construct `PlatformRequiredActionsProvider(baseUrl, getToken)`
   *  and call `list()`. Specs mock `${baseUrl}/account/required-actions`. */
  platformListRequiredActions(args: {
    baseUrl: string;
    accessToken: string;
  }): Promise<PlatformInvokeResult<Array<Record<string, unknown>>>>;
  /** R8.4b — `BuiltinRequiredActionsProvider().list()` must always return
   *  `[]` synchronously (no HTTP). Lets the BUILTIN-mode spec prove the
   *  noop contract without staging a fake server. */
  builtinListRequiredActions(): Promise<{
    ok: true;
    data: Array<Record<string, unknown>>;
  }>;
  /** R8.4b — construct `PlatformProfileProvider(baseUrl, getToken)` and
   *  call `getProfile()`. Specs mock `${baseUrl}/member/user/get`. */
  platformGetProfile(args: {
    baseUrl: string;
    accessToken: string;
  }): Promise<
    PlatformInvokeResult<{
      id: string;
      mobile?: string;
      nickname: string;
      avatar?: string;
      username?: string;
      usernameUpdatedAt?: number;
      gender: number;
      bio?: string;
      birthday?: string;
    }>
  >;
  /** R8.4b — construct `PlatformProfileProvider(baseUrl, getToken)` and
   *  call `updateNickname(nickname)`. Specs mock
   *  `${baseUrl}/member/user/update-nickname`. */
  platformUpdateNickname(args: {
    baseUrl: string;
    accessToken: string;
    nickname: string;
  }): Promise<PlatformInvokeResult<null>>;
  /** R8.4d-1 — `PlatformProfileProvider.updateBio`. `bio` null = clear. */
  platformUpdateBio(args: {
    baseUrl: string;
    accessToken: string;
    bio: string | null;
  }): Promise<PlatformInvokeResult<null>>;
  /** R8.4d-1 — `PlatformProfileProvider.updateGender`. Accepts 0/1/2/9. */
  platformUpdateGender(args: {
    baseUrl: string;
    accessToken: string;
    gender: number;
  }): Promise<PlatformInvokeResult<null>>;
  /** R8.4d-1 — `PlatformProfileProvider.updateBirthday`. ISO YYYY-MM-DD or null. */
  platformUpdateBirthday(args: {
    baseUrl: string;
    accessToken: string;
    birthday: string | null;
  }): Promise<PlatformInvokeResult<null>>;
  /** R8.4d-2 — `PlatformProfileProvider.uploadAvatar`. Constructs a
   *  synthetic `File` in-browser from the provided `byteSize` + `mime`
   *  (random bytes) so specs can drive the multipart guard rails without
   *  needing test fixtures on disk. */
  platformUploadAvatar(args: {
    baseUrl: string;
    accessToken: string;
    mime: string;
    byteSize: number;
    filename?: string;
  }): Promise<
    PlatformInvokeResult<{
      fileId: string;
      url: string;
      businessType: string;
      mimeType: string;
      size: number;
    }>
  >;
  /** R8.4d-2 — `PlatformProfileProvider.updateAvatar(fileId)`. */
  platformUpdateAvatar(args: {
    baseUrl: string;
    accessToken: string;
    fileId: string;
  }): Promise<PlatformInvokeResult<null>>;
  /** R8.5b — return `typeof (new PlatformAuthProvider).startQrLogin`
   *  as a string, so the capability-gate smoke can assert the
   *  PLATFORM class definition exposes the method (separate from
   *  the runtime `getAuthProvider()` cache which is mode-driven). */
  platformProviderHasStartQrLogin(): Promise<{
    methodType: string;
  }>;
  /** R8.5c — install a scripted fake QR unauth-client factory at
   *  the module-level seam, so the NEXT production-code call to
   *  `PlatformAuthProvider.startQrLogin` (e.g. from `<QrLoginPanel>`)
   *  uses the fake instead of opening a real WS. This is the entry
   *  point UI smokes use to drive `LoginPage`'s QR tab through the
   *  actual production code path. Use `qrInjectPush` to drive push
   *  events afterward. Cleared by `reset()`. */
  qrInstallScriptedFactory(args: {
    connect: { kind: 'ok' } | { kind: 'fail'; message: string };
    rpc:
      | {
          kind: 'ok';
          sceneId: string;
          qrToken: string;
          expiresAt: number;
        }
      | { kind: 'fail'; message: string };
  }): Promise<void>;
  /** R8.5b — start a QR login session against a scripted fake unauth
   *  client. `behavior` controls how the fake client responds to
   *  `connect()` and the `qr_login/create_scene` RPC. After the call
   *  resolves, the spec drives the session forward by calling
   *  `qrInjectPush()` / `qrCancel()`, and reads state via
   *  `qrInspect()` / `qrDrainEvents()`. Only one QR session is
   *  active in the harness at a time (matches production UI). */
  platformStartQrLoginScripted(args: {
    serverUrl: string;
    platformBaseUrl: string;
    deviceId: string;
    /** Whether `client.connect()` resolves or rejects. */
    connect: { kind: 'ok' } | { kind: 'fail'; message: string };
    /** Whether `rpcCallTyped('qr_login/create_scene', ...)` resolves
     *  or rejects, and the scene payload it returns when ok. */
    rpc:
      | {
          kind: 'ok';
          sceneId: string;
          qrToken: string;
          expiresAt: number;
          rpcTopic?: string;
        }
      | { kind: 'fail'; message: string };
  }): Promise<
    PlatformInvokeResult<{
      sceneId: string;
      qrPayload: string;
      expiresInSeconds: number;
    }>
  >;
  /** R8.5b — inject a `PushMessageRequest`-shaped push into the fake
   *  client of the currently active QR session. `payloadJson` is the
   *  UTF-8 JSON string of spec QR_API §5.2's envelope; pass an
   *  arbitrary string to test malformed-JSON handling. Returns the
   *  event count after the listener processes the push. */
  qrInjectPush(args: {
    topic: string;
    payloadJson: string;
  }): Promise<{ eventCount: number }>;
  /** R8.5b — drain collected QR events since last call. Each call
   *  returns the FULL list seen so far (not a delta) so specs can
   *  assert idempotently. */
  qrDrainEvents(): Promise<QrLoginEvent[]>;
  /** R8.5b — invoke the active session's `cancel()`. Idempotent. */
  qrCancel(): Promise<void>;
  /** R8.5b — read internal counters from the fake unauth client so
   *  cleanup contracts can be asserted (push listener disposed,
   *  client.dispose() called, etc.). */
  qrInspect(): Promise<{
    sessionActive: boolean;
    fakeConnectCalls: number;
    fakeRpcCalls: number;
    fakeDisposeCalls: number;
    fakePushListenerActive: boolean;
  }>;
  /** R8.4b — wire-defense check: parse a `RequiredAction` per spec rules
   *  (missing `required` → true; titleKey/title fallback chain). Returns
   *  the decoded `isRequired` boolean + the resolved title given a
   *  pluggable `t` translator. */
  decodeRequiredAction(
    raw: Record<string, unknown>,
  ): Promise<{
    action: string;
    isRequired: boolean;
    title: string;
  }>;
  /** R8.1 — read the compile-time account-mode config. Used by
   *  the mode-config smoke to assert the env-var → enum mapping
   *  without bringing the seam tests into Node-side typing. */
  getAccountModeConfig(): {
    mode: AccountMode;
    platformBaseUrl: string | null;
    /** True when `assertAccountModeConfig()` would throw. */
    misconfigured: boolean;
  };
  /** R8.1 — return the capability matrix the configured mode
   *  resolves to. Specs assert the BUILTIN matrix denies
   *  profileEdit/smsLogin/qrLogin and the PLATFORM matrix
   *  enables them. */
  getAccountCapabilities(): AccountCapabilities;
  /** R8.1 — exercise the schema reader rules for legacy data.
   *  Returns `'builtin'` when the input lacks an explicit mode
   *  (proves the "missing field defaults to builtin" contract). */
  resolveLegacyAccountMode(input: {
    kind: 'session' | 'entry';
    /** Optional `account_mode` (session) or `mode` (entry). When
     *  unset, the resolver returns the default. */
    mode?: string;
  }): AccountMode;
  /** R7.5 — write an entry into the registry through the
   *  production storage primitives so subscribers re-render. The
   *  optional `setActive` flag flips `registry.active` in the same
   *  write (used by smokes that simulate a successful add-account
   *  commit without spinning up the full sequencer). */
  addAccountEntry(args: {
    accountKey: string;
    url: string;
    user_id: string;
    device_id: string;
    alias?: string;
    added_at?: number;
    setActive?: boolean;
  }): void;
  /** R7.5 — write a namespaced session blob for an account. Used by
   *  the multi-account isolation smoke to seed both A and B's
   *  tokens in one go without inspecting localStorage at the spec
   *  level. */
  setAccountSession(args: {
    accountKey: string;
    url: string;
    user_id: string;
    access_token: string;
    device_id: string;
  }): void;
  /** R7.4 — drive `switchAccountSafely` with deterministic mock
   *  callbacks. Lets specs assert on the sequencer's commit /
   *  rollback / fail outcomes without spinning up a real
   *  PrivchatClient or a backend.
   *
   *  `currentKey` is what the harness should pretend the active
   *  account is at the start of the switch (corresponds to
   *  React's `activeAccountKey` in production). `targetKey` is
   *  the account being switched to. `mode` controls whether the
   *  mocked connect succeeds for target / current. */
  simulateAccountSwitch(args: {
    currentKey: string | null;
    targetKey: string;
    mode:
      | 'success'
      | 'fail-target-only'
      | 'fail-target-and-current';
  }): Promise<SimulatedSwitchOutcome>;
  /** R7.2b — open `dbName` with the SDK's CacheDB schema and put
   *  one channels row keyed at `channelId`. Used by Dexie smoke
   *  specs to seed a "DB with data" without `page.evaluate`-ing
   *  raw IDB API (which has no module resolution for `dexie`). */
  seedDbWithChannel(dbName: string, channelId: string): Promise<void>;
  /** R7.2b — count rows in the `channels` table of `dbName`.
   *  Returns 0 when the DB doesn't exist or the table is empty. */
  dbCountChannels(dbName: string): Promise<number>;
  /** R7.2b — `Dexie.exists(dbName)` passthrough. */
  dbExists(dbName: string): Promise<boolean>;
  /** R7.2b — `Dexie.delete(dbName)` passthrough; idempotent. */
  dbDelete(dbName: string): Promise<void>;
  /** Acknowledge a local-echo row: find by `local_message_id`,
   *  merge in the remote fields (typically `server_message_id`,
   *  `pts`, `status`), keep `local_message_id` so the React VM's
   *  `record_key` flips from `local:<lid>` to `<server_message_id>`
   *  while still bridgeable via `local_message_id`. Used by R5.3.3
   *  ack-bridge smoke. */
  ackLocalMessage(
    channelId: string,
    localMessageId: string,
    remote: Partial<MessageRecord>,
  ): boolean;
  /** Snapshot — useful for debugging from the spec. */
  snapshot(): MockState;
}

export function installTestControls(): TestHarnessControls {
  const controls: TestHarnessControls = {
    reset() {
      state = defaultState();
      queuedPrependPages.clear();
      resetQrHarness();
      notifyChannels();
      for (const channelId of state.messages.keys()) notifyConv(channelId);
      notifyOutbox();
    },
    async runLegacySessionMigration() {
      // Direct passthrough — the production runner is fully self-
      // contained and idempotent, so the only role of the harness
      // is making it reachable from a Playwright `evaluate()` call.
      return await migrateLegacySessionToRegistryOfOne();
    },
    async runLegacyDbMigration(accountKey: string) {
      // Same passthrough rationale as the session migration.
      // Branded `AccountKey` cast is safe because the runner only
      // uses it as a Dexie name suffix and a localStorage key
      // suffix — both string operations.
      return await migrateLegacyDbToAccountDb(accountKey as AccountKey);
    },
    async seedDbWithChannel(dbName: string, channelId: string) {
      const db = new CacheDB(dbName);
      try {
        await db.open();
        await db.channels.put({
          channel_id: channelId,
          channel_type: 1,
          latest_pts: '1',
          read_pts: '1',
          unread_count: 0,
          updated_at: 1_700_000_000_000,
          sync_version: 1,
        });
      } finally {
        db.close();
      }
    },
    async dbCountChannels(dbName: string) {
      if (!(await CacheDB.exists(dbName))) return 0;
      const db = new CacheDB(dbName);
      try {
        await db.open();
        return await db.channels.count();
      } finally {
        db.close();
      }
    },
    async dbExists(dbName: string) {
      return CacheDB.exists(dbName);
    },
    async dbDelete(dbName: string) {
      // Dexie.delete on the static is exposed via any subclass.
      await CacheDB.delete(dbName);
    },
    setMediaSendOutcome(outcome) {
      state.mediaSendOutcome = outcome;
    },
    fireSessionExpired() {
      for (const cb of [...sessionExpiredListeners]) cb();
    },
    seed(input) {
      if (input.selfUid !== undefined) state.selfUid = input.selfUid;
      if (input.channels !== undefined) state.channels = input.channels;
      if (input.users !== undefined) state.users = input.users;
      if (input.groups !== undefined) state.groups = input.groups;
      if (input.friendships !== undefined) state.friendships = input.friendships;
      if (input.outbox !== undefined) state.outbox = input.outbox;
      if (input.messages !== undefined) {
        for (const [cid, msgs] of Object.entries(input.messages)) {
          state.messages.set(cid, msgs);
        }
      }
      notifyChannels();
      for (const channelId of state.messages.keys()) notifyConv(channelId);
      notifyOutbox();
    },
    seedFailedMessage(args) {
      const localId =
        args.localMessageId ?? `local-failed-${Date.now()}`;
      const channel = state.channels.find(
        (c) => c.channel_id === args.channelId,
      );
      const channelType = args.channelType ?? channel?.channel_type ?? 1;
      const fromUid = args.fromUid ?? state.selfUid;
      const record: MessageRecord = {
        channel_id: args.channelId,
        channel_type: channelType,
        local_message_id: localId,
        from_uid: fromUid,
        message_type: '0',
        content: args.content,
        payload: new TextEncoder().encode(args.content),
        timestamp: Date.now(),
        status: 'pending',
      };
      const arr = state.messages.get(args.channelId) ?? [];
      arr.push(record);
      state.messages.set(args.channelId, arr);
      const entry: OutboxEntry = {
        outbox_id: localId,
        record_key: `l:${localId}`,
        channel_id: args.channelId,
        channel_type: channelType,
        local_message_id: localId,
        from_uid: fromUid,
        content_type: 'text',
        payload: record.payload,
        created_at: record.timestamp,
        updated_at: record.timestamp,
        attempt_count: 3,
        next_attempt_at: Number.MAX_SAFE_INTEGER,
        last_error: 'rejected: simulated failure',
        status: 'failed' as OutboxStatus,
      };
      state.outbox.push(entry);
      notifyConv(args.channelId, { upserted: [record] });
      notifyOutbox();
      return { local_message_id: localId, outbox_id: localId };
    },
    pushIncomingMessage(record) {
      const arr = state.messages.get(record.channel_id) ?? [];
      arr.push(record);
      state.messages.set(record.channel_id, arr);
      notifyConv(record.channel_id, { upserted: [record] });
    },
    queuePrependPage(channelId, records) {
      const existing = queuedPrependPages.get(channelId) ?? [];
      existing.push(records);
      queuedPrependPages.set(channelId, existing);
    },
    patchMessage(channelId, recordKey, patch) {
      const arr = state.messages.get(channelId);
      if (arr === undefined) return false;
      // Match the same identity rule the React VM projection uses:
      // server_message_id wins, otherwise the synthetic
      // `local:<local_message_id>` key.
      const idx = arr.findIndex((r) => {
        if (r.server_message_id !== undefined) {
          return r.server_message_id === recordKey;
        }
        if (r.local_message_id !== undefined) {
          return `local:${r.local_message_id}` === recordKey;
        }
        return false;
      });
      if (idx < 0) return false;
      const next: MessageRecord = { ...arr[idx]!, ...patch };
      const nextArr = [...arr];
      nextArr[idx] = next;
      state.messages.set(channelId, nextArr);
      notifyConv(channelId, { upserted: [next] });
      return true;
    },
    async describeAuthProvider() {
      const { getAuthProvider } = await import('@/lib/account-auth-provider');
      const p = await getAuthProvider();
      return {
        mode: p.mode,
        hasLoginWithPassword: typeof p.loginWithPassword === 'function',
        hasRegisterWithPassword:
          typeof p.registerWithPassword === 'function',
        hasLoginWithSms: typeof p.loginWithSms === 'function',
        hasRefreshToken: typeof p.refreshToken === 'function',
        hasLogout: typeof p.logout === 'function',
        hasStartQrLogin: typeof p.startQrLogin === 'function',
      };
    },
    async triggerBuiltinLoginAgainstBadUrl() {
      const { getAuthProvider } = await import('@/lib/account-auth-provider');
      const p = await getAuthProvider();
      if (typeof p.loginWithPassword !== 'function') {
        return {
          threw: true,
          errorMessage:
            'BUILTIN provider missing loginWithPassword (capability misconfig)',
        };
      }
      try {
        await p.loginWithPassword({
          // Empty URL → underlying SDK can't construct a
          // websocket. The provider's `finally { dispose }` still
          // has to run cleanly; if it throws too, the surfaced
          // error becomes "Cannot read properties of …" which
          // would also fail this assertion.
          serverUrl: 'ws://0.0.0.0:1/',
          username: 'r8-2-test',
          password: 'r8-2-test',
          device: {
            device_id: '00000000-0000-4000-8000-000000000000',
            device_type: 'web',
            app_id: 'privchat-web',
            device_name: 'privchat-web',
            app_version: '0.0.0',
          },
        });
        return { threw: false, errorMessage: '' };
      } catch (err) {
        return {
          threw: true,
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    },
    async platformNormalizeBaseUrl(input: string) {
      const { normalizePlatformBaseUrl } = await import(
        '@/lib/platform-base-url'
      );
      try {
        return { ok: true as const, result: normalizePlatformBaseUrl(input) };
      } catch (err) {
        return {
          ok: false as const,
          errorName: err instanceof Error ? err.name : 'Error',
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    },
    async platformSendSmsCode(args) {
      return runPlatformInvoke(async () => {
        const { PlatformAuthProvider } = await import(
          '@/lib/platform-auth-provider'
        );
        const provider = new PlatformAuthProvider(args.baseUrl);
        return provider.sendSmsCode({
          platformBaseUrl: args.baseUrl,
          mobile: args.mobile,
          scene: 'login',
        });
      });
    },
    async platformLoginWithSms(args) {
      return runPlatformInvoke(async () => {
        const { PlatformAuthProvider } = await import(
          '@/lib/platform-auth-provider'
        );
        const provider = new PlatformAuthProvider(args.baseUrl);
        return provider.loginWithSms({
          platformBaseUrl: args.baseUrl,
          serverUrl: args.serverUrl,
          mobile: args.mobile,
          smsCode: args.smsCode,
          device: {
            device_id: '00000000-0000-4000-8000-000000000000',
            device_type: 'web',
            app_id: 'privchat-web',
            device_name: 'privchat-web',
            app_version: '0.0.0',
          },
        });
      });
    },
    async platformRefreshToken(args) {
      return runPlatformInvoke(async () => {
        const { PlatformAuthProvider } = await import(
          '@/lib/platform-auth-provider'
        );
        const provider = new PlatformAuthProvider(args.baseUrl);
        const session = {
          url: args.url,
          user_id: args.userId,
          access_token: args.accessToken,
          device_id: args.deviceId,
          saved_at: 1_700_000_000_000,
          account_mode: 'platform' as const,
          platform_base_url: args.baseUrl,
          refresh_token: args.refreshToken,
        };
        return provider.refreshToken(session);
      });
    },
    async platformListRequiredActions(args) {
      return runPlatformInvoke(async () => {
        const { PlatformRequiredActionsProvider } = await import(
          '@/lib/account-required-actions-provider'
        );
        const provider = new PlatformRequiredActionsProvider(
          args.baseUrl,
          () => args.accessToken,
        );
        // Return as a plain JSON-friendly array; the open RequiredAction
        // shape carries arbitrary keys, so cast to Record<string,unknown>[]
        // for the harness boundary.
        const actions = await provider.list();
        return actions as unknown as Array<Record<string, unknown>>;
      });
    },
    async builtinListRequiredActions() {
      const { BuiltinRequiredActionsProvider } = await import(
        '@/lib/account-required-actions-provider'
      );
      const provider = new BuiltinRequiredActionsProvider();
      const actions = await provider.list();
      return {
        ok: true as const,
        data: actions as unknown as Array<Record<string, unknown>>,
      };
    },
    async platformGetProfile(args) {
      return runPlatformInvoke(async () => {
        const { PlatformProfileProvider } = await import(
          '@/lib/account-profile-provider'
        );
        const provider = new PlatformProfileProvider(
          args.baseUrl,
          () => args.accessToken,
        );
        return provider.getProfile();
      });
    },
    async platformUpdateNickname(args) {
      return runPlatformInvoke(async () => {
        const { PlatformProfileProvider } = await import(
          '@/lib/account-profile-provider'
        );
        const provider = new PlatformProfileProvider(
          args.baseUrl,
          () => args.accessToken,
        );
        await provider.updateNickname(args.nickname);
        return null;
      });
    },
    async platformUpdateBio(args) {
      return runPlatformInvoke(async () => {
        const { PlatformProfileProvider } = await import(
          '@/lib/account-profile-provider'
        );
        const provider = new PlatformProfileProvider(
          args.baseUrl,
          () => args.accessToken,
        );
        await provider.updateBio?.(args.bio);
        return null;
      });
    },
    async platformUpdateGender(args) {
      return runPlatformInvoke(async () => {
        const { PlatformProfileProvider } = await import(
          '@/lib/account-profile-provider'
        );
        const provider = new PlatformProfileProvider(
          args.baseUrl,
          () => args.accessToken,
        );
        await provider.updateGender?.(args.gender);
        return null;
      });
    },
    async platformUpdateBirthday(args) {
      return runPlatformInvoke(async () => {
        const { PlatformProfileProvider } = await import(
          '@/lib/account-profile-provider'
        );
        const provider = new PlatformProfileProvider(
          args.baseUrl,
          () => args.accessToken,
        );
        await provider.updateBirthday?.(args.birthday);
        return null;
      });
    },
    async platformUploadAvatar(args) {
      return runPlatformInvoke(async () => {
        const { PlatformProfileProvider } = await import(
          '@/lib/account-profile-provider'
        );
        const provider = new PlatformProfileProvider(
          args.baseUrl,
          () => args.accessToken,
        );
        // Build a synthetic File with the requested mime + size.
        // The bytes are zeroed — server doesn't actually look at them
        // in our mocked endpoint, just at the multipart form fields.
        const buf = new Uint8Array(args.byteSize);
        const file = new File([buf], args.filename ?? 'avatar.bin', {
          type: args.mime,
        });
        const result = await provider.uploadAvatar?.(file);
        if (result === undefined) {
          throw new Error('uploadAvatar not supported');
        }
        return result;
      });
    },
    async platformUpdateAvatar(args) {
      return runPlatformInvoke(async () => {
        const { PlatformProfileProvider } = await import(
          '@/lib/account-profile-provider'
        );
        const provider = new PlatformProfileProvider(
          args.baseUrl,
          () => args.accessToken,
        );
        await provider.updateAvatar?.(args.fileId);
        return null;
      });
    },
    async qrInstallScriptedFactory(args) {
      // Reset previous QR state so a single spec rerunning this
      // doesn't carry stale event lists / push callbacks.
      resetQrHarness();
      const fake: QrHarnessFake = {
        connectCalls: 0,
        rpcCalls: 0,
        disposeCalls: 0,
        pushCbs: new Set(),
      };
      qrHarness.fake = fake;
      const factory: QrUnauthClientFactory = (_url) => {
        const client: QrUnauthClient = {
          async connect() {
            fake.connectCalls += 1;
            if (args.connect.kind === 'fail') {
              throw new Error(args.connect.message);
            }
          },
          async rpcCallTyped<Req, Resp>(
            _route: string,
            _body: Req,
          ): Promise<Resp> {
            fake.rpcCalls += 1;
            if (args.rpc.kind === 'fail') {
              throw new Error(args.rpc.message);
            }
            const scene = {
              scene_id: args.rpc.sceneId,
              qr_token: args.rpc.qrToken,
              expires_at: args.rpc.expiresAt,
            };
            return scene as unknown as Resp;
          },
          onPushMessage(cb) {
            fake.pushCbs.add(cb);
            // Multi-listener semantics match the real SDK's L1 bus,
            // so React StrictMode's double-mount lands two listeners
            // and the live one survives the discarded session's
            // unsubscribe.
            return () => {
              fake.pushCbs.delete(cb);
            };
          },
          async dispose() {
            fake.disposeCalls += 1;
          },
        };
        return client;
      };
      __setQrUnauthClientFactoryForTests(factory);
    },
    async platformProviderHasStartQrLogin() {
      const { PlatformAuthProvider } = await import(
        '@/lib/platform-auth-provider'
      );
      const provider = new PlatformAuthProvider(
        'https://placeholder.example/app',
      );
      const provAsRecord = provider as unknown as Record<string, unknown>;
      return { methodType: typeof provAsRecord.startQrLogin };
    },
    async platformStartQrLoginScripted(args) {
      // Reset any previous QR state so a single spec can rerun the
      // call without polluting the next one.
      resetQrHarness();

      const fake: QrHarnessFake = {
        connectCalls: 0,
        rpcCalls: 0,
        disposeCalls: 0,
        pushCbs: new Set(),
      };
      qrHarness.fake = fake;

      const factory: QrUnauthClientFactory = (_url) => {
        const client: QrUnauthClient = {
          async connect() {
            fake.connectCalls += 1;
            if (args.connect.kind === 'fail') {
              throw new Error(args.connect.message);
            }
          },
          async rpcCallTyped<Req, Resp>(
            _route: string,
            _body: Req,
          ): Promise<Resp> {
            fake.rpcCalls += 1;
            if (args.rpc.kind === 'fail') {
              throw new Error(args.rpc.message);
            }
            const scene = {
              scene_id: args.rpc.sceneId,
              qr_token: args.rpc.qrToken,
              expires_at: args.rpc.expiresAt,
              ...(args.rpc.rpcTopic === undefined
                ? {}
                : { rpc_topic: args.rpc.rpcTopic }),
            };
            return scene as unknown as Resp;
          },
          onPushMessage(cb) {
            fake.pushCbs.add(cb);
            return () => {
              fake.pushCbs.delete(cb);
            };
          },
          async dispose() {
            fake.disposeCalls += 1;
          },
        };
        return client;
      };

      return runPlatformInvoke(async () => {
        const { startPlatformQrLoginWithClient } = await import(
          '@/lib/platform-qr-login'
        );
        const session = await startPlatformQrLoginWithClient(
          {
            serverUrl: args.serverUrl,
            platformBaseUrl: args.platformBaseUrl,
            device: {
              device_id: args.deviceId,
              device_type: 'web',
              app_id: 'privchat-web',
              device_name: 'privchat-web',
              app_version: '0.0.0',
            },
          },
          factory,
        );
        qrHarness.session = session;
        qrHarness.unsubscribeEvents = session.subscribe((event) => {
          qrHarness.events.push(event);
        });
        return {
          sceneId: session.scene.sceneId,
          qrPayload: session.scene.qrPayload,
          expiresInSeconds: session.scene.expiresInSeconds,
        };
      });
    },
    async qrInjectPush(args) {
      const fake = qrHarness.fake;
      if (fake === null || fake.pushCbs.size === 0) {
        // No active session listener — push silently dropped. Specs
        // check `eventCount` to detect this.
        return { eventCount: qrHarness.events.length };
      }
      // Build a `PushMessageRequest`-shaped object with the fields
      // `platform-qr-login.ts:onPush` actually reads (topic + payload).
      // The other fields are stubbed to keep the type checker happy.
      const encoder = new TextEncoder();
      const msg: PushMessageRequest = {
        setting: { need_receipt: false, signal: 0 },
        msg_key: '',
        server_message_id: '0',
        message_seq: 0,
        local_message_id: '0',
        stream_no: '',
        stream_seq: 0,
        stream_flag: 0,
        timestamp: 0,
        channel_id: '0',
        channel_type: 0,
        message_type: 0,
        expire: 0,
        topic: args.topic,
        from_uid: '0',
        payload: encoder.encode(args.payloadJson),
        deleted: false,
      };
      // Snapshot callbacks before iterating — handler-side
      // unsubscribe (e.g. terminal events triggering cleanup
      // mid-fire) mutates fake.pushCbs and would skip listeners
      // on a live iteration.
      const cbs = Array.from(fake.pushCbs);
      for (const cb of cbs) cb(msg);
      return { eventCount: qrHarness.events.length };
    },
    async qrDrainEvents() {
      // Return a snapshot copy so the spec sees stable identity
      // across awaits even though we keep appending.
      return [...qrHarness.events];
    },
    async qrCancel() {
      const session = qrHarness.session;
      if (session !== null) {
        await session.cancel();
      }
    },
    async qrInspect() {
      const fake = qrHarness.fake;
      return {
        sessionActive: qrHarness.session !== null,
        fakeConnectCalls: fake?.connectCalls ?? 0,
        fakeRpcCalls: fake?.rpcCalls ?? 0,
        fakeDisposeCalls: fake?.disposeCalls ?? 0,
        fakePushListenerActive:
          fake !== null && fake.pushCbs.size > 0,
      };
    },
    async decodeRequiredAction(raw) {
      const { isRequired, actionTitle } = await import('@/lib/required-action');
      const a = raw as Parameters<typeof actionTitle>[0];
      // Test harness translator: return key unchanged to simulate
      // i18next missing-key behaviour (so the fallback chain in
      // actionTitle() is exercised).
      const tIdentity = (k: string): string => k;
      return {
        action: a.action,
        isRequired: isRequired(a),
        title: actionTitle(a, tIdentity),
      };
    },
    getAccountModeConfig() {
      let misconfigured = false;
      try {
        assertAccountModeConfig();
      } catch {
        misconfigured = true;
      }
      // `getConfiguredAccountMode` itself can throw when the env
      // var is set to an invalid string; surface that as
      // `misconfigured: true` rather than crashing the harness.
      let mode: AccountMode;
      try {
        mode = getConfiguredAccountMode();
      } catch {
        return {
          mode: 'builtin' as AccountMode,
          platformBaseUrl: getPlatformBaseUrl(),
          misconfigured: true,
        };
      }
      return {
        mode,
        platformBaseUrl: getPlatformBaseUrl(),
        misconfigured,
      };
    },
    getAccountCapabilities() {
      let mode: AccountMode;
      try {
        mode = getConfiguredAccountMode();
      } catch {
        // Misconfig defaults to builtin so the matrix is still
        // queryable from the spec.
        mode = 'builtin';
      }
      return capabilitiesFor(mode);
    },
    resolveLegacyAccountMode(input) {
      if (input.kind === 'session') {
        return sessionAccountMode({
          url: '',
          user_id: '',
          access_token: '',
          device_id: '',
          saved_at: 0,
          ...(input.mode !== undefined
            ? { account_mode: input.mode as AccountMode }
            : {}),
        });
      }
      return entryAccountMode({
        url: '',
        user_id: '',
        device_id: '',
        added_at: 0,
        ...(input.mode !== undefined
          ? { mode: input.mode as AccountMode }
          : {}),
      });
    },
    addAccountEntry(args) {
      const baseReg = loadRegistry() ?? { accounts: {}, active: null };
      const next = upsertEntry(baseReg, args.accountKey as AccountKey, {
        url: args.url,
        user_id: args.user_id,
        device_id: args.device_id,
        alias: args.alias,
        added_at: args.added_at ?? Date.now(),
      });
      const final =
        args.setActive === true
          ? { ...next, active: args.accountKey as AccountKey }
          : next;
      saveRegistry(final);
      if (args.setActive === true) {
        setActiveAccountKey(args.accountKey as AccountKey);
      }
    },
    setAccountSession(args) {
      saveAccountSession(args.accountKey as AccountKey, {
        url: args.url,
        user_id: args.user_id,
        access_token: args.access_token,
        device_id: args.device_id,
      });
    },
    async simulateAccountSwitch(args) {
      // Build a fake handle type the sequencer treats opaquely.
      // The spec's mode flag controls whether the mocked
      // `connectAccount` resolves or throws for target / current.
      type FakeHandle = { kind: 'fake'; key: string };
      const trace: string[] = [];
      const targetSession = loadAccountSession(args.targetKey as AccountKey);
      // The current handle is purely a marker — the sequencer
      // never inspects it, just hands it to disconnect / dispose.
      const currentHandle: FakeHandle | null =
        args.currentKey !== null
          ? { kind: 'fake', key: args.currentKey }
          : null;

      const failTarget =
        args.mode === 'fail-target-only' ||
        args.mode === 'fail-target-and-current';
      const failCurrentRecover = args.mode === 'fail-target-and-current';

      const outcome: SwitchOutcome<FakeHandle> = await switchAccountSafely<
        FakeHandle
      >({
        current:
          currentHandle !== null && args.currentKey !== null
            ? { key: args.currentKey as AccountKey, handle: currentHandle }
            : null,
        targetKey: args.targetKey as AccountKey,
        loadSession: (key) => {
          // For the rollback path, the sequencer re-reads the
          // current session — return the same pre-built blob if
          // we have one, else null.
          if (key === args.targetKey) return targetSession;
          return loadAccountSession(key);
        },
        connectAccount: async (session) => {
          trace.push(`connect:${session.user_id}`);
          if (
            session.user_id ===
            (args.targetKey === null
              ? ''
              : (loadAccountSession(args.targetKey as AccountKey)?.user_id ??
                  ''))
          ) {
            // Target connect attempt
            if (failTarget) throw new Error('simulated target connect fail');
            return { kind: 'fake', key: args.targetKey };
          }
          // Recover-current attempt
          if (failCurrentRecover) {
            throw new Error('simulated current reconnect fail');
          }
          return {
            kind: 'fake',
            key: args.currentKey ?? '',
          };
        },
        disconnectHandle: async (h) => {
          trace.push(`disconnect:${h.key}`);
        },
        disposeHandle: async (h) => {
          trace.push(`dispose:${h.key}`);
        },
        runtimeCleanup: () => {
          trace.push('runtimeCleanup');
        },
        commit: (key) => {
          trace.push(`commit:${key}`);
          // The harness mirrors what App.tsx would do for the
          // commit step: write registry.active + flip the seam.
          const reg = loadRegistry();
          if (reg !== null && reg.accounts[key] !== undefined) {
            saveRegistry(withActive(reg, key));
          }
          setActiveAccountKey(key);
        },
        rollbackToCurrent: (key) => {
          trace.push(`rollback:${key}`);
          const reg = loadRegistry();
          if (reg !== null && reg.accounts[key] !== undefined) {
            saveRegistry(withActive(reg, key));
          }
          setActiveAccountKey(key);
        },
        fail: () => {
          trace.push('fail');
        },
        onError: (err, source) => {
          trace.push(`error:${source}:${(err as Error).message ?? err}`);
        },
      });

      const seamActive = (await import('@/lib/active-account'))
        .getActiveAccountKey();
      const reg = loadRegistry();
      return {
        result: outcome.result,
        reason: 'reason' in outcome ? outcome.reason : undefined,
        registryActive: reg?.active ?? null,
        seamActive,
        trace,
      } satisfies SimulatedSwitchOutcome;
    },
    ackLocalMessage(channelId, localMessageId, remote) {
      const arr = state.messages.get(channelId);
      if (arr === undefined) return false;
      const idx = arr.findIndex(
        (r) => r.local_message_id === localMessageId,
      );
      if (idx < 0) return false;
      // The ACKed record carries the remote fields (server id, pts,
      // status) but keeps `local_message_id` so that
      // `resolveAnchorRecordKey` can still bridge old → new
      // `record_key` after the React VM projects the row again.
      const acked: MessageRecord = {
        ...arr[idx]!,
        ...remote,
        local_message_id: localMessageId,
      };
      const nextArr = [...arr];
      nextArr[idx] = acked;
      state.messages.set(channelId, nextArr);
      notifyConv(channelId, { upserted: [acked] });
      return true;
    },
    snapshot() {
      return { ...state };
    },
  };
  // Expose on window for Playwright. Keys are namespaced under
  // `__privchatTest` to avoid clashing with the dev-only `__privchat`
  // (which holds the real client in non-test builds).
  (window as Window & { __privchatTest?: TestHarnessControls }).__privchatTest =
    controls;
  return controls;
}
