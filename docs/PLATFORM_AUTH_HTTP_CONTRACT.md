# Platform Auth HTTP Contract — Web Mapping (R8.2b)

> Status: Frozen for R8.3 implementation
> Parent design: [PLATFORM_ACCOUNT_MODE_DESIGN.md](./PLATFORM_ACCOUNT_MODE_DESIGN.md) (R8.0)
> Authoritative upstream specs:
> - `privchat-docs/spec/05-feature/TOKEN_UNIFICATION_SPEC.md` v1.3
> - `privchat-docs/spec/01-global/ACCOUNT_IDENTITY_SPEC.md` v1.2 — **partly superseded** by TOKEN_UNIFICATION (see §1.3)
> Authoritative implementations:
> - `privchat-application-module-member` `AuthController.kt` + `MemberAuthLogic.kt` (server side)
> - `privchat-app/.../PlatformAccountLoginImpl.kt` (canonical native client; **mirror this**)

---

## 0. 文档目的

R8.2b 不写代码。本文档把 PLATFORM 模式下 Web 要调的 HTTP 接口的 **request / response / 错误 / token 语义 / 速率限制** 全部冻结成一份 Web 视角的 mapping note，让 R8.3 实现 `PlatformAuthProvider` 时不需要再回去翻 spec / 翻 Kotlin 代码。

R8.0 design note 已经定了：能力矩阵、Provider 接口、UI capability gate、一阶段 round 拆分。本文档**不重复**这些内容，只补 R8.0 没下沉到字节级的 HTTP 部分。

---

## 1. 关键结论（写在最前）

### 1.1 单一 unified token，HTTP + IM 通用

`accessToken` 由 `privchat-server` 用 RS256 签发，`aud` 同时含 `privchat-application` 和 `privchat-server`：

- application HTTP `/app/*`：`Authorization: Bearer <accessToken>`
- IM WebSocket `AuthorizationRequest`：直接用同一个 `accessToken`

**Web SDK 不需要"先调 application 拿 imToken 再连 IM"的两跳**。`LoginResult.accessToken` 直接喂 `client.authenticate(accessToken)` 或等价的 SDK 入口。

### 1.2 没有 `imToken` / `imRefreshToken` / `imDeviceId` 字段

服务端已收口（见 `privchat-application-module-member/.../MemberLoginResponse.kt` 头注释："严禁字段：im_token / im_refresh_token / im_device_id"）。Web 的 `LoginResult` 不要为这几个字段留位置。

### 1.3 ACCOUNT_IDENTITY_SPEC §5 的"双 token 模型"已被 TOKEN_UNIFICATION supersede

ACCOUNT_IDENTITY_SPEC v1.2 §5 描述的"application token + im token 各一对"已经过时；§9 描述的 `/auth/privchat-token-issue` 在 unified token 之后**不再需要客户端调用**（仅作为 server 内部 fallback 保留）。Web 不要实现这个端点的客户端。

### 1.4 baseUrl 约定

`VITE_PRIVCHAT_PLATFORM_BASE_URL` 必须形如 `https://app.example.com/app`：

- **包含** application 的 `/app` 路由组前缀
- **不**带尾斜杠
- Web 客户端只在末尾拼 controller 级路径，如 `${baseUrl}/auth/sms-login`

这与 native `PlatformAccountLoginImpl` 的 `baseUrl` 契约 **byte-for-byte 一致**。R8.0 design note §"How the Web app talks to platform" 行 203 已经写过这条约定，本文档把它正式钉死。

### 1.5 Response envelope

所有 application HTTP 端点统一返回：

```jsonc
{ "code": 0, "message": null, "data": <T> | null }
```

- `code === 0` 表示成功；非 0 表示业务错误，从 `message` 取错误文案
- HTTP 状态码本身一般是 200（业务错误也用 envelope 表达；只有 5xx 是真传输错误）
- 4xx 仍可能出现（如鉴权失败、参数 schema 错），此时 envelope 可能不完整，按 HTTP 状态码兜底

native `PlatformAccountLoginImpl` 用的 `PlatformEnvelope<T>` + `requireOk()` 即此契约的引用实现。

---

## 2. Endpoint 表

| Method | Path（相对 baseUrl） | 用途 | R8.3 范围 | Rate limit (server) |
|--------|---------------------|------|-----------|---------------------|
| POST | `/auth/login` | 手机号 + 密码登录 | R8.3a（待产品决策，见 §11.1） | 10 / 5min / IP |
| POST | `/auth/sms-login` | 手机号 + SMS 登录（首次即注册） | **R8.3b 必做** | 5 / 60s / IP |
| POST | `/auth/send-sms-code` | 发送登录 SMS 码 | **R8.3b 必做** | 5 / 60s / IP |
| POST | `/auth/validate-sms-code` | 仅校验 SMS 码（不消费） | 不必（loginWithSms 内部已校验） | 5 / 60s / IP |
| POST | `/auth/refresh-token` | unified token 续期 | **R8.3 内做** | （未限） |
| POST | `/auth/logout` | 登出（黑名单当前 token） | R8.3 之外 | （未限） |
| POST | `/auth/social-login` | 社交登录 | R8.4+ | 10 / 5min / IP |
| GET  | `/auth/social-auth-redirect` | 社交跳转 URL | R8.4+ | （未限） |

> 速率限制是 **server 侧** 的，不是 Web 侧的。Web 收到限流响应（envelope 里非零 code 或 HTTP 429）时按 §6 处理。

---

## 3. 请求 / 响应 DTO

所有字段名为 **camelCase**（kotlinx.serialization 默认）。所有数值型 ID（如 `userId`）是 `Long`，JSON 里是 number。`mobile` 是 E.164 字符串（`+` 加 8–15 位数字）。

### 3.1 `POST /auth/sms-login`

请求：

```jsonc
{
  "mobile": "+8613800138000",
  "smsCode": "123456",
  "device": {
    "deviceId": "<uuid v4，与 localStorage 中持久化的 device_id 一致>",
    "deviceName": "Chrome on macOS",   // 可选
    "platform":   "web",               // 可选；建议固定 "web"
    "deviceModel": null,               // 可选
    "osVersion":   "macOS 14.4",       // 可选
    "appVersion":  "0.0.0",            // 可选
    "ipAddress":   null                // 可选；server 自己读 X-Forwarded-For
  }
}
```

> 服务端 `LoginDeviceInfo` 所有 device 字段都允许 null。`deviceId` 强烈建议带（保持与 `privchat_devices` 一致），缺省时 server 会按当前请求生成新 device_id 并通过响应回灌给客户端。

成功响应：见 §3.4 `LoginResponse`。

### 3.2 `POST /auth/login`（手机号 + 密码）

请求：

```jsonc
{
  "mobile":   "+8613800138000",
  "password": "<8–128 字符>",
  "device":   { ...同 §3.1 }
}
```

> 注意：用户名 `username` 字段**不存在**于 PLATFORM 模式。PLATFORM 的"账号"主键是手机号 E.164。BUILTIN 的 `username` 在 PLATFORM 这边不通用。这是 Web `LoginPage` 在 PLATFORM 模式下要重新组织表单的原因（R8.3c）。

成功响应：同 §3.4。

### 3.3 `POST /auth/send-sms-code`

请求：

```jsonc
{
  "mobile": "+8613800138000",
  "scene": 1
}
```

| `scene` 值 | 语义 | 是否需要鉴权 | R8.3 用 |
|------------|------|--------------|---------|
| 1 | `MEMBER_LOGIN` 登录（含首次自动注册） | 匿名 | ✓ |
| 2 | `MEMBER_UPDATE_MOBILE` 修改手机 | 已登录 | × |
| 3 | `MEMBER_UPDATE_PASSWORD` 修改密码 | 已登录 | × |
| 4 | `MEMBER_RESET_PASSWORD` 忘记密码 | 匿名 | × （R8.3 不做） |

R8.3 只用 `scene=1`。改手机 / 改密码场景在已登录状态下走 `/member/user/send-sms-code`（不是 `/auth/send-sms-code`），R8 未必涉及。

成功响应：

```jsonc
{ "code": 0, "message": null, "data": null }
```

`data` 为 null。客户端只需看 `code === 0`。

### 3.4 `POST /auth/refresh-token`

请求：

```jsonc
{
  "refreshToken": "<原 refresh token>",
  "deviceId":     "<必须与 token claim 中的 device_id 一致>"
}
```

> `deviceId` 在 R8.3 阶段**必填**（server 侧 `MemberAuthLogic.refreshToken` 显式要求；缺则 BadRequest "device_id is required for refresh"）。Web 持久化 session 已有 `device_id` 字段，刷新时直接传。

成功响应：等同登录的 `LoginResponse`（新 access + 同一 refresh，phase A 不轮换 refresh）。

### 3.5 `LoginResponse`（统一形态，所有登录入口共用）

```jsonc
{
  "code": 0,
  "message": null,
  "data": {
    "userId":            900001,
    "accessToken":       "<RS256 JWT>",
    "refreshToken":      "<RS256 JWT>",
    "tokenType":         "Bearer",
    "expiresIn":         3600,            // access TTL 秒
    "refreshExpiresIn":  604800,          // refresh TTL 秒（默认 7d）
    "deviceId":          "<server 持久化的 device_id>",
    "sessionVersion":    3,               // 当前设备 session_version
    "deviceCreated":     false,           // true = 本次登录新建了 device 记录
    "scope":             ["user"],
    "issuer":            "privchat-server"
  }
}
```

强容错读取建议（与 native `PlatformMemberLoginResponse` 一致）：

| 字段 | Web 必读 | Web 可忽略 | 备注 |
|------|----------|-----------|------|
| `userId`           | ✓ | | 转字符串持久化（避免 JS number 精度） |
| `accessToken`      | ✓ | | 同时给 application HTTP + IM WebSocket |
| `refreshToken`     | ✓ | | 持久化以便后续 refresh |
| `deviceId`         | ✓ | | 回写到 `localStorage.privchat.web.session.<accountKey>` |
| `expiresIn`        | 推荐 | | 提前 refresh 用；R8.3 可不消费（IM 侧失效会触发被动 refresh） |
| `refreshExpiresIn` | 推荐 | | refresh 已过期时直接踢回 LoginPage |
| `sessionVersion`   | | ✓ | server 内部失效控制；Web 不需要本地比对 |
| `deviceCreated`    | | ✓ | UI 可选展示"已新增设备" |
| `tokenType`        | | ✓ | 固定 "Bearer" |
| `scope` / `issuer` | | ✓ | 信任服务端；Web 不二次校验 |

### 3.6 `POST /auth/logout`

R8.3 之外，但记录一下契约：

请求体为空（`userId` 从 token 解析）。响应 `{ code: 0, data: null }`。
作用：把当前 access token 的 `(uid)` 写入 server Redis 黑名单，TTL 与 access TTL 对齐（默认 1h）。
**不**等价于 `bumpSessions`：refresh token 仍可用直到自然过期；要全设备下线必须走 `/auth/refresh-token` 失效路径或专门的设备 revoke 接口（R8 之外）。

---

## 4. Token ownership 速查

| 概念 | 持有方 | Web 侧动作 |
|------|--------|-----------|
| `accessToken` | client（localStorage `privchat.web.session.<accountKey>`）| HTTP `Authorization: Bearer`；IM `client.authenticate()` |
| `refreshToken` | client（同上）| 仅在 access 失效时回 `/auth/refresh-token` |
| `deviceId` | server 权威 + client 本地 mirror | client 生成 v4 UUID 持久化于 localStorage；server 在第一次 issue 时落 `privchat_devices` |
| `sessionVersion` | server 权威 | Web 不感知；server 单边失效 |
| 签名公钥 (JWKS) | server 公开 `GET /api/service/auth/jwks` | Web 客户端 **不需要** 本地验签，直接信任服务端响应 |

**Web 不读 JWT claim**。R8.3 阶段没有 client-side token introspection；token 是不透明 bearer。

---

## 5. LoginResult 映射（Web 视角）

R8.1 的 `LoginResult` 接口已经在 `src/lib/account-auth-provider.ts`：

```ts
interface LoginResult {
  serverUrl: string;
  userId: string;
  accessToken: string;
  deviceId: string;
  accountMode: AccountMode;
  platformBaseUrl?: string;   // PLATFORM only
  refreshToken?: string;       // PLATFORM 必填，BUILTIN 不填
}
```

PLATFORM mapping（R8.3 实现时严格按此映射）：

| Web `LoginResult` 字段 | 来源 |
|----------------------|------|
| `serverUrl`        | `PasswordLoginInput.serverUrl` / `SmsLoginInput.serverUrl`（即 IM gateway WebSocket URL，**不是** platformBaseUrl）|
| `userId`           | `String(response.data.userId)` |
| `accessToken`      | `response.data.accessToken` |
| `deviceId`         | `response.data.deviceId` |
| `accountMode`      | 固定 `'platform'` |
| `platformBaseUrl`  | provider 构造时传入的 baseUrl（即 `VITE_PRIVCHAT_PLATFORM_BASE_URL`）|
| `refreshToken`     | `response.data.refreshToken` |

之后 R7.3 的 `App.tsx onLoggedIn` 路径不变；它把 `LoginResult` 转成 `PersistedSession` 存盘，再 `accountKey = sha256(serverUrl|userId).slice(0,16)`。

> **重要**：`serverUrl` 和 `platformBaseUrl` 是两个独立 URL。前者是 IM WebSocket（`ws://...`），后者是 application HTTP（`https://...`）。R8.3 之前 LoginPage 表单只暴露一个输入框（`serverUrl`），`platformBaseUrl` 来自 env 变量；这个分工保留。

---

## 6. 错误模型

### 6.1 Envelope 内业务错误

| 来源 | `code` | `message`（示例文案）| Web 处理 |
|------|--------|------------------|---------|
| `MemberAuthLogic.login` 凭证错 | 非 0（具体码 server 决定，目前抛 `BadRequestException`，HTTP 400 + envelope）| `"Invalid mobile or password"` | i18n key `login.error_login` 透传 |
| `verifySmsCode` 码过期 | 非 0 | `"SMS code expired or not sent"` | 同上 |
| `verifySmsCode` 码错 | 非 0 | `"Invalid SMS code"` | 同上 |
| `requireE164` 格式错 | 非 0 | `"E.164 format required (+ followed by 8–15 digits)"` | UI 应在提交前本地校验 |
| `MemberAuthLogic.smsLogin` 账号 disabled | 非 0 | `"Account is disabled"` | 同上 |
| `refreshToken` device 不匹配 | 非 0 | `"device_id is required for refresh"` 等 | 失败即视为 refresh 不可用 → 踢回 LoginPage |

### 6.2 HTTP 层错误

| 状态码 | 触发 | Web 处理 |
|--------|------|----------|
| 400 | 参数 schema 错（neton-validation 抛 BadRequestException）| 视同 envelope 错 |
| 401 | token 失效 / 验签失败 | refresh 一次；仍 401 → 踢回 LoginPage |
| 429 | 速率限制（`@RateLimit` 触发）| 显示"请稍后重试"，UI 不要再发 |
| 5xx | 服务端故障 | 通用错误提示 + 允许 UI 重试按钮 |

### 6.3 SMS 速率限制对 UI 的影响

server 限流 = **5 次 / 60s / IP**：

- 严格意义下 12s 一次的硬上限（5 次匀分）
- UI 侧建议倒计时 **60s** cooldown（完整窗口），简单、保守、对应 server 最坏情况
- 倒计时来源：UI 本地 `setTimeout`，**不**依赖 server 返回的 retry-after 头（server 当前不返）
- 用户切账号 / 刷新页面时 cooldown **清零**（IP 还在限，但 UI 不必假设）

R8.0 design note "Open question 2"（SMS code resend cooldown UX）由本节给出答案：**60s 本地倒计时，无 server 回填**。

---

## 7. SMS 流程详解（R8.3b）

```
┌──── User ────┐                ┌── Web ──┐                ┌── application ──┐
│ 输入 mobile   │── click send ─▶│         │── send-sms-code ─▶│ verify scene=1 │
│              │                │ start 60s│                  │ Redis SET key  │
│              │◀── cooldown ──│ countdown│                  │ TTL=300s       │
│              │                │         │◀── { code: 0 } ──│                │
│ 等收码        │                │         │                  │                │
│ 输入 smsCode │── click login ▶│         │── sms-login ────▶│ verifySmsCode  │
│              │                │         │                  │ (Lua atomic)   │
│              │                │         │                  │ → server.issue │
│              │◀── 进入 chat ──│         │◀── LoginResponse ─│                │
└─────────────┘                └─────────┘                  └────────────────┘
```

关键不变式：

1. **`/auth/send-sms-code` 的 `data` 是 null**；UI 不要尝试从中读 cooldown / expires
2. **SMS 码 5 分钟 TTL**（`SMS_CODE_TTL_SECONDS = 300L` in `MemberAuthLogic`）；UI 提示文案应说"5 分钟内有效"
3. **SMS 码长度 4–8 数字**（`@Size(min=4, max=8)`）；server 当前生成 6 位
4. **匹配后服务端立即消费**（Lua 原子 GETDEL）；同一个码不能用两次
5. **手机号未注册 → SMS-login 自动注册**（`registerFromPrivchat`）；UI 不需要"切换到注册"按钮

---

## 8. Refresh 行为契约

| 项 | 决定 |
|----|------|
| Refresh 触发时机 | (a) IM WebSocket 收到 token expired error；(b) UI 启动时主动预检（可选） |
| Refresh 端点 | `${platformBaseUrl}/auth/refresh-token` |
| 必传 | `refreshToken` + `deviceId`（持久化的） |
| 失败语义 | 任何非零 envelope 或 4xx → 视为 refresh 不可用 → 调 `clearSession()` 并把 UI 切回 LoginPage（**不**自动重试） |
| Refresh token 是否轮换 | TOKEN_UNIFICATION Phase A：**不轮换**（response 里仍是同一个 refreshToken）；Phase B 之后可能轮换，Web 总是覆盖写持久化即可 |
| `PlatformAuthProvider.refreshToken()` 入参 | `PersistedSession`（Web 内部 type） |
| `PlatformAuthProvider.refreshToken()` 出参 | 新的 `PersistedSession`（即覆盖 access + refresh + saved_at） |

R8.3 阶段 Web **只**在 `refreshToken` 接口里调；不要在 LoginPage / 启动路径里主动调。

---

## 9. 已解决的 R8.0 Open Questions

| R8.0 Open Question（design note 第 467 行起）| R8.2b 回答 |
|---|---|
| Q2. SMS code resend cooldown UX | UI 本地 60s 倒计时，无 server 回填（见 §6.3） |
| 双 token 还是单 token？（design note 默认双）| **单 token**。TOKEN_UNIFICATION 已落地，Web `LoginResult.refreshToken` 是 application + IM 通用；不要再为 imToken 留位置 |
| platformBaseUrl 是否含 `/app` | **必须含**。`VITE_PRIVCHAT_PLATFORM_BASE_URL` = `https://app.example.com/app`，无尾斜杠（见 §1.4） |
| Web SDK 怎么用 token | 直接 `authenticate(accessToken)`，**不**先调 application 拿 imToken（见 §1.1） |
| PLATFORM 注册端点 | **不存在独立 register**。SMS-login 首次自动注册；UI 不渲染"注册"按钮 |

---

## 10. 仍未解决 / R8.3 实现时再决定

| # | 问题 | 决策方 | 备注 |
|---|------|--------|------|
| 1 | PLATFORM 是否暴露 password login UI | 产品 / R8.3 进入前确定 | 端点可用，但 native client 没用；见 §11.1 |
| 2 | `LoginResult.platformBaseUrl` 是否进入 `PersistedSession` 持久化 | R8.3 实现时拍板 | 选项 A：进入 session（多账号支持不同 platform）；选项 B：仅在 provider 内部持有，按 env 单值 |
| 3 | refresh 失败时是否区分"refresh 过期"vs"refresh 被 revoke" | R8.3 内可不区分 | 都按 §8 一律踢回 LoginPage；如要区分需要 server 返回明确 reason |
| 4 | Web 是否要做 "5 minute SMS code 倒计时" 提示文案 | R8.3c UI 时定 | 后端是 5min TTL，UI 可显示"验证码 5 分钟内有效"；不强求 |
| 5 | SMS 自动注册是否在 UI 上提示用户 | R8.3c UI 时定 | 服务端语义是 transparent；UI 可加 "首次登录将自动创建账号" 文案 |
| 6 | 手机号格式校验在哪一层 | R8.3 内规定 | 建议：UI 输入框先 E.164 正则；submit 前再 trim；让 server 负责终判 |

---

## 11. 接口蓝图建议（不写代码，只画契约）

### 11.1 `AccountAuthProvider` interface 是否要变

R8.1 当前：

```ts
interface AccountAuthProvider {
  loginWithPassword(input: PasswordLoginInput): Promise<LoginResult>;
  registerWithPassword?(input: PasswordLoginInput): Promise<LoginResult>;
  loginWithSms?(input: SmsLoginInput): Promise<LoginResult>;
  refreshToken?(session: PersistedSession): Promise<PersistedSession>;
  logout?(session: PersistedSession): Promise<void>;
}
```

R8.3 落地建议：

| 方法 | BUILTIN | PLATFORM | 说明 |
|------|---------|----------|------|
| `loginWithPassword` | ✓（username + password）| **可选**（mobile + password）| native PLATFORM 没暴露；**建议 R8.3 暂不实现 PLATFORM 这条**，只走 SMS。等产品要了再开 R8.4 |
| `registerWithPassword` | ✓ | **不实现** | PLATFORM 没有独立注册 |
| `loginWithSms` | 不实现 | ✓ | R8.3 主路径 |
| `sendSmsCode`（**新增**）| 不实现 | ✓ | 当前 interface 里**没有**；R8.3b 必须新增 |
| `refreshToken` | ✓（passthrough）| ✓ | PLATFORM 真实调 server；BUILTIN 维持 R8.2 的 no-op |
| `logout` | 不实现 | R8.3 之外 | |

> 关键 interface 改动：**新增 `sendSmsCode?(input: { serverUrl, mobile }): Promise<void>`**，BUILTIN 不实现，PLATFORM 实现。这是 R8.1 没考虑到的方法（R8.1 把 SMS 简化成"login with code"单步，但实际需要"先发码 → 后登录"两步）。

### 11.2 `SmsLoginInput` 当前形态够用，但 device 字段对齐 native

R8.1 已定义：

```ts
interface SmsLoginInput {
  serverUrl: string;
  mobile: string;
  smsCode: string;
  device: DeviceInfo;   // 包含 device_id, device_type, app_id, ...
}
```

R8.3 实现时把 `DeviceInfo` 序列化成 §3.1 的 `device` 对象。注意 native 用 `platform` 字段（不是 `device_type`），server 实际接收 `LoginDeviceInfo.platform`：

| Web `DeviceInfo` 字段 | HTTP `device.*` 字段 |
|---------------------|---------------------|
| `device_id`     | `deviceId` |
| `device_type`   | `platform`（**注意改名**；统一用 "web"） |
| `app_id`        | （不传，server 不需要）|
| `device_name`   | `deviceName` |
| `app_version`   | `appVersion` |
| `os_version?`   | `osVersion` |

### 11.3 R8.3 拆分建议（基于本契约）

| Round | 范围 | 测试覆盖 |
|-------|------|---------|
| **R8.3a** | `PlatformAuthProvider` 骨架：`new` + `mode='platform'` + envelope 解码 + 错误归一；不实现任何 login | 解码 happy path / envelope code≠0 / HTTP 5xx |
| **R8.3b** | `sendSmsCode` + `loginWithSms` + `refreshToken`；interface 新增 `sendSmsCode` 方法；mock harness 控制 application HTTP 响应 | sendSmsCode 成功/失败；loginWithSms 成功/SMS 错/凭证错；refresh 成功/失败 |
| **R8.3c** | `LoginPage` 在 `mode==='platform'` 时切到 mobile + smsCode 表单 + 60s cooldown UI；通过 `capabilities.smsLogin === true` gate；保留 BUILTIN 路径不变 | UI 渲染分支；cooldown 倒计时；错误展示 |
| **R8.3d**（可选）| PLATFORM password login（仅当产品要）| 同上加一个 password 表单分支 |

R8.3a 可以独立开 PR；R8.3b/c 也可独立。R8.3d 是 conditional，不一定开。

---

## 12. 实现 checklist（R8.3 起手前自检）

- [ ] `VITE_PRIVCHAT_PLATFORM_BASE_URL` 文档说明已更新到"必含 `/app`，不带尾斜杠"
- [ ] `getPlatformBaseUrl()` 校验函数加上 `/app` 后缀检查（warn 不 throw）
- [ ] `account-auth-provider.ts` 接口新增 `sendSmsCode?` 方法
- [ ] `BuiltinAuthProvider` **不**新增 `sendSmsCode`（保持 R8.2 的能力裁剪契约）
- [ ] `PlatformAuthProvider` 实现里：fetch 用 `mode: 'cors'` + `credentials: 'omit'`（不依赖 cookie；token 全靠请求体 / Bearer header）
- [ ] envelope 解码统一封装一个 `requireOk(envelope)` 工具（mirror native `requireOk()`）
- [ ] 错误归一：HTTP 4xx/5xx + envelope `code !== 0` 都映射到 `Error(message)`，由 LoginPage / refresh 路径统一展示；不抛 provider 类名
- [ ] `LoginResult.refreshToken` 必填（PLATFORM）；BUILTIN 不填
- [ ] R8.3c UI cooldown 用 `useState<number>(0)` + `setInterval` 即可；不要新增 SDK / state machine

---

## 13. 一句话总结

> Web 在 PLATFORM 模式下走 application 的 `${baseUrl}/auth/*` HTTP 端点；envelope `{code,message,data}`，统一拿到 unified `accessToken` / `refreshToken` / `deviceId`，access 直接喂 IM SDK 不需二次换 token；R8.3 主路径是 SMS（`sendSmsCode` + `loginWithSms`），password login 是可选项；UI cooldown 60s，refresh 失败一律踢回 LoginPage。
