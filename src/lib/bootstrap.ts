// 白标 G0（Web）：PLATFORM 模式网关由 platform bootstrap 下发。
// `GET {platformBaseUrl}/config/bootstrap?client=web`；浏览器只接受 ws/wss 网关。
// 优先级：bootstrap 动态 > 本地缓存 > env legacy 静态(+warning)；全空 → 服务配置不可用。
import { getPlatformBaseUrl } from './account-mode';

const CACHE_KEY = 'privchat.bootstrap.gateways';
const AUTH_CACHE_KEY = 'privchat.bootstrap.auth';
let dynamicGateways: string[] = [];
let fetchedThisRun = false;

/** 注册策略(MEMBER_INVITE_CODE §5.0)。encodeDefaults=false:缺席字段用默认。 */
export interface BootstrapAuth {
  registerModes: string[];
  defaultRegisterMode: string;
  inviteCodeRequired: boolean;
  nicknameRequired: boolean;
}

const DEFAULT_AUTH: BootstrapAuth = {
  registerModes: ['PHONE_SMS'],
  defaultRegisterMode: 'PHONE_SMS',
  inviteCodeRequired: false,
  nicknameRequired: false,
};

let dynamicAuth: BootstrapAuth | null = null;

/** 当前注册策略(动态 > 缓存 > 默认)。 */
export function getBootstrapAuth(): BootstrapAuth {
  if (dynamicAuth !== null) return dynamicAuth;
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY);
    if (raw !== null) return { ...DEFAULT_AUTH, ...(JSON.parse(raw) as Partial<BootstrapAuth>) };
  } catch { /* 忽略 */ }
  return DEFAULT_AUTH;
}

function isWsGateway(url: string): boolean {
  return url.startsWith('ws://') || url.startsWith('wss://');
}

function readCache(): string[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY) ?? '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean).filter(isWsGateway);
  } catch {
    return [];
  }
}

/** 同步读当前可用网关（动态 > 缓存）；无则 null。 */
export function getBootstrapGateway(): string | null {
  if (dynamicGateways.length > 0) return dynamicGateways[0]!;
  const cached = readCache();
  if (cached.length > 0) return cached[0]!;
  return null;
}

/** 拉取 bootstrap（幂等：本次运行成功一次后不再重复）。失败静默（调用方回退缓存/legacy）。 */
export async function ensureBootstrap(): Promise<void> {
  if (fetchedThisRun) return;
  const base = (getPlatformBaseUrl() ?? '').trim();
  if (base === '') return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`${base.replace(/\/$/, '')}/config/bootstrap?client=web`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = (await resp.json()) as {
      code?: number;
      data?: { gateways?: string[]; auth?: Partial<BootstrapAuth> };
    };
    if (data.code === 0 && data.data?.auth !== undefined) {
      dynamicAuth = { ...DEFAULT_AUTH, ...data.data.auth };
      try { localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(dynamicAuth)); } catch { /* 忽略 */ }
    }
    if (data.code === 0 && data.data?.gateways !== undefined) {
      const ws = data.data.gateways.filter(isWsGateway);
      if (ws.length > 0) {
        dynamicGateways = ws;
        fetchedThisRun = true;
        try {
          localStorage.setItem(CACHE_KEY, ws.join(','));
        } catch {
          /* 缓存失败可忽略 */
        }
        console.log('[bootstrap] gateways =', ws);
      } else {
        console.warn('[bootstrap] platform 未下发 ws/wss 网关（Web 仅支持 WebSocket）');
      }
    }
  } catch (e) {
    console.warn('[bootstrap] 拉取失败（将回退缓存/legacy 静态配置）:', e);
  }
}
