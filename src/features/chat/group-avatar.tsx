// GroupAvatar — 群头像。群有 avatar_url 时直接显示图片；否则取前 9 名
// 成员在客户端合成九宫格（三端统一规格：排序 owner<admin<其他 →
// joined_at → user_id，布局 1/2/3 列 + 首行居中）。成员未加载 / 拉取
// 失败 / 为空时回退到现有的色块首字 Avatar。
//
// 成员列表走模块级缓存（TTL 10 分钟 + in-flight Promise 去重），避免
// 会话列表每行重复请求同一群的 roster。

import { useEffect, useState } from 'react';
import type { GroupMember } from '@privchat/sdk';
import { useGroupOps } from '@privchat/react';
import { cn } from '@/lib/utils';
import { Avatar, avatarBgColor, pickGlyph, type AvatarProps } from './avatar';

export interface GroupAvatarProps {
  /** 群 channel_id（协议约定 group_id == channel_id）。 */
  channelId: string;
  /** 群名 — 兜底 Avatar 的首字来源。 */
  name?: string;
  /** 群自定义头像；有则优先，不再合成。 */
  avatarUrl?: string;
  size?: AvatarProps['size'];
  className?: string;
}

// 尺寸与 Avatar 的 h-7/h-9/h-12/h-16 对应（Tailwind 4px 基准）。
const SIZE_PX: Record<NonNullable<AvatarProps['size']>, number> = {
  sm: 28,
  md: 36,
  lg: 48,
  xl: 64,
};

// ---- 成员缓存：模块级 Map，TTL 10 分钟，in-flight 去重 ----

const MEMBER_TTL_MS = 10 * 60 * 1000;
const memberCache = new Map<string, { members: GroupMember[]; at: number }>();
const inflight = new Map<string, Promise<GroupMember[]>>();

type ListMembersFn = (
  groupId: string,
) => Promise<{ members: GroupMember[]; total: number }>;

function fetchTopMembers(
  channelId: string,
  listMembers: ListMembersFn,
): Promise<GroupMember[]> {
  const hit = memberCache.get(channelId);
  if (hit !== undefined && Date.now() - hit.at < MEMBER_TTL_MS) {
    return Promise.resolve(hit.members);
  }
  const pending = inflight.get(channelId);
  if (pending !== undefined) return pending;
  const p = listMembers(channelId)
    .then((resp) => {
      const members = sortForGrid(resp.members).slice(0, 9);
      memberCache.set(channelId, { members, at: Date.now() });
      return members;
    })
    .finally(() => {
      inflight.delete(channelId);
    });
  inflight.set(channelId, p);
  return p;
}

// 排序：role 权重 owner(0) < admin(1) < 其他(2) → joined_at 升序 → user_id 升序。
function roleWeight(role: string): number {
  // server 历史序列化过 "Owner"/"Admin" 大写形态,做大小写兼容
  const r = role.toLowerCase();
  if (r === 'owner') return 0;
  if (r === 'admin') return 1;
  return 2;
}

function sortForGrid(members: GroupMember[]): GroupMember[] {
  return [...members].sort((a, b) => {
    const rw = roleWeight(a.role) - roleWeight(b.role);
    if (rw !== 0) return rw;
    if (a.joined_at !== b.joined_at) return a.joined_at - b.joined_at;
    return a.user_id - b.user_id;
  });
}

export function GroupAvatar({
  channelId,
  name,
  avatarUrl,
  size = 'md',
  className,
}: GroupAvatarProps) {
  const { listMembers } = useGroupOps();
  const hasUrl = typeof avatarUrl === 'string' && avatarUrl !== '';
  // state 带 channelId 标记，切换群时不闪上一个群的九宫格；
  // 渲染值优先读同步缓存，命中则首帧即出格子。
  const [loaded, setLoaded] = useState<{
    id: string;
    members: GroupMember[];
  } | null>(null);
  const members =
    loaded !== null && loaded.id === channelId
      ? loaded.members
      : memberCache.get(channelId)?.members;

  useEffect(() => {
    if (hasUrl) return;
    let cancelled = false;
    fetchTopMembers(channelId, listMembers)
      .then((m) => {
        if (!cancelled) setLoaded({ id: channelId, members: m });
      })
      .catch(() => {
        // 拉取失败静默回退到色块 Avatar。
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, hasUrl, listMembers]);

  if (hasUrl) {
    return (
      <Avatar
        seed={`g:${channelId}`}
        label={name}
        src={avatarUrl}
        size={size}
        className={className}
      />
    );
  }
  if (members === undefined || members.length === 0) {
    return (
      <Avatar seed={`g:${channelId}`} label={name} size={size} className={className} />
    );
  }
  return <NineGrid members={members} sizePx={SIZE_PX[size]} className={className} />;
}

// ---- 九宫格布局（规格固定，三端统一，勿改参数）----
//
// n=1 → 1 列；2..4 → 2 列；5..9 → 3 列。首行格数 = n%cols（整除时为
// cols），首行水平居中，行块整体垂直居中。pad = gap = S*0.04。

function NineGrid({
  members,
  sizePx: S,
  className,
}: {
  members: GroupMember[];
  sizePx: number;
  className?: string;
}) {
  // 固定 3x3 九格：无论成员多少格子恒 9 个，从左上按行填，空位画浅色空格块。
  // 微信风：外边距偏大、格间距很小、格子直角（无圆角，省渲染）。
  const pad = S * 0.09;
  const gap = S * 0.02;
  const cell = (S - 2 * pad - 2 * gap) / 3;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none flex-col items-center justify-center overflow-hidden rounded-[22%] shadow-sm',
        className,
      )}
      style={{ width: S, height: S, padding: pad, gap, backgroundColor: '#d9dce0' }}
      aria-hidden="true"
    >
      {[0, 1, 2].map((ri) => (
        <span key={ri} className="flex shrink-0 justify-center" style={{ gap }}>
          {[0, 1, 2].map((ci) => {
            const m = members[ri * 3 + ci];
            return m !== undefined ? (
              <MemberCell key={m.user_id} member={m} cell={cell} />
            ) : (
              <span
                key={`e${ci}`}
                className="shrink-0"
                style={{
                  width: cell,
                  height: cell,
                  backgroundColor: '#edeff2',
                }}
              />
            );
          })}
        </span>
      ))}
    </span>
  );
}

function MemberCell({ member, cell }: { member: GroupMember; cell: number }) {
  const [imgFailed, setImgFailed] = useState(false);
  if (typeof member.avatar_url === 'string' && member.avatar_url !== '' && !imgFailed) {
    return (
      <img
        src={member.avatar_url}
        alt=""
        onError={() => setImgFailed(true)}
        className="shrink-0 object-cover"
        style={{ width: cell, height: cell }}
      />
    );
  }
  // 无头像成员：hash 色块 + 白色首字（seed 用 u:{user_id}，与单人头像一致）。
  const displayName = member.nickname !== '' ? member.nickname : member.username;
  return (
    <span
      className="flex shrink-0 items-center justify-center font-semibold text-white"
      style={{
        width: cell,
        height: cell,
        fontSize: cell * 0.5,
        lineHeight: 1,
        backgroundColor: avatarBgColor(`u:${member.user_id}`),
      }}
    >
      {pickGlyph(displayName)}
    </span>
  );
}
