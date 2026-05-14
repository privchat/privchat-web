// Group Info dialog. Mounts from the conversation header for group
// chats. Pulls the member roster on open via `useGroupOps().listMembers`
// (no local cache for group members in the SDK today; one fetch per
// open is fine — server returns all members in a single response).
//
// Owner/admin viewers get inline admin actions per row (Remove,
// Mute/Unmute) and an "Add Member" button at the top that opens a
// friend picker. Regular members see read-only view + Leave.
//
// Permission inference: server returns `role: string` per member; we
// look up the current user's row and derive `canManage` from
// `role ∈ {'owner','admin'}`. No magic numbers.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, MoreHorizontal, UserPlus } from 'lucide-react';
import type { GroupMember, GroupSettingsData } from '@privchat/sdk';
import { useFriendList, useGroupOps, usePrivchatClient } from '@privchat/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Avatar } from './avatar';
import { errorText } from './error-text';

export interface GroupInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Group id (== channel_id by server invariant). */
  groupId: string;
  /** Display title for the dialog header. */
  title: string;
  /** Called after a successful leave so the host can dismiss the
   *  conversation panel (the channel will disappear from the list on
   *  the next entity sync regardless). */
  onLeft?: () => void;
}

export function GroupInfoDialog({
  open,
  onOpenChange,
  groupId,
  title,
  onLeft,
}: GroupInfoDialogProps) {
  const { t } = useTranslation();
  const ops = useGroupOps();
  const adapter = usePrivchatClient();
  const selfUid = adapter.sessionSnapshot().user_id;

  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  // Per-row busy state so multiple concurrent admin clicks queue cleanly.
  const [busyUid, setBusyUid] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // R2 — group settings. Lazy-loaded once on dialog open alongside the
  // member roster. Editable subset is `description` + `announcement`
  // (name + avatar have no user-side RPC per spec). `all_muted` flips
  // via the dedicated mute-all toggle.
  const [settings, setSettings] = useState<GroupSettingsData | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [toggleMuteAllBusy, setToggleMuteAllBusy] = useState(false);

  const fetchMembers = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await ops.listMembers(groupId);
      setMembers(resp.members);
    } catch (e) {
      setError(`${t('groups.members_failed')}: ${errorText(e)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Run roster + settings fetches in parallel — independent calls
    // and both feed the dialog body, no point serializing.
    Promise.allSettled([ops.listMembers(groupId), ops.getSettings(groupId)])
      .then(([rosterRes, settingsRes]) => {
        if (cancelled) return;
        if (rosterRes.status === 'fulfilled') {
          setMembers(rosterRes.value.members);
        } else {
          setError(
            `${t('groups.members_failed')}: ${errorText(rosterRes.reason)}`,
          );
        }
        if (settingsRes.status === 'fulfilled') {
          setSettings(settingsRes.value.settings);
        }
        // Settings fetch failure is non-fatal — the roster is the
        // primary content. Owner editing affordances simply stay
        // hidden when `settings` is null.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, ops, groupId, t]);

  // Self's role drives the admin-action gate. Server uses string roles
  // ("owner" | "admin" | "member"); we derive canManage here so UI
  // checks stay symbolic instead of comparing magic strings inline.
  const selfMember = useMemo(
    () =>
      selfUid !== undefined
        ? members.find((m) => String(m.user_id) === selfUid)
        : undefined,
    [members, selfUid],
  );
  const canManage =
    selfMember?.role === 'owner' || selfMember?.role === 'admin';

  const onLeave = async () => {
    if (leaving) return;
    if (!confirm(t('groups.leave_confirm'))) return;
    setLeaving(true);
    setError(null);
    try {
      await ops.leaveGroup(groupId);
      onOpenChange(false);
      onLeft?.();
    } catch (e) {
      setError(`${t('groups.leave_failed')}: ${errorText(e)}`);
    } finally {
      setLeaving(false);
    }
  };

  const onRemove = async (m: GroupMember) => {
    if (busyUid !== null) return;
    const display = m.nickname || m.username;
    if (!confirm(t('groups.remove_member_confirm', { name: display }))) return;
    setBusyUid(m.user_id);
    setError(null);
    try {
      await ops.removeMember(groupId, String(m.user_id));
      // Optimistic-ish: drop the row from local state instead of
      // refetching the whole roster — the actual sync will catch up
      // via `entity_changed` when the SDK gains that surface.
      setMembers((prev) => prev.filter((x) => x.user_id !== m.user_id));
    } catch (e) {
      setError(`${t('groups.remove_member_failed')}: ${errorText(e)}`);
    } finally {
      setBusyUid(null);
    }
  };

  const onMute = async (m: GroupMember) => {
    if (busyUid !== null) return;
    setBusyUid(m.user_id);
    setError(null);
    try {
      if (m.is_muted) {
        await ops.unmuteMember(groupId, String(m.user_id));
      } else {
        // 0 = permanent. UI doesn't expose duration picker yet — keep
        // it server-default.
        await ops.muteMember(groupId, String(m.user_id), 0);
      }
      // Patch the row locally so the badge flips immediately.
      setMembers((prev) =>
        prev.map((x) =>
          x.user_id === m.user_id ? { ...x, is_muted: !m.is_muted } : x,
        ),
      );
    } catch (e) {
      setError(`${t('groups.mute_failed')}: ${errorText(e)}`);
    } finally {
      setBusyUid(null);
    }
  };

  // R1: role management. Owner-only — the `canManage` gate above admits
  // both owner + admin, but per spec (`group/role/set`) only owner can
  // promote/demote. Server enforces authoritatively; UI gates only to
  // give early feedback (hides the menu items for admin viewers).
  const isOwnerSelf = selfMember?.role === 'owner';

  const onSetRole = async (m: GroupMember, nextRole: 'admin' | 'member') => {
    if (busyUid !== null) return;
    setBusyUid(m.user_id);
    setError(null);
    try {
      await ops.setMemberRole(groupId, String(m.user_id), nextRole);
      setMembers((prev) =>
        prev.map((x) =>
          x.user_id === m.user_id ? { ...x, role: nextRole } : x,
        ),
      );
    } catch (e) {
      setError(`${t('groups.set_role_failed')}: ${errorText(e)}`);
    } finally {
      setBusyUid(null);
    }
  };

  const onTransferOwner = async (m: GroupMember) => {
    if (busyUid !== null) return;
    const display = m.nickname || m.username;
    if (!confirm(t('groups.transfer_owner_confirm', { name: display }))) return;
    setBusyUid(m.user_id);
    setError(null);
    try {
      await ops.transferOwner(groupId, String(m.user_id));
      // Server invariant (per spec): outgoing owner is downgraded to
      // admin in the same transaction. Mirror it locally so the row
      // badges flip immediately — saves a roster refetch.
      setMembers((prev) =>
        prev.map((x) => {
          if (x.user_id === m.user_id) return { ...x, role: 'owner' };
          if (selfUid !== undefined && String(x.user_id) === selfUid) {
            return { ...x, role: 'admin' };
          }
          return x;
        }),
      );
    } catch (e) {
      setError(`${t('groups.transfer_owner_failed')}: ${errorText(e)}`);
    } finally {
      setBusyUid(null);
    }
  };

  const onAdded = (uid: string) => {
    setAddOpen(false);
    // Pull a fresh roster — the just-added row carries server-assigned
    // role / joined_at that we don't want to fabricate locally.
    void fetchMembers();
    void uid;
  };

  // R2 — save edits from the inline settings form (description +
  // announcement). Optimistic local patch on success so the
  // description/announcement chips reflect the change without a
  // refetch. Server rejects with a permission error if the caller
  // isn't owner; we bubble that up via the same error chip the
  // member ops use.
  const onSaveSettings = async (patch: {
    description?: string;
    announcement?: string;
  }) => {
    if (settings === null || savingSettings) return;
    setSavingSettings(true);
    setError(null);
    try {
      await ops.updateSettings(groupId, patch);
      setSettings((prev) =>
        prev !== null
          ? {
              ...prev,
              ...(patch.description !== undefined
                ? { description: patch.description }
                : {}),
              ...(patch.announcement !== undefined
                ? { announcement: patch.announcement }
                : {}),
            }
          : prev,
      );
      setEditOpen(false);
    } catch (e) {
      setError(`${t('groups.settings_save_failed')}: ${errorText(e)}`);
    } finally {
      setSavingSettings(false);
    }
  };

  // R3 — toggle whole-group mute. Owner-only per spec; UI gates on
  // `isOwnerSelf`. Goes through the dedicated `group/settings/mute_all`
  // route (separate notification on the server side).
  const onToggleMuteAll = async () => {
    if (settings === null || toggleMuteAllBusy) return;
    setToggleMuteAllBusy(true);
    setError(null);
    try {
      const next = !settings.all_muted;
      await ops.muteAll(groupId, next);
      setSettings((prev) =>
        prev !== null ? { ...prev, all_muted: next } : prev,
      );
    } catch (e) {
      setError(`${t('groups.mute_all_failed')}: ${errorText(e)}`);
    } finally {
      setToggleMuteAllBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {error !== null && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          {/* R2 — group settings section (description / announcement).
              Render whenever settings have loaded. Owner gets an Edit
              affordance; non-owner sees read-only. Empty values are
              hidden to keep the dialog compact. */}
          {settings !== null &&
            (settings.description !== undefined ||
              settings.announcement !== undefined ||
              isOwnerSelf) && (
              <div className="space-y-2 rounded-md border bg-muted/20 px-3 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-muted-foreground">
                    {t('groups.settings_heading')}
                  </span>
                  {isOwnerSelf && (
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => setEditOpen(true)}
                    >
                      {t('groups.settings_edit')}
                    </button>
                  )}
                </div>
                {settings.description !== undefined &&
                  settings.description !== '' && (
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">
                        {t('groups.settings_description')}
                      </div>
                      <div className="whitespace-pre-wrap break-words">
                        {settings.description}
                      </div>
                    </div>
                  )}
                {settings.announcement !== undefined &&
                  settings.announcement !== '' && (
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">
                        {t('groups.settings_announcement')}
                      </div>
                      <div className="whitespace-pre-wrap break-words">
                        {settings.announcement}
                      </div>
                    </div>
                  )}
                {isOwnerSelf && (
                  <label className="flex items-center justify-between gap-2 pt-1">
                    <span>{t('groups.settings_mute_all')}</span>
                    <input
                      type="checkbox"
                      checked={settings.all_muted}
                      disabled={toggleMuteAllBusy}
                      onChange={() => void onToggleMuteAll()}
                      data-testid="group-mute-all"
                    />
                  </label>
                )}
              </div>
            )}

          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {t('groups.members', { count: members.length })}
            </div>
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddOpen(true)}
              >
                <UserPlus className="h-3.5 w-3.5 mr-1" />
                {t('groups.add_member')}
              </Button>
            )}
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            <ul className="divide-y">
              {members.map((m) => {
                const display = m.nickname || m.username;
                const roleLabel =
                  m.role === 'owner'
                    ? t('groups.role_owner')
                    : m.role === 'admin'
                      ? t('groups.role_admin')
                      : '';
                const isSelfRow = String(m.user_id) === selfUid;
                const showAdmin = canManage && !isSelfRow && m.role !== 'owner';
                const rowBusy = busyUid === m.user_id;
                return (
                  <li
                    key={m.user_id}
                    className="flex items-center gap-3 py-2"
                  >
                    <Avatar
                      seed={`u:${m.user_id}`}
                      label={display}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {display}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        @{m.username}
                      </div>
                    </div>
                    {m.is_muted && (
                      <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                        {t('groups.muted_badge')}
                      </span>
                    )}
                    {roleLabel !== '' && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {roleLabel}
                      </span>
                    )}
                    {showAdmin && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            disabled={rowBusy}
                            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-50"
                            aria-label="actions"
                          >
                            {rowBusy ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <MoreHorizontal className="h-4 w-4" />
                            )}
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {/* Role management is owner-only per spec.
                             `group/role/set` rejects non-owner callers,
                             so we gate the menu items at UI level too —
                             admin viewers see mute/remove but not
                             promote/demote/transfer. */}
                          {isOwnerSelf && m.role !== 'owner' && (
                            <DropdownMenuItem
                              onSelect={() =>
                                void onSetRole(
                                  m,
                                  m.role === 'admin' ? 'member' : 'admin',
                                )
                              }
                            >
                              {m.role === 'admin'
                                ? t('groups.demote_admin')
                                : t('groups.promote_admin')}
                            </DropdownMenuItem>
                          )}
                          {isOwnerSelf && (
                            <DropdownMenuItem
                              onSelect={() => void onTransferOwner(m)}
                            >
                              {t('groups.transfer_owner')}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={() => void onMute(m)}>
                            {m.is_muted
                              ? t('groups.unmute_member')
                              : t('groups.mute_member')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => void onRemove(m)}
                            className="text-destructive focus:text-destructive"
                          >
                            {t('groups.remove_member')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="flex justify-end pt-2">
            <Button
              variant="destructive"
              onClick={() => void onLeave()}
              disabled={leaving}
            >
              {leaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t('groups.leave')
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <AddMemberDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        groupId={groupId}
        existingUids={new Set(members.map((m) => String(m.user_id)))}
        onAdded={onAdded}
      />
      {settings !== null && (
        <EditSettingsDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          initial={{
            description: settings.description ?? '',
            announcement: settings.announcement ?? '',
          }}
          saving={savingSettings}
          onSave={onSaveSettings}
        />
      )}
    </>
  );
}

/** Owner-only inline form for editing the two free-text settings the
 *  user-facing RPC actually supports (`description`, `announcement`).
 *  Diff-and-submit: only fields whose value differs from `initial`
 *  are sent so we don't churn `updated_at` on a no-op save, and the
 *  server's `updated_count` correctly reflects the actual changes. */
function EditSettingsDialog({
  open,
  onOpenChange,
  initial,
  saving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: { description: string; announcement: string };
  saving: boolean;
  onSave: (patch: {
    description?: string;
    announcement?: string;
  }) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [description, setDescription] = useState(initial.description);
  const [announcement, setAnnouncement] = useState(initial.announcement);

  // Re-seed when the dialog opens (initial might change between mounts
  // because the outer settings state updated optimistically).
  useEffect(() => {
    if (open) {
      setDescription(initial.description);
      setAnnouncement(initial.announcement);
    }
  }, [open, initial.description, initial.announcement]);

  const dirty =
    description !== initial.description ||
    announcement !== initial.announcement;

  const submit = () => {
    const patch: { description?: string; announcement?: string } = {};
    if (description !== initial.description) patch.description = description;
    if (announcement !== initial.announcement) patch.announcement = announcement;
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    void onSave(patch);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('groups.settings_edit_title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="group-settings-description">
              {t('groups.settings_description')}
            </Label>
            <Input
              id="group-settings-description"
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
              disabled={saving}
              placeholder={t('groups.settings_description_placeholder')}
              data-testid="group-settings-description-input"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="group-settings-announcement">
              {t('groups.settings_announcement')}
            </Label>
            <Input
              id="group-settings-announcement"
              value={announcement}
              onChange={(e) => setAnnouncement(e.currentTarget.value)}
              disabled={saving}
              placeholder={t('groups.settings_announcement_placeholder')}
              data-testid="group-settings-announcement-input"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t('groups.settings_cancel')}
          </Button>
          <Button onClick={submit} disabled={saving || !dirty}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              t('groups.settings_save')
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Friend-picker for adding a member. Lists the user's friends,
 *  filtered to exclude anyone already in the group. Currently only
 *  supports adding from friends — random uid input is intentionally
 *  out of scope for this round. */
function AddMemberDialog({
  open,
  onOpenChange,
  groupId,
  existingUids,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  existingUids: Set<string>;
  onAdded: (uid: string) => void;
}) {
  const { t } = useTranslation();
  const ops = useGroupOps();
  const friends = useFriendList();
  const candidates = useMemo(
    () => friends.filter((f) => !existingUids.has(f.user_id)),
    [friends, existingUids],
  );
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBusyUid(null);
    setError(null);
  }, [open]);

  const onAdd = async (uid: string) => {
    if (busyUid !== null) return;
    setBusyUid(uid);
    setError(null);
    try {
      await ops.addMember(groupId, uid);
      onAdded(uid);
    } catch (e) {
      setError(`${t('groups.add_member_failed')}: ${errorText(e)}`);
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('groups.add_member_pick')}</DialogTitle>
        </DialogHeader>
        {error !== null && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <div className="max-h-[50vh] overflow-y-auto">
          {candidates.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {t('groups.add_member_no_friends')}
            </div>
          ) : (
            <ul className="divide-y">
              {candidates.map((f) => {
                const rowBusy = busyUid === f.user_id;
                return (
                  <li
                    key={f.user_id}
                    className="flex items-center gap-3 py-2"
                  >
                    <Avatar
                      seed={`u:${f.user_id}`}
                      label={f.title}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {f.title}
                      </div>
                      {f.subtitle !== undefined && (
                        <div className="truncate text-xs text-muted-foreground">
                          {f.subtitle}
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => void onAdd(f.user_id)}
                      disabled={busyUid !== null}
                      className={cn(rowBusy && 'opacity-70')}
                    >
                      {rowBusy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        t('groups.add_member')
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
