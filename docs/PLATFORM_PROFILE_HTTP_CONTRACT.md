# Platform Profile HTTP Contract — Web Mapping (R8.4a)

> Status: Frozen for R8.4b/d implementation
> Parent design: [PLATFORM_ACCOUNT_MODE_DESIGN.md](./PLATFORM_ACCOUNT_MODE_DESIGN.md) (R8.0 + R8.2c amendments)
> Sibling contracts:
> - [PLATFORM_AUTH_HTTP_CONTRACT.md](./PLATFORM_AUTH_HTTP_CONTRACT.md) (R8.2b) — auth endpoints
> - [PLATFORM_REQUIRED_ACTIONS_CONTRACT.md](./PLATFORM_REQUIRED_ACTIONS_CONTRACT.md) (R8.4a) — gate mechanism
> Authoritative upstream specs:
> - `privchat-docs/spec/07-application/MODULE_MEMBER_PROFILE_SPEC.md` v1.1
> - `privchat-docs/spec/01-global/ACCOUNT_IDENTITY_SPEC.md` v1.2
> Authoritative implementations:
> - `privchat-application-module-member` `MemberUserController.kt` + `MemberProfileLogic.kt` (server side)
> - `privchat-app/.../platform/profile/PlatformProfileApiImpl.kt` (canonical native client; **mirror this**)

---

## 0. Scope

This document covers **only** the application member profile HTTP API (`/member/user/*`) — endpoints, request/response shapes, errors, authorization. The cross-cutting **profile completion gate** mechanism that uses `updateNickname` lives in
[PLATFORM_REQUIRED_ACTIONS_CONTRACT.md](./PLATFORM_REQUIRED_ACTIONS_CONTRACT.md) — that document owns when/why the gate fires; this one owns what `updateNickname` looks like over the wire.

R8.4 only required `getProfile` + `updateNickname` for the gate's first action (`complete_profile.nickname`). Other endpoints are listed for R8.4d (full profile editor) but not implemented in R8.4b.

---

## 1. Key facts (read first)

### 1.1 Path prefix convention
Framework mounts every `/app` route group's controllers with an `/app` prefix; controller annotations use **business prefix only** (`@Controller("/member/user")`, `@Controller("/auth")`, `@Controller("/account")` etc., **never** `/app/...`). Web client builds URLs as:

```
${baseUrl}/member/user/...
```

where `baseUrl = https://app.example.com/app` (R8.2b convention, includes `/app` already, or 子域名 `https://app-api.example.com/` 承担同一语义). Verified by curl:

```
GET /member/user/get      → 404 (no /app prefix)
GET /member/user/get  → 401 (path exists, needs token)
```

Prior `MemberUserController` annotation used to write `@Controller("/member/user")` (absolute), producing a double `/app/member/user/...` mount; that was a historical quirk that's been cleaned up 2026-06-02. Clients must write single-layer paths only.

### 1.2 Authorization
All endpoints require `Authorization: Bearer <accessToken>`. Token is the unified token from R8.3 (HTTP + IM use the same one). 401 → trigger `refreshToken` from R8.3a; refresh fails → `clearSession()` + back to LoginPage.

### 1.3 Envelope
`{ code: number, message?: string, data?: T }`, success means `code === 0`. Identical to R8.2b auth contract.

### 1.4 JSON naming
camelCase (`accessToken` / `nicknameUpdatedAt` / `fileId` / `gender` / `birthday`). Matches kotlinx.serialization defaults.

---

## 2. ProfileProvider contract (Web seam)

### 2.1 Interface

R8.4b in `src/lib/account-profile-provider.ts`. **v1 only `getProfile` + `updateNickname` are implemented**; other methods are signature-only stubs that throw, kept on the interface so R8.4d adds bodies without changing call sites.

```ts
export interface MemberProfile {
  id: string;            // uid, stringified to avoid JS number precision
  mobile?: string;       // E.164
  nickname: string;      // server @NotBlank @Size(2..32); never null
  avatar?: string;       // full URL
  username?: string;
  usernameUpdatedAt?: number; // millis
  gender: number;        // 0=unknown / 1=male / 2=female / 9=other
  bio?: string;          // max 200 chars
  birthday?: string;     // ISO YYYY-MM-DD
}

export interface UpdateUsernameResult {
  username: string;
  nextChangeAvailableAt: number;  // millis
}

export interface AccountProfileProvider {
  readonly mode: AccountMode;
  /** R8.4b. GET /member/user/get */
  getProfile(): Promise<MemberProfile>;
  /** R8.4b. PUT /member/user/update-nickname.
   *  Sole nickname submission path. RequiredActionFlow's
   *  CompleteProfileAction calls this; full profile editor (R8.4d) too. */
  updateNickname(nickname: string): Promise<void>;
  /** R8.4d. POST /infra/file/upload (multipart). */
  uploadAvatar?(file: File): Promise<{ fileId: string; url: string }>;
  /** R8.4d. PUT /member/user/update-avatar */
  updateAvatar?(fileId: string): Promise<void>;
  /** R8.4d. PUT /member/user/update-username. @FreshAuth + 30-day rate limit */
  updateUsername?(username: string): Promise<UpdateUsernameResult>;
  /** R8.4d. PUT /member/user/update-bio. null/'' = clear */
  updateBio?(bio: string | null): Promise<void>;
  /** R8.4d. PUT /member/user/update-gender. one of {0,1,2,9} */
  updateGender?(gender: number): Promise<void>;
  /** R8.4d. PUT /member/user/update-birthday. ISO YYYY-MM-DD or null */
  updateBirthday?(birthday: string | null): Promise<void>;
}
```

### 2.2 BUILTIN vs PLATFORM impl

| Method | BUILTIN | PLATFORM v1 |
|---|---|---|
| `getProfile` | Read self UserRecord from IM SDK cache; map to MemberProfile (no mobile/bio/gender/birthday) | HTTP `GET /member/user/get` |
| `updateNickname` | throw `ProfileEditNotSupportedError` | HTTP `PUT /member/user/update-nickname` |
| Others | throw `ProfileEditNotSupportedError` | R8.4d implements |

UI gates by `typeof provider.updateNickname === 'function'` and result of the call, not by reading the mode constant. Capability gate is consistent with R8.0 §"Capability gate".

### 2.3 Factory

R8.1 already shipped a placeholder `getProfileProvider()` in `src/lib/account-profile-provider.ts`. R8.4b instantiates `PlatformProfileProvider` with `(baseUrl, getAccessToken)`:
- `baseUrl`: from `getPlatformBaseUrl()`, normalized via `normalizePlatformBaseUrl` (R8.3a helper)
- `getAccessToken`: a callback returning the current session's `access_token`. Callback rather than fixed string so R7 active-session switches and refresh-token rotations are picked up live without re-instantiating the provider.

---

## 3. Endpoint table

| Method | Path (relative to baseUrl) | R8.4 scope | `@FreshAuth` | Notes |
|---|---|---|---|---|
| GET  | `/member/user/get` | **R8.4b required** | — | Returns full `MemberProfile` |
| PUT  | `/member/user/update-nickname` | **R8.4b required** | — | RequiredActionFlow uses this; sole nickname path |
| POST | `/infra/file/upload` | R8.4d | — | multipart, businessType=member_avatar; single `/app` layer (different controller annotation style) |
| PUT  | `/member/user/update-avatar` | R8.4d | — | Body `{fileId}` only; lookup-and-validate by logic layer |
| PUT  | `/member/user/update-username` | R8.4d | ✓ | 30-day rate limit; reserved-words; uniqueness; Web returns `{username, nextChangeAvailableAt}` |
| PUT  | `/member/user/update-bio` | R8.4d | — | `bio` null or `''` = clear |
| PUT  | `/member/user/update-gender` | R8.4d | — | int 0/1/2/9 |
| PUT  | `/member/user/update-birthday` | R8.4d | — | ISO YYYY-MM-DD or null |

Mobile / password / SMS endpoints (`update-mobile` / `update-password` / `reset-password` / `send-sms-code`) are **out of scope** — they're auth-side flows already covered by R8.3 / R8.4 doesn't touch them.

---

## 4. `GET /member/user/get`

### 4.1 Request

No body. Headers:
```
Authorization: Bearer <accessToken>
```

### 4.2 Response

```jsonc
{
  "code": 0,
  "message": null,
  "data": {
    "id": 100002079,
    "mobile": "+8615000000000",
    "nickname": "Member_0000",
    "avatar": null,
    "username": "user_100002079",
    "usernameUpdatedAt": null,
    "gender": 0,
    "bio": null,
    "birthday": null
  }
}
```

`data.id` is `Long` (number in JSON); Web maps to string at the provider boundary to match `MemberProfile.id: string`.

`data.nickname` is non-null per server contract. SMS auto-register seeds it as `Member_${mobile.takeLast(4)}` — Required Actions framework recognizes that pattern and surfaces a `complete_profile` action. See [PLATFORM_REQUIRED_ACTIONS_CONTRACT.md §5.2](./PLATFORM_REQUIRED_ACTIONS_CONTRACT.md).

---

## 5. `PUT /member/user/update-nickname`

### 5.1 Request

```
Authorization: Bearer <accessToken>
Content-Type: application/json
```
```jsonc
{ "nickname": "Alice" }
```

Validation (server side):
- `@NotBlank @Size(min = 2, max = 32)` annotation
- Logic layer also `nickname.trim().length in 2..32`

Web client should `nickname.trim()` before sending; reject empty client-side to avoid noisy server 400.

### 5.2 Response

```jsonc
{ "code": 0, "message": null, "data": null }
```

> Spec MODULE_MEMBER_PROFILE_SPEC §4.1 documents `data: { nickname }`, but native client `PlatformProfileApiImpl.putUnit` treats `data` as optional. Web matches: ignore `data`, only check `code === 0`.

### 5.3 Server-side side effects (Web doesn't see)

- Writes `member_users.nickname`
- Publishes `MemberProfileChangedHook(uid, changedFields = {"nickname"}, ...)`
- v2-future: first successful update sets `member_users.profile_completed_at = now()` (cleaner Required Actions signal source than nickname pattern matching)

### 5.4 Error mapping

Reuses R8.3a `PlatformError` taxonomy:

| Source | Class | UI |
|---|---|---|
| HTTP 4xx (non-401) | `PlatformHttpError(status, msg)` | i18n generic network error |
| HTTP 401 | `PlatformHttpError(401)` | trigger refreshToken; failure → clearSession |
| HTTP 5xx | `PlatformHttpError(status, msg)` | network error + retry button |
| envelope `code !== 0` (e.g. `INVALID_NICKNAME_LENGTH`) | `PlatformApiError(code, message)` | `message` passes through verbatim |
| JSON parse fail | `PlatformProtocolError(msg)` | i18n protocol error |

---

## 6. R8.4d endpoints (signatures only, not implemented in R8.4b)

Documented for completeness; bodies land in R8.4d. Each follows the same pattern: `PUT ${baseUrl}/member/user/update-<field>` + Bearer + JSON body + envelope response with `data: null`. The Kotlin source of truth is `MemberUserController.kt`.

### 6.1 `PUT /member/user/update-avatar`
Body: `{ fileId: string }` (returned from §6.2). Server validates: file exists, status=active, `owner_uid == caller`, `business_type == "member_avatar"`. Failures map to `PlatformApiError("AVATAR_FILE_NOT_FOUND" / "AVATAR_FILE_INACTIVE" / "INVALID_AVATAR_BUSINESS_TYPE")`.

### 6.2 `POST /infra/file/upload`
Multipart with `file` + `businessType=member_avatar`. **Single `/app` layer** in URL (`AppFileController` annotation style different from `MemberUserController`). Returns `{ fileId, url, businessType, mimeType, size }`. Constraints: mime ∈ `{image/jpeg, image/png, image/webp}`, size ≤ 5 MB.

### 6.3 `PUT /member/user/update-username`
Body: `{ username: string }`. Server enforces 30-day rate limit + uniqueness + reserved-words + `@FreshAuth` (recent token). Response: `{ username, nextChangeAvailableAt: number }`. Map to `UpdateUsernameResult`. Username has its own UX (separate page in R8.4d, NOT part of any Required Action) per `PLATFORM_REQUIRED_ACTIONS_CONTRACT.md` §4.2.

### 6.4 `PUT /member/user/update-bio`
Body: `{ bio: string | null }`. Validation: `@Size(max = 200)`. null/`''` = clear.

### 6.5 `PUT /member/user/update-gender`
Body: `{ gender: number }`. Allowed: `0` (unknown), `1` (male), `2` (female), `9` (other). Server returns 400 for other values.

### 6.6 `PUT /member/user/update-birthday`
Body: `{ birthday: string | null }`. Format `YYYY-MM-DD` (string, not date — avoids cross-platform timezone ambiguity). null/`''` = clear.

---

## 7. R8.4 round split (re-confirmed)

| Round | Scope | Key deliverables |
|---|---|---|
| **R8.4a** | This doc + [PLATFORM_REQUIRED_ACTIONS_CONTRACT.md](./PLATFORM_REQUIRED_ACTIONS_CONTRACT.md) | Profile API contract + Required Actions contract (cross-cutting gate mechanism) |
| R8.4a-server | server side | Add `requiredActions` to LoginResponse + new `GET /app/account/required-actions` controller. **No schema changes**. Owned by application repo |
| **R8.4b** | feat(web): provider impls | `PlatformProfileProvider.getProfile + updateNickname`; `RequiredActionsProvider.list()`; reuse R8.3a envelope/error helpers |
| **R8.4c** | feat(web): RequiredActionFlow + CompleteProfileAction | App.tsx state machine; localStorage pending; auto-login re-check; i18n; 13-case smoke |
| R8.4d | feat(web): full profile editor UI | ChatWorkspace top bar entry + every field editor (avatar / username / bio / gender / birthday) |

---

## 8. One-line summary

PLATFORM Web client talks to application via `${baseUrl}/member/user/*` with Bearer unified token; envelope `{code,message,data}` matches R8.2b; v1 only requires `getProfile` + `updateNickname` to support the Required Actions framework's first action (`complete_profile.nickname`); other field-update endpoints are R8.4d's job.
