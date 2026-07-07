// 邀请码补填(MEMBER_INVITE_CODE §5.2):填写邀请码 dialog。
import { getEnvelope, postAuthedEnvelope, requireData } from './platform-envelope';
import { activePlatform } from './platform-session';

export interface MyInviteBinding {
  bound: boolean;
  code?: string;
  inviterUserId?: number;
  /** 0=跳过 1=成功 2=失败(encodeDefaults=false:缺席=0) */
  autoFriendStatus?: number;
  boundAt?: number;
}

export async function myInviteBinding(userId: string): Promise<MyInviteBinding> {
  const { baseUrl, token } = activePlatform();
  const data = await getEnvelope<MyInviteBinding>(
    `${baseUrl}/member/invite-code/my?userId=${encodeURIComponent(userId)}`,
    token,
  );
  return { bound: false, autoFriendStatus: 0, ...(data ?? {}) };
}

export interface BindInviteResult {
  bound: boolean;
  code: string;
  inviterUserId?: number;
  autoFriendStatus?: number;
}

export async function bindInviteCode(userId: string, inviteCode: string): Promise<BindInviteResult> {
  const { baseUrl, token } = activePlatform();
  return requireData(
    await postAuthedEnvelope<BindInviteResult>(
      `${baseUrl}/member/invite-code/bind?userId=${encodeURIComponent(userId)}`,
      token,
      { inviteCode },
    ),
    'invite.bind',
  );
}
