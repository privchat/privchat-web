// Mention composer helpers (MENTION_SPEC §3 / §7「ID 锚定」).
//
// 客户端选择成员后以 `@显示名 ` 形式插入草稿，并记录 user_id；发送时
// 从草稿按文本顺序回收 mentioned_user_ids。服务端只认 id 列表（昵称解析
// 不可靠），所以这里的核心职责是「选中的 id 集合正确」，文本实体配对由
// SDK 的 scanMessageTextEntities 在接收侧做（数量不一致时安全回退）。
//
// 纯函数，便于单测；状态留在 ConversationPanel。

import type { GroupMember } from '@privchat/sdk';

export interface MentionSelection {
  userId: string;
  /** 插入到 `@` 之后的显示名（与草稿里的 token 一致）。 */
  label: string;
}

export interface MentionTrigger {
  /** `@` 之后、光标之前的查询串。 */
  query: string;
  /** `@` 在草稿中的下标。 */
  start: number;
  /** 光标下标（查询串末尾）。 */
  end: number;
}

const TOKEN_CHAR = /[\p{L}\p{N}_-]/u;

/** 检测光标处是否正在输入一个 @提及：`@` 须位于词首（行首或空白后），
 *  其后到光标之间只能是 token 字符。命中返回触发区间，否则 null。 */
export function detectMention(text: string, caret: number): MentionTrigger | null {
  const before = text.slice(0, caret);
  const m = /(?:^|\s)@([\p{L}\p{N}_-]*)$/u.exec(before);
  if (m === null) return null;
  const query = m[1] ?? '';
  return { query, start: caret - query.length - 1, end: caret };
}

/** 按查询串过滤群成员（display_name / username / nickname 子串，忽略大小写）。
 *  排除自己与系统账号；最多返回 limit 个。 */
export function filterMentionMembers(
  members: readonly GroupMember[],
  query: string,
  selfUid: string | undefined,
  limit = 8,
): GroupMember[] {
  const q = query.trim().toLowerCase();
  const out: GroupMember[] = [];
  for (const m of members) {
    if (m.user_type === 1) continue;
    if (selfUid !== undefined && String(m.user_id) === selfUid) continue;
    if (q !== '') {
      const hay = `${m.display_name} ${m.username} ${m.nickname}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}

/** 把草稿 [start,end) 的 `@query` 替换为 `@label `，返回新文本与新光标。 */
export function insertMention(
  text: string,
  start: number,
  end: number,
  label: string,
): { text: string; caret: number } {
  const token = `@${label} `;
  const next = text.slice(0, start) + token + text.slice(end);
  return { text: next, caret: start + token.length };
}

/** 发送时从草稿回收 mentioned_user_ids：按每个已选 label 的 `@token` 在
 *  文本中出现的位置排序、去重。token 后必须是非 token 字符（避免 `@Alice`
 *  误匹配 `@Alicia`）。被用户删掉的提及自然不再命中。 */
export function collectMentionIds(
  text: string,
  selections: readonly MentionSelection[],
): string[] {
  const hits: Array<{ pos: number; userId: string }> = [];
  for (const s of selections) {
    const token = `@${s.label}`;
    let idx = text.indexOf(token);
    while (idx !== -1) {
      const after = text[idx + token.length];
      if (after === undefined || !TOKEN_CHAR.test(after)) {
        hits.push({ pos: idx, userId: s.userId });
      }
      idx = text.indexOf(token, idx + 1);
    }
  }
  hits.sort((a, b) => a.pos - b.pos);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const h of hits) {
    if (seen.has(h.userId)) continue;
    seen.add(h.userId);
    ids.push(h.userId);
  }
  return ids;
}