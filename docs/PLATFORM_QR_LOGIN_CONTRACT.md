# Platform QR Login Contract (privchat-web)

> Round: R8.5a
> Status: Active
> Companion: [QR_LOGIN_SPEC](../../privchat-docs/spec/05-feature/QR_LOGIN_SPEC.md) · [QR_API](../../privchat-docs/spec/02-server/api/QR_API.md) · [PLATFORM_ACCOUNT_MODE_DESIGN](./PLATFORM_ACCOUNT_MODE_DESIGN.md) · [PLATFORM_REQUIRED_ACTIONS_CONTRACT](./PLATFORM_REQUIRED_ACTIONS_CONTRACT.md)

---

## 1. Goal / Non-goals

**Goal**: 把 privchat-web 的 QR 登录路径完整对齐 `QR_LOGIN_SPEC` 主线 —— Web 端跟 **privchat-server** 通过 **unauth RPC** 完成扫码全流程，扫码成功后用 `MemberLoginResponse` 复用 SMS 登录的同一条 onLoggedIn 链路（RequiredActionsGate + IM 自动连接）。

**Non-goals**:
- HTTP polling fallback —— **不做**。spec QR_API §2 把 `poll_token` 标为"备用，默认不启用"；QR_API §4.2 `GET /scenes/{id}` 不携带 token，正常路径就是 unauth RPC push
- 改动 `privchat-sdk-typescript` —— **0 行改动**。SDK 早就支持 unauth WS RPC（`new PrivchatClient({url})` → `connect()` 无需 token → `rpcCallTyped()` 即可，BUILTIN 的 login/register 一直这么走，见 `src/lib/builtin-auth-provider.ts:82-117`）
- 改动 `privchat-application` —— **0 行改动**。`QrLoginController` 在 `controller/app/platform/qr/QrLoginController.kt` 已 Active；Web 端的扫码流程不经过 application
- BUILTIN 模式支持 —— **不做**。BUILTIN 没有"另一台已登录设备"这个角色，QR 登录在产品语义上不成立；UI 入口必须做 capability gate

---

## 2. 通信四通道（对齐 spec）

| 通道 | 协议 | 内容 | 涉及方 |
|---|---|---|---|
| **Web ↔ privchat-server** | **unauth RPC**（quic/ws/tcp 均支持白名单未鉴权 RPC） | `qr_login/create_scene` 请求 + 4 个 push 事件（`qr_login.scanned` / `rejected` / `expired` / `authorized`） | R8.5 本轮唯一直接接触面 |
| **App ↔ privchat-application** | HTTP | `/platform/qr-login/scan` / `/confirm` / `/reject` | 移动端 R8.6 |
| **privchat-application ↔ privchat-server** | HTTP（服务间） | 转发 scan/confirm/reject + 显式调 `/api/service/qr-login/scenes/{id}/push-authorized` | application 已实现 |
| **Web ↔ privchat-application** | HTTP | **拿到 token 之后**的常规接口（profile / requiredActions / etc.），跟扫码流程本身**无关** | R7/R8.4 已实现 |

扫码 in-flight 阶段（`created → scanned → authorized`）**Web 全程只跟 server 用 unauth RPC 对话**。authorized 拿到 `MemberLoginResponse` 之后，Web 走 SMS 同款 onLoggedIn 路径，从此进入"已登录 Web 生活"，跟 application HTTP 的接触面就是 R7/R8.4 那一套。

---

## 3. SDK API 一览（既有能力，零改动）

R8.5 用到的 SDK 表面：

| API | 来源 | 用法 |
|---|---|---|
| `new PrivchatClient({ url })` | `@privchat/sdk` | 建立 unauth WebSocket。`url` 是 server WS URL（跟 BUILTIN login 同一个） |
| `await client.connect()` | client.ts:686 | unauth 握手；不需要 accessToken |
| `await client.rpcCallTyped<Req, Resp>(route, body)` | client.ts:1094 | unauth WS 上发 RPC |
| `client.onPushMessage(cb: (m: PushMessageRequest) => void)` | client.ts:2336 | L1 event bus 派发 server 主动推送 |
| `PushMessageRequest.topic: string` | codec/push.ts:35 | QR push 事件名（`qr_login.<state>`） |
| `PushMessageRequest.payload: Uint8Array` | codec/push.ts:37 | UTF-8 编码的 JSON 信封（spec QR_API §5.2） |
| `await client.dispose()` | client.ts:719 | RPC 结束 / 终态事件后清理 WS |

`BuiltinAuthProvider.runCredentialRpc()`（builtin-auth-provider.ts:82-117）就是同款生命周期模板：spin up → connect → RPC → dispose（finally）。QR 唯一差异：不能一发即 dispose，必须挂 push 监听直到终态事件 / 倒计时归零。

---

## 4. State machine

### 4.1 Server scene 5 态（QR_API §3）

```
created  ── scan ─────▶  scanned  ── confirm ────▶  authorized  (终态)
   │                        │                          
   │                        └──── reject ───────▶  rejected     (终态)
   │                        │
   └────── timeout ────────▶ expired               (终态)
```

### 4.2 Web 客户端 8 态（本轮新增）

| 客户端态 | 触发 | UI 表现 |
|---|---|---|
| `idle` | tab 未激活 | — |
| `creating` | 用户点击 QR tab，连 WS + 发 `create_scene` RPC | "正在生成二维码…" |
| `waiting` | RPC 回 `{scene_id, qr_token, expires_at}` | 渲染二维码 + 倒计时（默认 90s） |
| `scanned` | 收到 `qr_login.scanned` push | "已扫码，请在 App 上确认" + 头像/昵称（若 push 带） |
| `authorizing` | UI 状态过渡（短暂） | "正在登录…" |
| `authorized` | 收到 `qr_login.authorized` push | 立即 dispose + onLoggedIn(MemberLoginResponse) |
| `rejected` | 收到 `qr_login.rejected` push | "已拒绝" + 重新生成按钮 |
| `expired` | 收到 `qr_login.expired` push **或** 倒计时归零 | "已过期" + 自动 / 手动重新生成 |

`authorized` / `rejected` / `expired` 是客户端终态；进入终态后 `client.dispose()` 关闭 WS。重新生成 = 新建 PrivchatClient 走 `creating`。

---

## 5. RPC 报文

### 5.1 请求：`qr_login/create_scene`

route 字符串：`qr_login/create_scene`（unauth 白名单，spec QR_API §5.1）

请求 body（JSON）：

```jsonc
{
  "purpose": "login",
  "web_device_id": "<localStorage uuid v4>",
  "web_device_info": {
    "device_id": "<同上>",
    "device_type": "web",
    "app_id": "web",
    "device_name": "Chrome on macOS",
    "os_version": "macOS 14.4"
  },
  "ttl_secs": 90
}
```

`web_device_id` 复用 BUILTIN/SMS 登录已经在用的 localStorage UUID（同源同账号同设备 = 同 ID）。

### 5.2 响应

```json
{
  "scene_id": "9f3b...",
  "qr_token": "qr_xxx_signed_payload",
  "expires_at": 1745632890000,
  "rpc_topic": "qr_login.scene.9f3b..."
}
```

`rpc_topic` 仅作调试 / 兼容字段，**客户端不需要 subscribe**。spec §5.1：server 直接按 `session_id` push。

二维码 payload = **JSON 字符串** `{"sceneId":"...","qrToken":"..."}`（R8.6 wire-fix）。

> R8.5b 起初设想 payload 只放 `qr_token`，但 application 的 `/platform/qr-login/scan` 端点（spec QR_API §4.3）请求体要求 **同时** 携带 `scene_id` 和 `qr_token`（看 `privchat-application-module-member/.../QrLoginController.kt` 的 `PlatformScanQrSceneRequest`）。App 端扫到的字符串解析为 JSON 即可同时拿到两字段。


### 5.3 Push 事件信封（spec QR_API §5.2 + QR_LOGIN_SPEC §5.2）

server 主动推送都走 `PushMessageRequest`（`MessageType::PushMessageRequest = 7`）：
- `topic` = `qr_login.scanned` / `qr_login.rejected` / `qr_login.expired` / `qr_login.authorized`
- `payload` = UTF-8 编码的 JSON 信封

JSON 信封统一形态：

```jsonc
{
  "event": "qr_login.<state>",
  "scene_id": "9f3b...",
  "state": "scanned|rejected|expired|authorized",
  "data": <event-specific JSON or null>
}
```

`data` 字段按事件区分：

| 事件 | `data` |
|---|---|
| `qr_login.scanned` | `{ scanner_uid, scanner_avatar, scanner_display_name, scanned_at }` |
| `qr_login.rejected` | `null` |
| `qr_login.expired` | `null` |
| `qr_login.authorized` | **`MemberLoginResponse` 完整 JSON**（见 §6） |

客户端解析守则：
- 按 `topic.startsWith('qr_login.')` 过滤；不属于自己的 push 忽略
- 用 `topic`（不是 `state`）做事件 dispatch；`state` 用于 UI / 日志校验
- `data` 缺失 / 类型不符 → 当作协议错误，进入 `expired` 态 + 日志（不要崩溃）

---

## 6. authorized.data = `MemberLoginResponse`

这是 spec 主线最关键一条 —— `qr_login.authorized` push 的 `data` **不是** spec QR_LOGIN_SPEC §5.5 那个旧的 `imToken` shape，**是** R8.4a-server 统一后的 `MemberLoginResponse`（application 仓库 `controller/app/auth/dto/MemberLoginResponse.kt`，application 在 `QrLoginController.confirm()` 里调 `memberAuthLogic.issueLoginResponseForUid()` 拼出来，再调 server `push_qr_login_authorized` 透传过来）。

Wire shape（与 SMS 登录 200 响应**逐字段一致**）：

```ts
interface MemberLoginResponse {
  userId: number;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  imToken: string;
  imRefreshToken: string;
  imDeviceId: string;       // = application 给 Web 设备签发的 device_id
  imExpiresIn: number;
  imRefreshExpiresIn: number;
  sessionVersion: number;
  deviceCreated: boolean;
  requiredActions?: RequiredAction[];  // R8.4a 框架字段；QR 路径 server 返回空数组（用户已存在 + 资料完整时）
}
```

> **wire-defense**：跟 SMS 登录共用 `requiredActions ?? []` 守则。QR 扫码的"扫码方"已经是已登录用户，资料通常完整 → 多数情况 actions 为 `[]`；但如果扫码方账号有未处理的强制项（罕见），同样会进 RequiredActionsGate。

---

## 7. AccountAuthProvider seam 扩展

`AccountAuthProvider` interface（`src/lib/account-auth-provider.ts`）新增**可选**方法。BUILTIN 不实现 = `typeof provider.startQrLogin === 'function'` 为 `false`，capability 检查走得通。

```ts
export interface QrLoginSession {
  /** Stable session id; client uses it for cancel / re-create dedup. */
  readonly sceneId: string | null;
  /** Subscribe to state transitions. Returns Unsubscribe. */
  observe(cb: (s: QrLoginState) => void): () => void;
  /** Latest state (sync snapshot for first render). */
  snapshot(): QrLoginState;
  /** User cancelled (tab switch away / closed dialog). Disposes WS. */
  cancel(): Promise<void>;
}

export type QrLoginState =
  | { kind: 'creating' }
  | { kind: 'waiting'; sceneId: string; qrPayload: string; expiresAt: number }
  | { kind: 'scanned'; sceneId: string; scannerUid: number; scannerAvatar?: string; scannerDisplayName?: string }
  | { kind: 'authorizing'; sceneId: string }
  | { kind: 'authorized'; sceneId: string; result: LoginResult }
  | { kind: 'rejected'; sceneId: string }
  | { kind: 'expired'; sceneId: string | null }
  | { kind: 'error'; reason: 'transport' | 'protocol' | 'config'; message: string };

export interface AccountAuthProvider {
  // ...既有方法...
  /** PLATFORM-only. Throw / undefined on BUILTIN. */
  startQrLogin?(input: { serverUrl: string; device: DeviceInfo }): Promise<QrLoginSession>;
}
```

`authorized` 态的 `result` 字段就是 `LoginResult`（既有形状），可直接喂给 `App.tsx` 的 `onLoggedIn(account, initialActions)`。`requiredActions` 透传，**QR 不绕过 RequiredActionsGate**。

---

## 8. Capability gate（PLATFORM-only 强约束）

| 层 | 守则 |
|---|---|
| Provider | `BuiltinAuthProvider.startQrLogin` **不实现**（不要写 stub throw，让 `typeof === 'function'` 直接 false） |
| Capability | `accountModeCapabilities.qrLogin = provider.mode === 'platform' && typeof provider.startQrLogin === 'function'` |
| UI | `LoginPage` 的 QR tab **仅** 在 `capabilities.qrLogin === true` 时渲染；BUILTIN 路径连 tab 都看不见 |
| 测试 | 必须有一个 smoke 验证：BUILTIN 模式下 LoginPage 无 QR tab、`provider.startQrLogin` 为 undefined |

为什么 PLATFORM-only：QR 登录依赖"另一台已登录设备 + application 签发统一 token"。BUILTIN 模式 application 不参与，无法签发 `MemberLoginResponse`，整套语义跑不通。强约束写在文档和代码两层。

---

## 9. 生命周期与超时

```
点击 QR tab
   │
   ▼
new PrivchatClient({ url })       ─── creating
   │
   await connect()
   │
   await rpcCallTyped('qr_login/create_scene', body)
   │
   client.onPushMessage(onPush)   ─── waiting (倒计时 90s)
   │
   ┌─── topic === 'qr_login.scanned'    ──▶ scanned
   │
   ├─── topic === 'qr_login.authorized' ──▶ authorizing → authorized
   │                                          │
   │                                          ▼
   │                                       dispose() + onLoggedIn(result)
   │
   ├─── topic === 'qr_login.rejected'   ──▶ rejected   ──▶ dispose()
   │
   ├─── topic === 'qr_login.expired'    ──▶ expired    ──▶ dispose()
   │
   └─── 倒计时归零（无任何 push）        ──▶ expired    ──▶ dispose()
```

| 触发点 | 动作 |
|---|---|
| 用户切走 tab / 关闭对话框 | `session.cancel()` → `client.dispose()` |
| WS 连接异常 close（network drop） | state → `error{transport}`，UI 展示重试按钮 |
| 终态事件 push 完 | `client.dispose()`（spec 保证 server 端 `publisher.unbind_by_scene` 已清理 binding） |
| 用户点"重新生成" | 旧 session.cancel() + 新建 PrivchatClient 走 `creating` |

---

## 10. 错误映射

| 场景 | state | UI |
|---|---|---|
| `connect()` 失败 | `error{transport}` | "无法连接服务器，请检查网络" + 重试 |
| `create_scene` RPC 失败（server 5xx / 协议错） | `error{transport}` 或 `error{protocol}` | 同上 |
| `authorized.data` 反序列化失败 / 缺字段 | `error{protocol}` | "登录响应异常，请重新扫描" + 自动重新生成 |
| Web 设备 device_id 缺失（localStorage 空） | `error{config}`，**不发 RPC** | "设备初始化失败"（开发者侧需排查 IDENTITY §7.4） |

---

## 11. Multi-account / Add-account 场景

R7.x 的 multi-account framework 已经支持多账号并存。QR 登录在两种入口：

| 入口 | 行为 |
|---|---|
| LoginPage（未登录） | 跟 SMS 登录平级 tab；扫码成功后 `onLoggedIn(account, initialActions)`，跟 SMS 完全同款路径 |
| "添加账号"（已登录） | 同一 LoginPage，新建账号；扫码成功后多账号 store 追加一条；自动切换到新账号 |

`web_device_id` 在多账号场景下**仍是单一 localStorage UUID**（不区分账号）—— spec IDENTITY §7.4：device_id 是浏览器维度。但 server 端 device 记录会按 `(uid, device_id)` 复合键管，多账号扫码到同一浏览器，每个账号对应一条 device 行（application 在 confirm 时签发新 device_id 的边界由 server CAS 保证）。

---

## 12. R8.5 round split

| Round | 范围 |
|---|---|
| **R8.5a**（本轮）| 本文档；老 HTTP polling 草稿已删除 |
| **R8.5b** | `PlatformAuthProvider.startQrLogin()` 实现 + harness + smoke。不动 UI。BUILTIN capability gate（provider 不实现）一并验证 |
| **R8.5c** | `LoginPage` QR tab + 8 态机 UI + qrcode 渲染 + i18n（中英）+ 倒计时 |
| **R8.5d** | 真实 e2e（PLATFORM 模式 + 真 server + 真 application + 用手机 App 扫码确认 + 登录后落到 RequiredActionsGate 验证） |

不增加 `R8.5a-server` —— application 已实现，无需协调。

---

## 13. Test matrix（R8.5b harness + smoke）

R8.5b smoke 列表（用 mock unauth client 验证 provider 行为）：

| # | 场景 | 期望 |
|---|---|---|
| 1 | BUILTIN 模式 | `typeof provider.startQrLogin === 'undefined'` |
| 2 | PLATFORM 模式 + 正常 create_scene 响应 | session 进入 `waiting`，qrPayload === `qr_token` |
| 3 | `connect()` reject | session 进入 `error{transport}`，不调 RPC |
| 4 | `rpcCallTyped` reject | session 进入 `error{transport}` |
| 5 | 收到 `qr_login.scanned` push | session 进入 `scanned`，带 scanner 信息 |
| 6 | 收到 `qr_login.authorized` push（带完整 MemberLoginResponse） | session 进入 `authorized`，`result.requiredActions` 透传 |
| 7 | 收到 `qr_login.authorized` push，`requiredActions` 缺失 | `result.requiredActions === []`（wire-defense） |
| 8 | 收到 `qr_login.rejected` push | session 进入 `rejected` |
| 9 | 收到 `qr_login.expired` push | session 进入 `expired` |
| 10 | `data` 字段 JSON 损坏 | session 进入 `error{protocol}` |
| 11 | 收到非 `qr_login.*` topic 的 push | 忽略，session 状态不变 |
| 12 | `session.cancel()` | client `dispose()` 被调用，state 不再变化 |

R8.5d 真实 e2e 11 case 在该轮文档单独列。

---

## 14. 一句话总结

**Web 用 unauth RPC 直连 server 申请 scene + 监听 4 个 push 事件；authorized event 的 `data` 字段就是 `MemberLoginResponse`，喂回 SMS 同款 `onLoggedIn` 路径；application 全程不参与扫码 in-flight 阶段；BUILTIN 模式连入口都不出现。**
