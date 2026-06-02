# Platform Post-login Required Actions Contract (R8.4a)

> Status: Frozen for R8.4b/c implementation
> Parent design: [PLATFORM_ACCOUNT_MODE_DESIGN.md](./PLATFORM_ACCOUNT_MODE_DESIGN.md) (R8.0 + R8.2c amendments)
> Sibling contracts:
> - [PLATFORM_AUTH_HTTP_CONTRACT.md](./PLATFORM_AUTH_HTTP_CONTRACT.md) (R8.2b) — auth endpoints
> - [PLATFORM_PROFILE_HTTP_CONTRACT.md](./PLATFORM_PROFILE_HTTP_CONTRACT.md) (R8.4a) — profile endpoints
>
> **Server-side implementation shipped (R8.4a-server):**
> - DTO `controller.app.auth.dto.RequiredAction`
> - Logic `logic.RequiredActionsLogic`
> - Controller `controller.app.required_actions.RequiredActionsController` (**not** `AccountController` — that FQN belongs to `module-platform`'s developer-credentials API; same-FQN class symbol clash on Kotlin Native link)
> - Endpoint `GET /app/account/required-actions` (single `/app` layer)
> - Field added to `MemberLoginResponse.requiredActions`

---

## 1. Goal / Non-goals

### Goal
冻结 PLATFORM 模式下 **Post-login Required Actions** 机制的契约：登录成功后、进入主功能前，client 必须完成 server 指定的一组动作（首次完善昵称、同意新版协议、绑定手机、KYC 补充、风控重置等）。机制是通用的，跨 mode 跨 action 类型可扩展。

R8.4 v1 只激活一个 action：`complete_profile.nickname`。但 contract 设计支持 v2+ 接入更多 action 类型（accept_terms / bind_mobile / kyc / acknowledge_notice 等），不需要改框架。

### Non-goals
- **不改 server schema**（v1 用 nickname pattern 兜底判断 `complete_profile`；v2 server 端可以选择加 `member_users.profile_completed_at` 等）
- **不实现非 nickname 的 action 类型**（contract 列出来但 v1 不落代码）
- **不动 PLATFORM_AUTH_HTTP_CONTRACT.md** 的 auth 部分；只在 LoginResponse 里追加 `required_actions` 字段
- **不动 token 颁发逻辑**：required actions 是 client UI gate，server 始终发 token

### 关键架构决策（与早期 `requires_profile_completion: bool` 草案的区别）
- **删掉** `LoginResponse.requires_profile_completion` 这个 bool 字段（早期 R8.4a 草案的设计），**不进生产代码**
- **新增** `LoginResponse.required_actions: RequiredAction[]`，统一空数组语义
- 单一布尔字段无法承载未来 accept_terms / KYC / risk-reset 等场景；提前升级为开放数组结构避免架构债

---

## 2. Mechanism overview

```
Login success (sms-login / password / refresh / qr)
  ↓
LoginResponse {
  access_token, refresh_token, ...,
  required_actions: RequiredAction[]   ← 新增
}
  ↓
client persists session normally  (token 始终可用)
  ↓
required_actions.length === 0?
  ├── yes → render ChatWorkspace
  └── no  → render <RequiredActionFlow actions={...} />
              ↓
          run handler for first known required action
              ↓
          on action success → POST /required-actions/refresh OR
                              GET  /app/account/required-actions
              ↓
          (server re-evaluates) → updated required_actions
              ↓
          empty? → ChatWorkspace ; non-empty? → next action
```

### 三大不变式

1. **Server 权威**：required_actions 由 server 决定。Client 不揣测、不本地缓存"我已经完成 X 应该没事了"。每完成一个 action 后**必须重新拉权威列表**才能决定下一步。
2. **Token 不受影响**：required_actions 非空照样签发完整 access/refresh token。Client 用现有 token 调对应 action 的 update API。
3. **Client gate，不是 server auth refusal**：所有阻断在 Web/Native UI 层；server HTTP 层不主动拒绝带 token 的业务请求（行为请求级 RBAC 仍然按各自接口的鉴权规则走，与 required_actions 正交）。

---

## 3. Endpoints

### 3.1 LoginResponse 字段追加

R8.2b 已存在的所有登录入口（`/auth/login` / `/auth/sms-login` / `/auth/social-login` / `/auth/refresh-token`）的响应 DTO 全部追加：

```kotlin
@Serializable
data class MemberLoginResponse(
    // ... 现有 R8.2b 字段全部保留 ...
    val userId: Long,
    val accessToken: String,
    val refreshToken: String,
    val tokenType: String = "Bearer",
    val expiresIn: Long,
    val refreshExpiresIn: Long,
    val deviceId: String,
    val sessionVersion: Long,
    val deviceCreated: Boolean,
    val scope: List<String>,
    val issuer: String = "privchat-server",

    /** R8.4a 新增。空数组 = 可直接进 workspace。
     *  非空 = client 必须进 RequiredActionFlow。
     *  默认空数组（不是 null）保后向兼容：旧 server 不设 → kotlinx.serialization
     *  反序列化时按字段默认 emptyList() 处理；旧 client 不读字段视同空。 */
    val requiredActions: List<RequiredAction> = emptyList(),
)
```

> **不再加 `requiresProfileCompletion: Boolean`**。该字段在 R8.4a 早期草案出现过，**永不进生产代码**；任何 server 端 PR 直接跳过 bool，落 `required_actions` 数组。

### 3.2 独立检测端点

```
GET ${baseUrl}/app/account/required-actions
Authorization: Bearer <accessToken>
```

> 路径前缀按全局规则：framework 给 controller mount 自动加 `/app` 前缀（或子域名 `app-api.*` 承担同语义），controller 注解只写业务前缀（`@Controller("/account")`、`@Controller("/member/user")` 等），**不写 `/app/`**。Client 用 `${baseUrl}/account/required-actions` 单层拼接。

响应：

```jsonc
{
  "code": 0,
  "message": null,
  "data": {
    "required_actions": [
      {
        "type": "complete_profile",
        "required": true,
        "fields": ["nickname"]
      }
    ]
  }
}
```

`data.required_actions` 永远是数组（不是 null）。空数组语义：**无待办，client 可直接进 workspace**。

### 3.3 用途分工

| 端点 | 用途 |
|---|---|
| LoginResponse.required_actions | **首次登录**立即知道是否要进 RequiredActionFlow，避免一次额外 round-trip |
| GET /app/account/required-actions | **auto-login / restore session** 后二次确认；**完成一个 action 后**重新拉权威列表 |

两者**返回结构一致**，client 用同一个 reducer 处理。

---

## 4. RequiredAction data model

### 4.1 通用对象，不用 sealed class（v1）

server / client 都用通用 DTO，不强约束 sealed enum。每个 action 类型可能携带不同参数，v1 强 sealed 反而成扩展障碍。

**字段职责分工**（极其重要）：

| 字段 | 角色 | 客户端使用方式 |
|---|---|---|
| `action` | 机器可读，稳定枚举 | **唯一**用来 dispatch 到本地业务逻辑（`switch (a.action) { ... }`） |
| `title` / `titleKey` | 用户可读，UI 展示态 | **只展示**，禁止拿它做逻辑判断（受语言 / 运营文案变化影响）|
| `required` | 必填动作标志 | 缺失或 null 时按 `true` 处理 |
| `fields` / `version` / `noticeId` / `reason` | action-specific 参数 | 按对应 action 解析 |

#### Server (Kotlin)

```kotlin
@Serializable
data class RequiredAction(
    /** Action 机器名；v1 唯一支持值 `"complete_profile"`。**稳定枚举，永不本地化**。 */
    val action: String,
    /** 是否必须完成才能进 workspace。
     *  true  → client 不识别该 action 时 fail-closed
     *  false → client 不识别时 silent skip
     *  默认 true；client 解析时缺省也必须按 true 处理。 */
    val required: Boolean = true,
    /** 用户可读标题，server 直接渲染态文案（默认中文）。
     *  Client 优先用 [titleKey] 本地翻译；fallback 到 [title]；最终 fallback 到 [action] 标识。 */
    val title: String? = null,
    /** i18n key，多语言客户端把同一 action 翻成本地语言。
     *  约定命名：`requiredAction.<action>.<sub>` 例：`requiredAction.completeProfile.nickname`。 */
    val titleKey: String? = null,
    /** complete_profile 用：必填字段列表。v1 只支持 ["nickname"]。 */
    val fields: List<String> = emptyList(),
    /** accept_terms 用：协议版本号。 */
    val version: String? = null,
    /** acknowledge_notice 用：通知 ID。 */
    val noticeId: String? = null,
    /** 其它 action 携带的简要原因（用于 UI 文案）。 */
    val reason: String? = null,
)
```

#### Client (TypeScript)

```ts
/** Open object with optional fields. Don't use sealed/discriminated union —
 *  the open fallback for unknown `action` values is more important than
 *  exhaustive typing of known actions (forward compat). */
export interface RequiredAction {
  /** Stable machine name; ONLY field used for dispatch. */
  action: string;
  /** Missing / null in wire → treat as true. */
  required?: boolean;
  /** UI-only. Display-state text from server (defaults to zh-CN). */
  title?: string;
  /** UI-only. i18n lookup key for client-side localized strings. */
  titleKey?: string;
  /** Present when `action === 'complete_profile'`. v1 only "nickname". */
  fields?: string[];
  /** Present for `accept_terms`. */
  version?: string;
  /** Present for `acknowledge_notice`. */
  noticeId?: string;
  /** Present for `bind_mobile` / `reset_password` / etc. */
  reason?: string;
  /** Forward-compat catch-all. */
  [extra: string]: unknown;
}

/** Client decoding rule. */
export function isRequired(a: RequiredAction): boolean {
  return a.required ?? true;  // missing → true (fail-closed by default)
}

/** Client title resolution rule (preferred → fallback chain). */
export function actionTitle(a: RequiredAction, t: (k: string) => string): string {
  if (a.titleKey !== undefined) {
    const translated = t(a.titleKey);
    if (translated !== a.titleKey) return translated;  // i18n hit
  }
  if (typeof a.title === 'string' && a.title !== '') return a.title;
  return a.action;  // last-resort machine name
}
```

### 4.2 v1 action 字典

| `action` | v1 实现 | `title`(server) | `titleKey` | fields/payload |
|---|---|---|---|---|
| `complete_profile` | ✓ | `"设置昵称"` | `requiredAction.completeProfile.nickname` | `fields: ["nickname"]` |
| `accept_terms` | 预留，不实现 | TBD | `requiredAction.acceptTerms` | `version: "YYYY-MM-DD"` |
| `bind_mobile` | 预留 | TBD | `requiredAction.bindMobile` | `reason?` |
| `verify_email` | 预留 | TBD | `requiredAction.verifyEmail` | — |
| `complete_kyc` | 预留 | TBD | `requiredAction.completeKyc` | — |
| `acknowledge_notice` | 预留 | TBD | `requiredAction.acknowledgeNotice` | `noticeId` |
| `reset_password` | 预留 | TBD | `requiredAction.resetPassword` | `reason?` |

### 4.3 Unknown action 处理（必读）

Server 推送了 client 不识别的 `action` → 按 `required` 字段决定：

| `required` 字段（含缺省）| Client 行为 |
|---|---|
| `true` 或 **缺失/null**（按 true 处理）| **fail-closed**：渲染"当前版本不支持该必需操作"阻断页，**不**进入 workspace。提供"重新加载""退出登录"两个按钮，不自动跳过 |
| `false` | **silent skip**：从待办队列移除该 action，继续处理后续 known action |

**MUST**：

> If the client receives a required action whose `action` field doesn't match
> any known handler, AND `required` is `true` or missing, the client MUST
> fail-closed and render an unsupported-required-action blocking page. It
> MUST NOT enter the main workspace. There is no "skip" button.

理由：允许 silent-skip required 动作 = client 旁路 server 硬约束（服务协议 / KYC / 风控）。强制升级是唯一 safe 默认。

### 4.4 Unsupported page 文案

UI 文案规则（按 §4.1 的 title resolution 用 `titleKey` 优先）：

```
required_actions.unsupported_title:   "需要更新客户端"
required_actions.unsupported_message: "你的账号需要完成「{{title}}」，但当前版本暂不支持。请升级 PrivChat 后继续使用。"
required_actions.unsupported_reload:  "已升级，重新加载"
required_actions.unsupported_logout:  "退出登录"
```

`{{title}}` 走 `actionTitle(a, t)` 解析。如果 `title` / `titleKey` 都缺失，fallback 显示 `a.action`，加上调试模式提示：

```
required_actions.unsupported_message_fallback: "你的账号需要完成「{{action}}」，但当前版本暂不支持。请升级 PrivChat 后继续使用。"
```

dev 模式可额外展示 `Unsupported required action: <action>` 做诊断。生产模式只把它放进 captureException 日志，UI 不暴露技术细节。

**不允许**：
- 用 `confirm()` / modal 让用户选择继续 — gate 必须是页面级阻断
- 用 `title` 做 dispatch（语言 / 运营文案变了会失效）

---

## 5. Server-side judgment (v1)

### 5.1 计算入口

新增 `RequiredActionsLogic.computeForUser(uid: Long): List<RequiredAction>`。被以下两处调用：

1. `MemberAuthLogic.buildResponse(uid, device)` 内：拼 `MemberLoginResponse` 时 `requiredActions = computeForUser(uid)`
2. 新 controller `AccountRequiredActionsController.list(identity)` 内：`computeForUser(identity.id.toLong())`

### 5.2 v1 实现（pattern fallback；ships in R8.4a-server）

```kotlin
class RequiredActionsLogic(
    private val memberLogic: MemberLogic,
) {
    suspend fun computeForUid(uid: Long): List<RequiredAction> {
        val member = memberLogic.get(uid) ?: return emptyList()
        return computeForMember(member)
    }

    fun computeForMember(member: Member): List<RequiredAction> {
        val actions = mutableListOf<RequiredAction>()
        if (isProfileIncomplete(member)) {
            actions += RequiredAction(
                action = "complete_profile",
                required = true,
                title = "设置昵称",
                titleKey = "requiredAction.completeProfile.nickname",
                fields = listOf("nickname"),
            )
        }
        // 扩展位（仅示例，v1 不返）：
        // if (needAcceptTerms(member)) actions += RequiredAction(
        //     action = "accept_terms", required = true,
        //     title = "同意新版协议", titleKey = "requiredAction.acceptTerms",
        //     version = currentTermsVersion,
        // )
        return actions
    }

    fun isProfileIncomplete(member: Member): Boolean {
        val nickname = member.nickname.trim()
        if (nickname.isEmpty()) return true
        // SMS auto-register pattern: "Member_${mobile.takeLast(4)}"
        if (nickname.matches(Regex("^Member_\\d{4}$"))) return true
        // Social auto-register pattern: "Member_${openId.take(6)}"
        if (nickname.matches(Regex("^Member_[A-Za-z0-9]{6}$"))) return true
        return false
    }
}
```

### 5.3 v2 升级（不影响 client）

未来可加 schema 字段或独立表：

```sql
-- option A: 在 member_users 加一列
ALTER TABLE member_users ADD COLUMN profile_completed_at BIGINT NULL;

-- option B: 独立 user_required_actions 表（更通用，支持 KYC / 协议接受等）
CREATE TABLE user_required_actions (
    user_id     BIGINT NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    required    BOOLEAN NOT NULL DEFAULT TRUE,
    payload     JSONB,
    created_at  BIGINT NOT NULL,
    PRIMARY KEY (user_id, action_type)
);
```

`computeForUser` 改读 DB；client 端契约（数组 + 通用 RequiredAction 对象）不变。

### 5.4 触发矩阵（v1）

| 入口 | 场景 | requiredActions |
|---|---|---|
| `POST /auth/sms-login` | 首次 SMS auto-register（`Member_xxxx`）| `[{action:"complete_profile", required:true, title:"设置昵称", titleKey:"requiredAction.completeProfile.nickname", fields:["nickname"]}]` |
| `POST /auth/sms-login` | 已有 member、nickname 已主动改 | **字段被省略**（kotlinx.serialization 对 default 空数组的省略行为）— client 必须按 `[]` 处理 |
| `POST /auth/sms-login` | 已有 member、nickname 仍是默认 pattern | 同首次（兜底）|
| `POST /auth/login`（password）| 任何 | 字段省略（v1 password 路径不强制 onboarding）|
| `POST /auth/social-login` | 首次（auto-register `Member_xxxxxx`）| 同 SMS 首次 |
| `POST /auth/refresh-token` | 任何 | 按当前 member 状态实时计算（与 sms-login 一致）|
| BUILTIN 任何入口 | 任何 | 字段省略（v1 不激活；机制保留）|

> **Wire 兼容铁律**：`requiredActions` 在空数组时**可能被序列化省略**（kotlinx
> 默认 encode-defaults 行为）。Web client 解析时 **MUST** 用 `response.requiredActions ?? []` 做兜底，不能假设字段一定存在。同样 `RequiredAction.required` 缺省时 **MUST** 按 `true` 处理。

---

## 6. Client-side flow (R8.4c will implement)

### 6.1 实体

| 名称 | 角色 |
|---|---|
| `RequiredActionsProvider` | 抽象 provider，对应 PLATFORM 的 HTTP impl + BUILTIN 的 noop impl |
| `RequiredActionFlow` | 顶层组件，根据 actions 列表 dispatch 到具体 action 子组件 |
| `<CompleteProfileAction>` | v1 唯一实现的 action 子组件，对应 `type: complete_profile` |

### 6.2 RequiredActionsProvider 接口

```ts
interface RequiredActionsProvider {
  readonly mode: AccountMode;
  /** 实时拉权威列表。auto-login 后调；完成一个 action 后再调。 */
  list(): Promise<RequiredAction[]>;
}
```

PLATFORM 实现：HTTP `GET /app/account/required-actions`。
BUILTIN 实现：永远 `[]`（v1）。

### 6.3 状态机（App.tsx 内）

```ts
type RequiredActionsState =
  | { kind: 'loading' }                            // auto-login 后正在拉
  | { kind: 'clear' }                              // 空数组，可进 workspace
  | { kind: 'pending'; actions: RequiredAction[] } // 至少一个 action
  | { kind: 'unsupported'; actions: RequiredAction[] };  // 全是 unknown required action
```

进入 `pending` 时取 `actions[0]`，根据 `action`（不是 `title`）渲染对应子组件：
- `action === 'complete_profile'` → `<CompleteProfileAction action={...} onDone={refresh} />`
- 已知 action 但 v1 未实现 → 视为 unknown
- unknown 且 `isRequired(a) === true`（包括 `required` 缺失/null）→ 切到 `unsupported` 状态

子组件完成后调 `provider.list()` 重新拉，新结果决定下一步。

### 6.4 完成 action 后的刷新规则

**必须**重新拉 `provider.list()`，**不**本地推断"我刚提交了 nickname 应该 actions 空了"。理由：
- server 可能在两次 list 之间又加了新 action（比如运营临时推 acknowledge_notice）
- 同一 action 可能 server 端判断逻辑还说没完成（client 提交了一个 server 不接受的 nickname）
- 多个 action 排队的场景下，server 决定的顺序优先于 client 假设

### 6.5 LoginResponse vs list() 的合流

fresh login 路径：直接用 `LoginResponse.required_actions` 初始化状态，不调 list()。
auto-login 路径：调 list() 拿权威。
完成 action 后：调 list()。

三处入口共享同一个 reducer：

```ts
function reduceActions(actions: RequiredAction[]): RequiredActionsState {
  if (actions.length === 0) return { kind: 'clear' };
  // For each action: if client can handle it (known dispatch target) OR
  // it's not required (silent-skippable) → fine. Otherwise it's a blocker.
  const blocking = actions.find(
    (a) => !isHandlableAction(a.action) && isRequired(a),
  );
  if (blocking !== undefined) return { kind: 'unsupported', actions };
  return { kind: 'pending', actions };
}

function isHandlableAction(action: string): boolean {
  return action === 'complete_profile';  // v1 仅此一个；R8.5+ 扩展
}

function isRequired(a: RequiredAction): boolean {
  return a.required ?? true;  // missing wire field → treat as true
}
```

---

## 7. CompleteProfileAction (v1 唯一具体 action)

### 7.1 渲染规则

只看 `action.fields`：

```ts
const a: RequiredAction = {
  action: 'complete_profile',
  required: true,
  title: '设置昵称',
  titleKey: 'requiredAction.completeProfile.nickname',
  fields: ['nickname'],
};
```

v1 只识别 `'nickname'` 字段。未来 R8.4d 扩展支持 `'avatar' | 'gender' | 'birthday' | ...` 等字段时复用同一组件，按 fields 顺序逐个渲染表单。

如果 `fields` 包含 client 不识别的字段（如 v1 收到 `['nickname', 'avatar']`），**v1 行为：忽略不识别的字段**，仅处理 `nickname`。理由：v1 收到 `avatar` 字段说明 server 端比 client 新；nickname 是必有的最基础项，先让用户至少完成它，剩下的 R8.4d 上线后下次拉就会再次出现。

如果 `fields` 一个都不识别（如 `['avatar']` only），按 unknown action 处理 → fail-closed。

页面标题用 `actionTitle(a, t)`（§4.1）：优先 i18n `titleKey` → server `title` → fallback `action` 标识。**禁止**用 `title` 做逻辑判断。

### 7.2 提交路径

- 调用 `ProfileProvider.updateNickname(trimmed)`（参见 `PLATFORM_PROFILE_HTTP_CONTRACT.md` §6）
- 成功后 `provider.list()` 重新拉
- 失败：error 展示，按钮 re-enabled，仍在 RequiredActionFlow

### 7.3 校验

- trim 后 ≥ 2 字符（client 校验放宽到 1，trim 后再判）
- trim 后 ≤ 32 字符
- 失败错误用 i18n `required_actions.complete_profile.error_*` keys

---

## 8. localStorage pending key

### 8.1 命名

```
privchat.web.required-actions-pending.<accountKey> = "true"
```

> **不要用早期 R8.4a 草案的 `profile-completion-pending`**。机制已升级；命名与机制对齐。R8.4c 代码里只用 `required-actions-pending`。

### 8.2 写入 / 清除

| 时机 | 动作 |
|---|---|
| Fresh login 后 `loginResult.requiredActions.length > 0` | `setItem(key, 'true')` |
| Auto-login 后 `provider.list()` 返回非空 | `setItem(key, 'true')` |
| 任意 action 完成后 `provider.list()` 返回 `[]` | `removeItem(key)` |
| 用户主动 logout | `removeItem(key)` |

### 8.3 角色

辅助状态，不是权威。**server 返回的 required_actions 列表是最终权威**。用法：

- 用户刷新页面 → flag 还在 → auto-login 路径走 `provider.list()` 二次确认（即使 server 已返空也 self-heal：清 flag → 进 workspace）
- 万一某次 list 失败 → flag 还在 → 仍 gate（fail-closed 直到下次 list 成功）

### 8.4 不存 actions 快照

只存 `'true'`/`removeItem`，不存 actions 数组本体。理由：
- actions 是动态的（运营随时加）；缓存快照容易 stale
- localStorage 只起"知道现在 pending"的提示，权威总是从 server 重新拉

---

## 9. Auto-login / restore-session behavior

### 9.1 现状

`App.tsx` 启动时调 `loadSession()` → `connectAccount(persisted)`。这条路径**没有 LoginResponse**，所以收不到 `required_actions`。需要 R8.4c 加一步显式调用 `provider.list()`。

### 9.2 R8.4c 必须加的二次确认

`App.tsx` 在 connectAccount 成功之后、`setHandle()` 渲染 ChatWorkspace 之前，插入：

```ts
const actions = await requiredActionsProvider.list().catch(() => null);
if (actions === null) {
  // 网络失败：fail-open（详 §9.3）
  enterChatWorkspace();
  return;
}
const state = reduceActions(actions);
if (state.kind === 'clear') {
  localStorage.removeItem(`privchat.web.required-actions-pending.${accountKey}`);
  enterChatWorkspace();
} else {
  localStorage.setItem(`privchat.web.required-actions-pending.${accountKey}`, 'true');
  setRequiredActionsState(state);  // BLOCK ChatWorkspace
}
```

### 9.3 list() 失败的处理

| 失败类型 | 策略 |
|---|---|
| 网络 / DNS / 5xx | **fail-open**：进 ChatWorkspace + captureException。理由：required actions 不是安全关键，避免一次网络抖动把用户卡死在 splash。下次刷新会再 list |
| HTTP 401 token 过期 | 触发 R8.3a refreshToken；refresh 成功 → 重试 list；refresh 失败 → `clearSession()` 强制重新登录 |
| envelope `code !== 0` 且 client 已登录 | **fail-open** + captureException。同上理由 |

注意 fresh login 路径（LoginResponse 直接带 actions）不存在 list 失败问题 — 已经在 LoginResponse 里了。fail-open 只对 auto-login 路径生效。

---

## 10. Multi-account behavior

### 10.1 隔离

localStorage key 按 accountKey 隔离 → 切到 account A（已 clear）不弹，切到 account B（pending）自动弹。

### 10.2 切换路径

- 用户在 RequiredActionFlow 里点账号切换器：**禁用**。理由：
  - account A 在 pending RequiredActionFlow → switching 到 account B → 看似可以绕过 A 的 required actions
  - R7.4 sequencer + R8.3b 已经禁用 switching 的中间态；Required Actions 期间也属于"未稳态"，强制等用户完成或主动 logout
- 添加 account 时：跟随 R7.5 add-account 流程；新 account 登录后正常进入它自己的 required actions 判断

### 10.3 清理时机表

| 事件 | 清理动作 |
|---|---|
| Logout 当前 account | clear `required-actions-pending.<accountKey>` for that key |
| Logout all accounts | clear all `required-actions-pending.*` keys |
| RequiredActionFlow 全部 action 完成 | clear `required-actions-pending.<accountKey>` |
| App 启动（boot） | 不主动清；保留 flag 让 auto-login 路径走二次确认 |

---

## 11. BUILTIN / PLATFORM mode matrix

| 项 | BUILTIN | PLATFORM v1 |
|---|---|---|
| `LoginResponse.requiredActions` | 永远 `[]` | server 按 §5.4 矩阵判断 |
| `requiredActionsProvider.list()` 实现 | 直接返 `[]`（noop impl，零 HTTP）| HTTP `GET /app/account/required-actions` |
| `RequiredActionFlow` 是否会渲染 | **永远不会** | 首次 SMS auto-register 后强制渲染直到完成 |
| localStorage pending flag | 永远不会写入 | 按 §8 写入 / 清除 |

### 11.1 跨 mode 升级路径

机制 mode-agnostic。如果未来 BUILTIN 也要 onboarding 或服务协议接受流程，只需 server 端 BUILTIN auth response 也按需返 required actions，client 代码零改动。

### 11.2 Capability 字段

不在 `AccountCapabilities` 加 `requiresActions` 字段。判断条件直接走机制流程：

```ts
loginResult.requiredActions.length > 0
  || (await provider.list()).length > 0
  || localStorage.getItem(pendingKey) === 'true'
```

`AccountCapabilities.profileEdit` 已有，可作为"是否实例化 PlatformProfileProvider"的早期 short-circuit，但**不是 RequiredActionFlow 的充要条件**。

---

## 12. Error mapping

复用 R8.3a `PlatformError` 体系（`src/lib/platform-errors.ts`）。

| 错误源 | 类 | UI 文案策略 |
|---|---|---|
| 网络 / fetch reject | `PlatformHttpError(0, msg)` | i18n `required_actions.error_network` + retry |
| HTTP 4xx (除 401) | `PlatformHttpError(status, msg)` | 通用错误 |
| HTTP 401 | `PlatformHttpError(401)` | 触发 refreshToken；失败 → clearSession |
| HTTP 5xx | `PlatformHttpError(status, msg)` | 通用错误 + retry |
| envelope `code !== 0` | `PlatformApiError(code, message)` | `message` 透传 |
| JSON 解析失败 | `PlatformProtocolError(msg)` | i18n `required_actions.error_protocol` |
| 配置错（缺 baseUrl）| `PlatformConfigError(msg)` | i18n `required_actions.error_config` |
| Unknown action required=true | （非异常，属业务流程）| i18n `required_actions.unsupported_*`（详 §4.4）|

R8.4c 加 helper `getRequiredActionErrorMessage(err, t)` 跟 R8.3b `getLoginErrorMessage` 平行。

---

## 13. Test matrix

R8.4c smoke spec（`tests/smoke/platform-required-actions-ui.spec.ts`）至少 cover：

| # | 场景 | 断言 |
|---|---|---|
| 1 | PLATFORM SMS auto-register → 首次返 `[{complete_profile, fields:[nickname]}]` | submit 成功 → 不进 ChatWorkspace，看到 `<CompleteProfileAction>` 的 nickname 输入框 |
| 2 | Login 返 `[]` | 直接进 ChatWorkspace，无 RequiredActionFlow |
| 3 | 提交合法 nickname → list() 返 `[]` → 进 ChatWorkspace | mock updateNickname 返 `code:0`；mock 后续 list 返 `[]` → ChatWorkspace 渲染，flag 清除 |
| 4 | 提交合法 nickname → list() 仍返 `[{complete_profile,...}]`（server 仍判定未完成）→ 仍在 RequiredActionFlow | 错误展示通用文案"还有待办未完成"或重新展示同一 action |
| 5 | updateNickname 失败（envelope error）| 错误透传，按钮 re-enabled，仍在 page |
| 6 | 客户端校验：trim 后空 → 不发 HTTP | route count 0，内联错误 |
| 7 | 刷新页面 → localStorage flag 仍在 → auto-login list() 返非空 → 仍弹 | 验证 flag + list 协同 |
| 8 | Auto-login list() 返空 + flag 残留 → 自愈 | flag 被 clear，进 ChatWorkspace |
| 9 | Auto-login list() 5xx → fail-open | 进 ChatWorkspace + captureException |
| 10 | Multi-account：A clear、B pending → 切到 A | A 的 ChatWorkspace 渲染，B 的 flag 仍存 |
| 11 | BUILTIN mode → list() 直接返 `[]`（noop），永不弹 | forced builtin → loginResult.requiredActions === [] → 直进 ChatWorkspace |
| 12 | Server 返 unknown type + required=true → unsupported 页面 | mock list 返 `[{type:'foobar',required:true}]` → 看到"需要更新客户端"页 |
| 13 | Server 返 unknown type + required=false → silent skip | mock list 返 `[{type:'foobar',required:false}, {type:'complete_profile',required:true,fields:['nickname']}]` → 跳过 foobar 直接渲染 complete_profile |

---

## 14. R8.4 round 拆分（再确认）

| Round | 范围 | 关键产物 |
|---|---|---|
| **R8.4a** | 本文档 + [PLATFORM_PROFILE_HTTP_CONTRACT.md](./PLATFORM_PROFILE_HTTP_CONTRACT.md) | required actions 契约 + profile API 契约 |
| R8.4a-server | **shipped** | (1) `MemberLoginResponse.requiredActions: List<RequiredAction> = emptyList()`；(2) DTO `controller.app.auth.dto.RequiredAction` 含 `action / required / title / titleKey / fields / version / noticeId / reason`；(3) `logic.RequiredActionsLogic.computeForUid(uid)` + `computeForMember(member)` + `isProfileIncomplete(member)`；(4) Controller `controller.app.required_actions.RequiredActionsController`（**包名独特避免与 module-platform `AccountController` 冲突**）暴露 `GET /app/account/required-actions`。无 schema 改动。Curl-verified 6/6 cases pass |
| **R8.4b** | feat(web): provider 实现 | `RequiredActionsProvider`（PLATFORM HTTP impl + BUILTIN noop）+ `PlatformProfileProvider.getProfile/updateNickname` |
| **R8.4c** | feat(web): RequiredActionFlow + CompleteProfileAction | `App.tsx` 加状态机分支 + `RequiredActionFlow` + `CompleteProfileAction` + localStorage pending + auto-login 二次确认 + i18n + 13-case smoke |
| R8.4d | feat(web): full profile editor UI | ChatWorkspace 顶栏入口 + 完整字段编辑（avatar / username / bio / gender / birthday）|
| R8.4e | future actions | accept_terms / bind_mobile / acknowledge_notice 等 action 类型，按需展开 |

---

## 14b. Wire-defense cheatsheet (Web R8.4b 必读)

R8.4a-server 实测出来的真实 wire 行为，client 必须按下列方式解析，**不能假设字段一定存在**：

```ts
// 1. requiredActions 缺失 → 视为空数组
const actions: RequiredAction[] =
  loginResponse.data?.requiredActions ?? [];

// 2. RequiredAction.required 缺失 → 视为 true (fail-closed)
const required = action.required ?? true;

// 3. title resolution: titleKey i18n → server title → action machine name
function actionTitle(a: RequiredAction, t: (k: string) => string): string {
  if (a.titleKey !== undefined) {
    const translated = t(a.titleKey);
    if (translated !== a.titleKey) return translated;
  }
  if (typeof a.title === 'string' && a.title !== '') return a.title;
  return a.action;
}

// 4. Dispatch by `action` ONLY. Never switch on `title`/`titleKey`.
switch (a.action) {
  case 'complete_profile': return <CompleteProfileAction ... />;
  default:
    return isRequired(a)
      ? <UnsupportedRequiredActionPage actionTitle={actionTitle(a, t)} />
      : null;  // silent skip
}
```

### Real paths (curl-verified, R8.4a-server)

```
POST {platformBaseUrl}/auth/sms-login
  → 200 envelope.data may contain requiredActions; if absent treat as []

GET  {platformBaseUrl}/account/required-actions
  → 200 envelope.data.requiredActions is always an array (server-controlled)
  → 401 when token missing/invalid

PUT  {platformBaseUrl}/member/user/update-nickname
  → 200 envelope.data === null
```

`{platformBaseUrl}` is the env var which already contains `/app` (e.g. `http://localhost:8080/app`,或子域名 `https://app-api.example.com/`). All controllers use single-layer business-prefix annotations (`@Controller("/account")`, `@Controller("/member/user")` 等),clients write single-layer paths only.

### Kotlin KDoc nested-comment gotcha

Server-side doc-comments must NOT include `` `…/…/*` `` style examples inside `/** ... */`. Kotlin treats `/*` as a nested-comment opener (unlike Java), so a path like `` `/member/account/*` `` inside KDoc triggers "Unclosed comment". Use `` `…/…/...` `` (literal three dots) or break the line.

## 14c. Future Note: user-specific assigned actions

R8.4 ships **derived-only** required actions: `RequiredActionsLogic.computeForMember(member)`
is a pure function over `member_users` state, **no actions table**, no
per-user assignment records. This is intentional and correct for the v1
target (profile completion).

If future product requirements need **user-specific actions** — KYC, risk
reset, agreement acknowledgment, targeted operational notices, etc. —
introduce an independent required-actions assignment module. Two hard rules
for that future round:

1. **Profile-completion actions (nickname / avatar / bio / gender / birthday)
   MUST stay derived** from member state. They MUST NOT be persisted as
   assignment rows. Mixing the two sources creates a sync-loop bug:
   action row stale-after-update, or row deleted before state cleared.
2. **Source ownership is exclusive per action type**:
   - Derived: data-state-driven (e.g. `complete_profile.*`)
   - Assigned: per-user dispatch (e.g. `complete_kyc`, `reset_password`)
   - Policy: global gates (e.g. `accept_terms` for a new terms version)
   The same `action` string MUST NOT appear in two sources.

Until that need arrives, derived-only is the design. No schema, no
assignment endpoints, no admin dispatch — all out of scope for R8.4.

## 15. 一句话总结

PLATFORM 模式下 server 在 LoginResponse 加 `requiredActions: RequiredAction[]` 并提供独立检测端点 `GET /app/account/required-actions`；每个 action 用稳定 `action` 字段做 dispatch（v1 唯一实现 `complete_profile`，title="设置昵称"），可选 `title` / `titleKey` 仅用于 UI 展示；client 在非空数组时阻断 ChatWorkspace，按顺序处理 action（调 `ProfileProvider.updateNickname` 等），每完成一个重新拉权威列表，直到返空才进 workspace；缺失 `requiredActions` 字段视同 `[]`；缺失 `required` 字段视同 `true`；unknown action + required=true（含缺省）必须 fail-closed 阻断进 workspace，render "需要更新客户端" 页面；BUILTIN v1 永远返空数组。
