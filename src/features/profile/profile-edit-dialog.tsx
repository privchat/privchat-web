// R8.4d-1 — Self-profile editor dialog. PLATFORM only (BUILTIN's
// capability gate hides the entry point). Edits four fields:
//   - nickname  → updateNickname
//   - bio       → updateBio
//   - gender    → updateGender   (0=unknown, 1=male, 2=female, 9=other)
//   - birthday  → updateBirthday (ISO YYYY-MM-DD; raw <input type="date">)
//
// Each field PUTs its own endpoint (server design: split, one-field-per-PUT
// per spec MODULE_MEMBER_PROFILE_SPEC §3). On save we issue update calls
// only for fields the user actually changed — server-side hooks fire per
// changed field, so reducing chatter matters.
//
// avatar / username are explicitly out of scope (R8.4d-2 / R8.4d-3).

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar } from '@/features/chat/avatar';
import {
  AVATAR_ALLOWED_MIMES,
  getProfileProvider,
  type AccountProfileProvider,
  type MemberProfile,
} from '@/lib/account-profile-provider';
import { prepareAvatarImage } from '@/lib/prepare-avatar-image';
import { getActiveAccessToken } from '@/lib/active-access-token';
import { captureException } from '@/lib/error-reporter';
import { cn } from '@/lib/utils';

export interface ProfileEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FormState {
  nickname: string;
  bio: string;
  gender: number;
  birthday: string;
  /** R8.4d-2 — current bound avatar URL (server-confirmed). Updated only
   *  after a successful avatar save flow (upload + updateAvatar both ok). */
  avatar: string;
}

/** Snapshot the original (server-loaded) profile vs the user's edited form
 *  state, so we can compute "what changed" and only fire endpoints for
 *  fields that actually differ. Saves a round-trip per untouched field. */
function snapshotForm(profile: MemberProfile): FormState {
  return {
    nickname: profile.nickname,
    bio: profile.bio ?? '',
    gender: profile.gender,
    birthday: profile.birthday ?? '',
    avatar: profile.avatar ?? '',
  };
}

export function ProfileEditDialog({ open, onOpenChange }: ProfileEditDialogProps) {
  const { t } = useTranslation();
  const [provider] = useState<AccountProfileProvider>(() =>
    getProfileProvider(getActiveAccessToken),
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [original, setOriginal] = useState<FormState | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  // R8.4d-2 — pending avatar selection. Holds the file + a blob URL for
  // local preview. Cleared after a successful save or when dialog closes.
  // Not part of FormState because the diff-check key for avatar is "did
  // the user pick a new file", not "did the server-bound url change".
  const [pendingAvatar, setPendingAvatar] = useState<{
    file: File;
    previewUrl: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load profile when dialog opens; clear state when it closes so a
  // subsequent open re-fetches (multi-account: previous account's data
  // must not leak).
  useEffect(() => {
    if (!open) {
      setLoading(true);
      setForm(null);
      setOriginal(null);
      setError(null);
      setSavedFlash(false);
      // Release the blob URL — leaving it allocated would leak memory
      // across open/close cycles even though the file ref is dropped.
      if (pendingAvatar !== null) {
        URL.revokeObjectURL(pendingAvatar.previewUrl);
      }
      setPendingAvatar(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const profile = await provider.getProfile();
        if (cancelled) return;
        const snap = snapshotForm(profile);
        setOriginal(snap);
        setForm(snap);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        captureException(err, { source: 'profile-edit.load' });
        setError(translateError(err, t, 'load'));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, provider, t]);

  const canSave =
    !busy &&
    !loading &&
    form !== null &&
    original !== null &&
    (pendingAvatar !== null ||
      form.nickname !== original.nickname ||
      form.bio !== original.bio ||
      form.gender !== original.gender ||
      form.birthday !== original.birthday);

  /** Pick-time: validate format, then centre-crop to a ≤480 square PNG
   *  before staging (same pipeline as App/H5). The cropped file is what
   *  gets previewed and uploaded, so the preview matches the final avatar
   *  and the upload is always small (no pre-crop size cap needed — the
   *  provider still guards the final size as defense-in-depth). */
  const onPickFile = async (file: File | null) => {
    if (file === null) return;
    if (!AVATAR_ALLOWED_MIMES.includes(file.type)) {
      setError(t('profile_edit.avatar_error_mime'));
      return;
    }
    let cropped: File;
    try {
      cropped = await prepareAvatarImage(file);
    } catch (err) {
      captureException(err, { source: 'profile-edit.avatar-crop' });
      setError(t('profile_edit.avatar_error_mime'));
      return;
    }
    // Revoke previous preview if any to avoid leaking blob URLs.
    if (pendingAvatar !== null) {
      URL.revokeObjectURL(pendingAvatar.previewUrl);
    }
    setError(null);
    setPendingAvatar({
      file: cropped,
      previewUrl: URL.createObjectURL(cropped),
    });
  };

  const onSubmit = async () => {
    if (!canSave || form === null || original === null) return;
    // Validate locally (server validates too; client catches obvious cases
    // to avoid a 400 round-trip).
    if (form.nickname.trim().length < 2) {
      setError(t('profile_edit.error_nickname_too_short'));
      return;
    }
    if (form.nickname.trim().length > 32) {
      setError(t('profile_edit.error_nickname_too_long'));
      return;
    }
    if (form.bio.length > 200) {
      setError(t('profile_edit.error_bio_too_long'));
      return;
    }
    if (form.birthday !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(form.birthday)) {
      setError(t('profile_edit.error_birthday_format'));
      return;
    }
    setBusy(true);
    setError(null);
    setSavedFlash(false);
    // We track the latest server-bound avatar URL through this local var
    // so we can correctly stamp `original` at the end. If avatar didn't
    // change, this stays as the old original.avatar.
    let nextAvatarUrl = original.avatar;
    try {
      // R8.4d-2: avatar first. Two-step:
      //   1) uploadAvatar(file)  → multipart POST /infra/file/upload
      //   2) updateAvatar(fileId) → PUT /member/user/update-avatar
      // Order is intentional — if upload succeeds but update fails, the
      // fileId is still valid for retry (server keeps the file row),
      // so the user can click Save again without re-picking. The dialog
      // keeps `pendingAvatar` until the BOTH steps succeed.
      if (pendingAvatar !== null) {
        const uploaded = await provider.uploadAvatar?.(pendingAvatar.file);
        if (uploaded === undefined) {
          throw new Error('uploadAvatar not supported in this account mode');
        }
        await provider.updateAvatar?.(uploaded.fileId);
        nextAvatarUrl = uploaded.url;
        URL.revokeObjectURL(pendingAvatar.previewUrl);
        setPendingAvatar(null);
      }
      // Per-field PUT, only for changed fields (single-responsibility
      // server endpoints + change-aware hook firing).
      if (form.nickname.trim() !== original.nickname) {
        await provider.updateNickname(form.nickname.trim());
      }
      if (form.bio !== original.bio) {
        // Treat empty input as clear (null on the wire).
        await provider.updateBio?.(form.bio === '' ? null : form.bio);
      }
      if (form.gender !== original.gender) {
        await provider.updateGender?.(form.gender);
      }
      if (form.birthday !== original.birthday) {
        await provider.updateBirthday?.(
          form.birthday === '' ? null : form.birthday,
        );
      }
      // Successful save — promote form snapshot to "original" so the
      // change-detection resets without re-fetching.
      const promoted: FormState = {
        ...form,
        nickname: form.nickname.trim(),
        avatar: nextAvatarUrl,
      };
      setOriginal(promoted);
      setForm(promoted);
      setSavedFlash(true);
    } catch (err) {
      captureException(err, { source: 'profile-edit.save' });
      setError(translateError(err, t, 'save'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('profile_edit.title')}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            …
          </div>
        ) : form === null ? (
          // Load failed; error block below shows the message
          <div className="py-6 text-center text-sm text-muted-foreground">
            {/* placeholder */}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3" data-testid="profile-edit-avatar-row">
              {pendingAvatar !== null ? (
                <img
                  src={pendingAvatar.previewUrl}
                  alt=""
                  className="h-16 w-16 rounded-full object-cover border"
                  data-testid="profile-edit-avatar-preview"
                />
              ) : form.avatar !== '' ? (
                <img
                  src={form.avatar}
                  alt=""
                  className="h-16 w-16 rounded-full object-cover border"
                  data-testid="profile-edit-avatar-current"
                />
              ) : (
                <Avatar
                  seed="self"
                  label={form.nickname || '?'}
                  size="lg"
                />
              )}
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="profile-edit-avatar-pick"
                >
                  <Camera className="h-3 w-3 mr-1" />
                  {t('profile_edit.avatar_pick')}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {t('profile_edit.avatar_hint')}
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={AVATAR_ALLOWED_MIMES.join(',')}
                className="hidden"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0] ?? null;
                  // Reset the input so picking the same file twice still
                  // triggers onChange (browsers no-op on identical value).
                  e.currentTarget.value = '';
                  void onPickFile(file);
                }}
                data-testid="profile-edit-avatar-input"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-edit-nickname">
                {t('profile_edit.nickname_label')}
              </Label>
              <Input
                id="profile-edit-nickname"
                value={form.nickname}
                onChange={(e) =>
                  setForm({ ...form, nickname: e.currentTarget.value })
                }
                disabled={busy}
                data-testid="profile-edit-nickname"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-edit-bio">
                {t('profile_edit.bio_label')}
              </Label>
              <textarea
                id="profile-edit-bio"
                rows={3}
                maxLength={200}
                placeholder={t('profile_edit.bio_placeholder')}
                value={form.bio}
                onChange={(e) =>
                  setForm({ ...form, bio: e.currentTarget.value })
                }
                disabled={busy}
                data-testid="profile-edit-bio"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <div className="text-xs text-muted-foreground text-right">
                {form.bio.length} / 200
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t('profile_edit.gender_label')}</Label>
              <div className="flex gap-2 flex-wrap" data-testid="profile-edit-gender">
                {GENDER_OPTIONS.map(({ value, labelKey }) => (
                  <Button
                    key={value}
                    type="button"
                    variant={form.gender === value ? 'default' : 'outline'}
                    size="sm"
                    disabled={busy}
                    onClick={() => setForm({ ...form, gender: value })}
                    data-testid={`profile-edit-gender-${value}`}
                  >
                    {t(labelKey)}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-edit-birthday">
                {t('profile_edit.birthday_label')}
              </Label>
              <Input
                id="profile-edit-birthday"
                type="date"
                value={form.birthday}
                onChange={(e) =>
                  setForm({ ...form, birthday: e.currentTarget.value })
                }
                disabled={busy}
                data-testid="profile-edit-birthday"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                {t('profile_edit.cancel')}
              </Button>
              <Button
                variant="default"
                onClick={() => void onSubmit()}
                disabled={!canSave}
                data-testid="profile-edit-save"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {t('profile_edit.saving')}
                  </>
                ) : (
                  t('profile_edit.save')
                )}
              </Button>
            </div>
          </div>
        )}
        {savedFlash && error === null && (
          <p
            className="text-xs text-emerald-600"
            data-testid="profile-edit-saved-flash"
          >
            {t('profile_edit.saved')}
          </p>
        )}
        {error !== null && (
          <p
            className={cn('text-sm text-destructive')}
            data-testid="profile-edit-error"
          >
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

const GENDER_OPTIONS: Array<{ value: number; labelKey: string }> = [
  { value: 0, labelKey: 'profile_edit.gender_unknown' },
  { value: 1, labelKey: 'profile_edit.gender_male' },
  { value: 2, labelKey: 'profile_edit.gender_female' },
  { value: 9, labelKey: 'profile_edit.gender_other' },
];

/** Map provider error class names to a user-facing string. */
function translateError(
  err: unknown,
  t: (k: string) => string,
  ctx: 'load' | 'save',
): string {
  const name = err instanceof Error ? err.name : 'Error';
  const message = err instanceof Error ? err.message : String(err);
  switch (name) {
    case 'PlatformApiError':
      // Server message is already user-facing per envelope convention.
      return message;
    case 'PlatformHttpError':
      return ctx === 'load'
        ? t('profile_edit.error_load')
        : t('profile_edit.error_network');
    case 'PlatformProtocolError':
      return t('profile_edit.error_protocol');
    case 'PlatformConfigError':
      return t('profile_edit.error_config');
    default:
      return ctx === 'load' ? t('profile_edit.error_load') : message;
  }
}
