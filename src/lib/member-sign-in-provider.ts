// Member daily sign-in (签到) provider — PLATFORM mode only.
//
// Mirrors the same HTTP seam as `PlatformProfileProvider`: the member
// business endpoints live under the platform base URL (which already
// contains the `/app` framework prefix) and are authed with the active
// session's bearer token via the `{ code, message?, data? }` envelope.
//
// Server controller (privchat-application-module-member,
// `MemberSignInController`, `@Controller("/member/sign-in")`):
//   GET  /member/sign-in/config/list                 → MemberSignInConfig[]
//   GET  /member/sign-in/record/get-summary?userId=  → MemberSignInSummaryVO
//   POST /member/sign-in/record/create?userId=       → MemberSignInRecord
//   GET  /member/sign-in/record/page?userId=&page=&size= → page
//
// The reward currency is points (`point`). `userId` is passed explicitly
// (the controller signatures take it as a parameter).

import { getConfiguredAccountMode, getPlatformBaseUrl } from './account-mode';
import { normalizePlatformBaseUrl } from './platform-base-url';
import {
  getEnvelope,
  postAuthedEnvelope,
  requireData,
} from './platform-envelope';
import { PlatformConfigError } from './platform-errors';
import type { AccessTokenProvider } from './account-required-actions-provider';

/** One configured reward tier. `day` is the streak day index this row
 *  applies to; `point` is the awarded points. */
export interface SignInConfig {
  id: string;
  day: number;
  point: number;
  experience: number;
  cashAmount: number;
  status: number;
}

/** Aggregate sign-in state for the current user. */
export interface SignInSummary {
  totalDay: number;
  continuousDay: number;
  todaySigned: boolean;
}

/** A single sign-in record (one per day signed). */
export interface SignInRecord {
  id: string;
  userId: string;
  day: number;
  point: number;
  experience: number;
  cashAmount: number;
  createdAt?: string;
}

export interface MemberSignInProvider {
  listConfigs(): Promise<SignInConfig[]>;
  getSummary(userId: string): Promise<SignInSummary>;
  signIn(userId: string): Promise<SignInRecord>;
}

interface SignInConfigWire {
  id: number | string;
  day: number;
  point: number;
  experience?: number;
  cashAmount?: number;
  status?: number;
}

interface SignInSummaryWire {
  totalDay: number;
  continuousDay: number;
  todaySigned: boolean;
}

interface SignInRecordWire {
  id: number | string;
  userId: number | string;
  day: number;
  point: number;
  experience?: number;
  cashAmount?: number;
  createdAt?: string;
}

export class PlatformMemberSignInProvider implements MemberSignInProvider {
  readonly baseUrl: string;

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
        'PlatformMemberSignInProvider requires an active access token',
      );
    }
    return token;
  }

  async listConfigs(): Promise<SignInConfig[]> {
    const data = await getEnvelope<SignInConfigWire[]>(
      `${this.baseUrl}/member/sign-in/config/list`,
      this.requireToken(),
    );
    return (data ?? []).map((c) => ({
      id: String(c.id),
      day: c.day,
      point: c.point,
      experience: c.experience ?? 0,
      cashAmount: c.cashAmount ?? 0,
      status: c.status ?? 1,
    }));
  }

  async getSummary(userId: string): Promise<SignInSummary> {
    const data = requireData(
      await getEnvelope<SignInSummaryWire>(
        `${this.baseUrl}/member/sign-in/record/get-summary?userId=${encodeURIComponent(userId)}`,
        this.requireToken(),
      ),
      'sign-in.summary',
    );
    return {
      totalDay: data.totalDay,
      continuousDay: data.continuousDay,
      todaySigned: data.todaySigned,
    };
  }

  async signIn(userId: string): Promise<SignInRecord> {
    const data = requireData(
      await postAuthedEnvelope<SignInRecordWire>(
        `${this.baseUrl}/member/sign-in/record/create?userId=${encodeURIComponent(userId)}`,
        this.requireToken(),
      ),
      'sign-in.create',
    );
    return {
      id: String(data.id),
      userId: String(data.userId),
      day: data.day,
      point: data.point,
      experience: data.experience ?? 0,
      cashAmount: data.cashAmount ?? 0,
      createdAt: data.createdAt,
    };
  }
}

let cachedProvider: MemberSignInProvider | null = null;

export function getMemberSignInProvider(
  getAccessToken: AccessTokenProvider,
): MemberSignInProvider {
  if (cachedProvider !== null) return cachedProvider;
  const mode = getConfiguredAccountMode();
  if (mode !== 'platform') {
    throw new PlatformConfigError(
      'Member sign-in is only available in platform account mode',
    );
  }
  const baseUrl = getPlatformBaseUrl();
  if (baseUrl === null) {
    throw new PlatformConfigError(
      'VITE_PRIVCHAT_PLATFORM_BASE_URL is required when VITE_PRIVCHAT_ACCOUNT_MODE=platform',
    );
  }
  cachedProvider = new PlatformMemberSignInProvider(baseUrl, getAccessToken);
  return cachedProvider;
}

/** Test-only reset. */
export function __resetMemberSignInProviderForTests(): void {
  cachedProvider = null;
}
