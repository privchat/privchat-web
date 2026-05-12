// R8.4b — `AccountProfileProvider` seam.
//
// Reshaped from R8.1's `updateProfile(input)` lump into per-field methods
// matching the application's split `MemberUserController` endpoints
// (spec PLATFORM_PROFILE_HTTP_CONTRACT §3). R8.4b implements ONLY
// `getProfile` + `updateNickname` for both modes; the rest stay as
// optional + throw `NotImplementedYetError` until R8.4d (full profile
// editor) wires them.
//
// Real paths (curl-verified):
//   GET ${baseUrl}/app/member/user/get             (double /app/app)
//   PUT ${baseUrl}/app/member/user/update-nickname (double /app/app)
//
// baseUrl already contains `/app`. The double-/app stems from
// `MemberUserController` using an absolute `@Controller("/app/member/user")`
// annotation while AccountController/AuthController use relative paths;
// clients honor the real path, this isn't to be "fixed" client-side.

import type { AccountMode } from './account-mode';
import {
  getConfiguredAccountMode,
  getPlatformBaseUrl,
} from './account-mode';
import { normalizePlatformBaseUrl } from './platform-base-url';
import {
  getEnvelope,
  postMultipartEnvelope,
  putEnvelope,
  requireData,
} from './platform-envelope';
import { PlatformConfigError } from './platform-errors';
import { NotImplementedYetError } from './account-auth-provider';
import type { AccessTokenProvider } from './account-required-actions-provider';

/** Mirror of server `MemberProfile` DTO (camelCase, profile-only fields).
 *  `id` is widened to `string` at the boundary to avoid JS number
 *  precision near uid 2^53 (consistent with `LoginResult.userId`). */
export interface MemberProfile {
  id: string;
  mobile?: string;
  /** Server-side @NotBlank @Size(2..32); never null on the wire. */
  nickname: string;
  avatar?: string;
  username?: string;
  /** millis */
  usernameUpdatedAt?: number;
  /** 0=unknown / 1=male / 2=female / 9=other */
  gender: number;
  /** ≤ 200 chars */
  bio?: string;
  /** ISO YYYY-MM-DD */
  birthday?: string;
}

export interface UpdateUsernameResult {
  username: string;
  /** millis — next allowed change timestamp (30-day rate limit). */
  nextChangeAvailableAt: number;
}

/** R8.4d-2 — `POST /infra/file/upload` response data. Fields match native
 *  client `UploadedFile` (PlatformProfileApi.kt). UI typically only needs
 *  `fileId` (for `updateAvatar`) and `url` (for preview), but the rest is
 *  echoed for parity / future diagnostic use. */
export interface UploadedFile {
  fileId: string;
  url: string;
  businessType: string;
  mimeType: string;
  size: number;
}

/** R8.4d-2 — client-side avatar constraints. Server policy is the
 *  authoritative gate; these are UX-level pre-checks to avoid sending
 *  a guaranteed-rejected upload and to give an immediate error toast.
 *  Mirrors MODULE_MEMBER_PROFILE_SPEC §4.2 constraints. */
export const AVATAR_ALLOWED_MIMES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];
export const AVATAR_MAX_SIZE_BYTES = 5 * 1024 * 1024;

export interface AccountProfileProvider {
  readonly mode: AccountMode;
  /** R8.4b required. */
  getProfile(): Promise<MemberProfile>;
  /** R8.4b required. The sole nickname submission path. RequiredAction
   *  `complete_profile` (R8.4c) calls this; R8.4d profile editor too. */
  updateNickname(nickname: string): Promise<void>;
  /** R8.4d-2. multipart `POST /infra/file/upload` (single `/app` layer).
   *  Returns full `UploadedFile` for callers that want size / mime back. */
  uploadAvatar?(file: File): Promise<UploadedFile>;
  /** R8.4d-2. `PUT /app/member/user/update-avatar` (double `/app/app`).
   *  `fileId` comes from `uploadAvatar` result. */
  updateAvatar?(fileId: string): Promise<void>;
  /** R8.4d. @FreshAuth + 30-day rate limit. */
  updateUsername?(username: string): Promise<UpdateUsernameResult>;
  /** R8.4d. null/'' = clear. */
  updateBio?(bio: string | null): Promise<void>;
  /** R8.4d. */
  updateGender?(gender: number): Promise<void>;
  /** R8.4d. ISO YYYY-MM-DD or null. */
  updateBirthday?(birthday: string | null): Promise<void>;
}

/** Identifiable so UI can show "this build doesn't support editing" rather
 *  than a generic toast. */
export class ProfileEditNotSupportedError extends Error {
  override readonly name = 'ProfileEditNotSupportedError';
  constructor(public readonly method: string) {
    super(`profile.${method} is not supported under builtin mode`);
  }
}

export class BuiltinProfileProvider implements AccountProfileProvider {
  readonly mode = 'builtin' as const;

  /** R8.4b: BUILTIN throws — capability gate (`profileEdit: false`)
   *  hides the affordance entirely. R8.4d may wire a cache-backed read
   *  if a "view my own profile" panel is added under BUILTIN. */
  async getProfile(): Promise<MemberProfile> {
    throw new ProfileEditNotSupportedError('getProfile');
  }

  async updateNickname(_nickname: string): Promise<void> {
    throw new ProfileEditNotSupportedError('updateNickname');
  }
}

interface UpdateUsernameWireResult {
  username: string;
  nextChangeAvailableAt: number;
}

interface FileUploadWireResult {
  fileId: string;
  url: string;
  businessType?: string;
  mimeType?: string;
  size?: number;
}

export class PlatformProfileProvider implements AccountProfileProvider {
  readonly mode = 'platform' as const;
  readonly baseUrl: string;

  /** Resolves the active session's access token at each call. Callback
   *  rather than fixed string so R7 account switches and R8.3 refresh
   *  rotations are picked up without re-instantiating the provider. */
  constructor(
    baseUrl: string,
    private readonly getAccessToken: AccessTokenProvider,
  ) {
    this.baseUrl = normalizePlatformBaseUrl(baseUrl);
  }

  private requireToken(): string {
    const token = this.getAccessToken();
    if (typeof token !== 'string' || token === '') {
      throw new PlatformConfigError(
        'PlatformProfileProvider requires an active access token',
      );
    }
    return token;
  }

  async getProfile(): Promise<MemberProfile> {
    const data = requireData(
      await getEnvelope<MemberProfileWire>(
        `${this.baseUrl}/app/member/user/get`,
        this.requireToken(),
      ),
      'profile.get',
    );
    return {
      id: String(data.id),
      mobile: data.mobile,
      nickname: data.nickname,
      avatar: data.avatar,
      username: data.username,
      usernameUpdatedAt: data.usernameUpdatedAt,
      gender: typeof data.gender === 'number' ? data.gender : 0,
      bio: data.bio,
      birthday: data.birthday,
    };
  }

  async updateNickname(nickname: string): Promise<void> {
    const trimmed = nickname.trim();
    if (trimmed.length < 2 || trimmed.length > 32) {
      // Client-side sanity. Server will also enforce; this just keeps
      // a 400 round-trip out of the happy path.
      throw new PlatformConfigError(
        `updateNickname: nickname must be 2-32 chars after trim (got ${trimmed.length})`,
      );
    }
    await putEnvelope<unknown>(
      `${this.baseUrl}/app/member/user/update-nickname`,
      this.requireToken(),
      { nickname: trimmed },
    );
  }

  /** R8.4d-2 — multipart `POST {baseUrl}/infra/file/upload` (single `/app`
   *  layer; `infra/file` controller uses an absolute `@Controller("/infra/file")`
   *  annotation, NOT the `/app/member/...` style). Two-step semantics: the
   *  caller is expected to invoke [updateAvatar] separately after this
   *  returns — uploading does NOT auto-bind the avatar to the member.
   *
   *  Client guard: mime ∈ AVATAR_ALLOWED_MIMES, size ≤ AVATAR_MAX_SIZE_BYTES.
   *  Server policy is the authoritative gate (`FileBusinessPolicyRegistry`
   *  in module-infra); these checks just avoid guaranteed-reject round-trips. */
  async uploadAvatar(file: File): Promise<UploadedFile> {
    if (!AVATAR_ALLOWED_MIMES.includes(file.type)) {
      throw new PlatformConfigError(
        `uploadAvatar: mime "${file.type}" not allowed (need jpeg/png/webp)`,
      );
    }
    if (file.size > AVATAR_MAX_SIZE_BYTES) {
      throw new PlatformConfigError(
        `uploadAvatar: size ${file.size} exceeds ${AVATAR_MAX_SIZE_BYTES} bytes`,
      );
    }
    const form = new FormData();
    form.append('businessType', 'member_avatar');
    // Browser-native File carries its own name + mime, which it passes
    // through FormData automatically. Server's `AppFileController` reads
    // the file-part headers; no extra setup needed here.
    form.append('file', file);
    return requireData(
      await postMultipartEnvelope<UploadedFile>(
        `${this.baseUrl}/infra/file/upload`,
        this.requireToken(),
        form,
      ),
      'avatar.upload',
    );
  }

  /** R8.4d-2 — `PUT {baseUrl}/app/member/user/update-avatar` (double `/app/app`
   *  per `MemberUserController` annotation style; same path quirk as
   *  `update-nickname` / `update-bio` etc.). Server logic validates that the
   *  `fileId` exists, is owned by the caller, is status=active, and has
   *  `business_type == "member_avatar"` — see MODULE_MEMBER_PROFILE_SPEC §4.3. */
  async updateAvatar(fileId: string): Promise<void> {
    const trimmed = fileId.trim();
    if (trimmed === '') {
      throw new PlatformConfigError('updateAvatar: fileId is empty');
    }
    await putEnvelope<unknown>(
      `${this.baseUrl}/app/member/user/update-avatar`,
      this.requireToken(),
      { fileId: trimmed },
    );
  }

  async updateUsername(_username: string): Promise<UpdateUsernameResult> {
    throw new NotImplementedYetError('PlatformProfileProvider.updateUsername');
  }

  /** R8.4d-1 — HTTP PUT /app/member/user/update-bio.
   *  Server validation: @Size(max = 200). null/'' = clear. */
  async updateBio(bio: string | null): Promise<void> {
    const payload = bio === null ? null : bio.trim();
    if (payload !== null && payload.length > 200) {
      throw new PlatformConfigError(
        `updateBio: bio must be at most 200 chars after trim (got ${payload.length})`,
      );
    }
    await putEnvelope<unknown>(
      `${this.baseUrl}/app/member/user/update-bio`,
      this.requireToken(),
      // Server data class `UpdateMemberBioRequest(bio: String? = null)` accepts
      // null OR empty string as "clear". We send `null` for empty so it survives
      // explicit-null serialization quirks.
      { bio: payload === '' ? null : payload },
    );
  }

  /** R8.4d-1 — HTTP PUT /app/member/user/update-gender.
   *  Server accepts only {0,1,2,9}. */
  async updateGender(gender: number): Promise<void> {
    if (![0, 1, 2, 9].includes(gender)) {
      throw new PlatformConfigError(
        `updateGender: gender must be 0/1/2/9 (got ${gender})`,
      );
    }
    await putEnvelope<unknown>(
      `${this.baseUrl}/app/member/user/update-gender`,
      this.requireToken(),
      { gender },
    );
  }

  /** R8.4d-1 — HTTP PUT /app/member/user/update-birthday.
   *  ISO YYYY-MM-DD string or null. Server stores as VARCHAR(10) to avoid
   *  timezone ambiguity (spec MODULE_MEMBER_PROFILE_SPEC §2). */
  async updateBirthday(birthday: string | null): Promise<void> {
    const payload = birthday === null ? null : birthday.trim();
    if (payload !== null && payload !== '' && !ISO_DATE_RE.test(payload)) {
      throw new PlatformConfigError(
        `updateBirthday: must be ISO YYYY-MM-DD (got "${payload}")`,
      );
    }
    await putEnvelope<unknown>(
      `${this.baseUrl}/app/member/user/update-birthday`,
      this.requireToken(),
      { birthday: payload === '' ? null : payload },
    );
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Raw wire shape for `GET /app/member/user/get` envelope `data`. */
interface MemberProfileWire {
  id: number;
  mobile?: string;
  nickname: string;
  avatar?: string;
  username?: string;
  usernameUpdatedAt?: number;
  gender?: number;
  bio?: string;
  birthday?: string;
}

let cachedProvider: AccountProfileProvider | null = null;

export function getProfileProvider(
  getAccessToken: AccessTokenProvider,
): AccountProfileProvider {
  if (cachedProvider !== null) return cachedProvider;
  const mode = getConfiguredAccountMode();
  if (mode === 'platform') {
    const baseUrl = getPlatformBaseUrl();
    if (baseUrl === null) {
      throw new PlatformConfigError(
        'VITE_PRIVCHAT_PLATFORM_BASE_URL is required when VITE_PRIVCHAT_ACCOUNT_MODE=platform',
      );
    }
    cachedProvider = new PlatformProfileProvider(baseUrl, getAccessToken);
  } else {
    cachedProvider = new BuiltinProfileProvider();
  }
  return cachedProvider;
}

/** Test-only reset. */
export function __resetProfileProviderForTests(): void {
  cachedProvider = null;
}
